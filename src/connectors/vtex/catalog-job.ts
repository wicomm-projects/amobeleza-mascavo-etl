import { getBrandConfig, getEnv, type tBrand, type tDatabase } from '../../config/index.js'
import { runWithConcurrency } from '../../core/concurrency.js'
import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iJob, iJobContext, iRunSummary } from '../../core/jobs/types.js'

import { createBrandApi, type iVtexApi } from './client.js'
import { isTransportFailure, withoutSqlPayload } from './errors.js'
import { loadCatalogFixture } from './fixtures.js'
import type { iCategoryNode, tProduct, tProductAndSkuIds } from './schemas.js'
import { CATALOG_TABLES } from './tables.js'
import { productIdOf, toCategoryTreeRows, toProductRow, toSkusAndProductsRows } from './transform-catalog.js'

/**
 * vtex-catalog — catálogo da loja da marca, 1x por dia.
 *
 * 1. GetProductAndSkuIds, de 250 em 250 (teto da API), até cobrir o total → vtex_skus_and_products_id (replaceAll).
 * 2. Cadastro de cada produto → vtex_products (upsert por id; produto que sumiu do catálogo continua na tabela). Só
 *    nas marcas de WRITES_PRODUCTS: a Amobeleza não grava (tabela parada desde 2024, nenhum relatório lê).
 * 3. Árvore de categorias → vtex_category_tree (replaceAll).
 *
 * replaceAll recusa lote vazio: catálogo vazio vindo da API derruba a carga em vez de apagar as tabelas. Página vazia
 * no meio do mapa também derruba (senão o replaceAll apagaria parte dele). Produto ou categoria fora do formato das
 * colunas fica de fora com nota; a carga só falha inteira se todos os cadastros falharem por HTTP/rede.
 */

/** Teto de _to - _from em GetProductAndSkuIds (doc da VTEX). */
const PRODUCT_IDS_PAGE_SIZE = 250
/** Trava contra laço infinito se o `range.total` vier errado: 400 páginas = 100 mil produtos. */
const MAX_PRODUCT_IDS_PAGES = 400
/** Profundidade pedida à árvore de categorias (departamento → categoria → subcategoria). Confirmar na paridade. */
const CATEGORY_TREE_LEVELS = 3
/** 1x por dia, 05:15 (fuso de São Paulo, no agendador). */
const SCHEDULE_DAILY = '15 5 * * *'
const MAX_IDS_IN_NOTES = 10

/**
 * Quais marcas gravam vtex_products. Na Amobeleza, não (decisão do Matheus, AMO-Q18, 24/11/2026): na produção a tabela
 * foi gravada uma única vez, em 02/09/2024, e o ETL antigo nunca mais a atualizou; pela doc da WPP nenhum dos 5
 * relatórios da Amobeleza a lê (o Web Analytics pega produto do ERP). Sem ela, o job não lê o cadastro de cada produto
 * (~27 mil chamadas por dia). Para voltar a gravar, basta trocar para true.
 */
const WRITES_PRODUCTS: Readonly<Record<tBrand, boolean>> = { mascavo: true, amobeleza: false }

const writesProducts = (brand?: tBrand): boolean => (brand ? WRITES_PRODUCTS[brand] : false)

const catalogTablesOf = (brand?: tBrand): readonly string[] =>
	writesProducts(brand)
		? [CATALOG_TABLES.products, CATALOG_TABLES.skusAndProducts, CATALOG_TABLES.categoryTree]
		: [CATALOG_TABLES.skusAndProducts, CATALOG_TABLES.categoryTree]

interface iCatalogData {
	skusByProduct: Map<number, number[]>
	products: tProduct[]
	tree: iCategoryNode[]
	notes: string[]
}

const requireBrand = (brand: tBrand | undefined): tBrand => {
	if (!brand) throw new AppError('vtex-catalog roda por marca: informe --brand.')

	return brand
}

const databaseOf = (brand?: tBrand): tDatabase => getBrandConfig(requireBrand(brand)).database

const errorMessage = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

/** Até 10 IDs para as notas (o log tem todos). */
const shortList = (ids: number[]): string => {
	const more = ids.length > MAX_IDS_IN_NOTES ? ` e mais ${ids.length - MAX_IDS_IN_NOTES}` : ''

	return `${ids.slice(0, MAX_IDS_IN_NOTES).join(', ')}${more}`
}

const addSkus = (target: Map<number, number[]>, page: tProductAndSkuIds): number => {
	const entries = Object.entries(page.data)

	entries.forEach(([key, skuIds]) => target.set(productIdOf(key), skuIds ?? []))

	return entries.length
}

/**
 * Mapa produto → SKUs inteiro, de 250 em 250. Página vazia antes do `range.total`, ou o teto de páginas, lança: o
 * replaceAll seguinte apagaria da tabela os produtos que não chegaram a ser lidos.
 */
const listProductAndSkuIds = async (api: Pick<iVtexApi, 'getProductAndSkuIds'>): Promise<Map<number, number[]>> => {
	const skusByProduct = new Map<number, number[]>()
	let from = 1
	let total = Number.POSITIVE_INFINITY

	for (let page = 0; page < MAX_PRODUCT_IDS_PAGES && from <= total; page += 1) {
		const to = from + PRODUCT_IDS_PAGE_SIZE - 1
		const response = await api.getProductAndSkuIds(from, to)

		total = response.range.total

		if (addSkus(skusByProduct, response) === 0) {
			if (from <= total) {
				throw new AppError(
					`GetProductAndSkuIds: página ${from}-${to} veio vazia antes do total (${total}); o mapa ficaria incompleto.`
				)
			}

			break
		}

		from = to + 1
	}

	if (from <= total) {
		throw new AppError(`GetProductAndSkuIds: mais de ${MAX_PRODUCT_IDS_PAGES} páginas (total ${total}); confira.`)
	}

	return skusByProduct
}

const fetchFromApi = async (ctx: iJobContext, brand: tBrand): Promise<iCatalogData> => {
	const api = createBrandApi(brand)
	const skusByProduct = await listProductAndSkuIds(api)

	if (!writesProducts(brand)) {
		const tree = await api.getCategoryTree(CATEGORY_TREE_LEVELS)

		return {
			skusByProduct,
			products: [],
			tree,
			notes: [
				`${skusByProduct.size} produto(s) no catálogo; cadastro não lido (${brand} não grava vtex_products)`
			]
		}
	}

	const productIds = [...skusByProduct.keys()]
	const settled = await runWithConcurrency(
		productIds.map(id => () => api.getProduct(id)),
		getEnv().HTTP_CONCURRENCY
	)
	const products: tProduct[] = []
	const failedIds: number[] = []
	const transportFailures: unknown[] = []

	settled.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			products.push(result.value)

			return
		}

		const productId = productIds[index] ?? 0

		failedIds.push(productId)

		if (isTransportFailure(result.reason)) transportFailures.push(result.reason)

		ctx.logger.warn({ productId, reason: errorMessage(result.reason) }, 'Cadastro do produto falhou')
	})

	// Todos falharam por HTTP/rede: credencial, permissão ou API fora do ar.
	if (productIds.length > 0 && products.length === 0 && transportFailures.length > 0) {
		throw new AppError(
			`Nenhum cadastro de produto obtido (${failedIds.length} falhas). Primeiro erro: ${errorMessage(transportFailures[0])}`
		)
	}

	const tree = await api.getCategoryTree(CATEGORY_TREE_LEVELS)
	const notes = [`${productIds.length} produto(s) no catálogo, ${products.length} cadastro(s) lido(s)`]

	if (failedIds.length > 0) {
		notes.push(`${failedIds.length} cadastro(s) com falha (mantidos como estavam): ${shortList(failedIds)}`)
	}

	return { skusByProduct, products, tree, notes }
}

const fetchFromFixture = async (file: string): Promise<iCatalogData> => {
	const fixture = await loadCatalogFixture(file)
	const skusByProduct = new Map<number, number[]>()

	addSkus(skusByProduct, fixture.productAndSkuIds)

	return {
		skusByProduct,
		products: fixture.products,
		tree: fixture.categoryTree,
		notes: [`fixture ${file}: ${skusByProduct.size} produto(s) no mapa, ${fixture.products.length} cadastro(s)`]
	}
}

const run = async (ctx: iJobContext): Promise<iRunSummary> => {
	const brand = requireBrand(ctx.brand)
	const data = ctx.options.fixture ? await fetchFromFixture(ctx.options.fixture) : await fetchFromApi(ctx, brand)
	// Produto fora do formato das colunas fica de fora; a linha antiga dele continua. Marca que não grava vtex_products
	// (Amobeleza) ignora os cadastros, inclusive os de uma fixture.
	const productRows: tRow[] = []
	const invalidProductIds: number[] = []
	const products = writesProducts(brand) ? data.products : []

	for (const product of products) {
		try {
			productRows.push(toProductRow(product))
		} catch (err) {
			invalidProductIds.push(product.Id)
			ctx.logger.warn({ productId: product.Id, reason: errorMessage(err) }, 'Produto fora do formato das colunas')
		}
	}

	const skuRows = toSkusAndProductsRows(data.skusByProduct)
	const tree = toCategoryTreeRows(data.tree)

	const { results } = await ctx.writer
		.transaction(async tx => {
			if (writesProducts(brand)) await tx.upsert(CATALOG_TABLES.products, productRows, { keyColumns: ['id'] })

			await tx.replaceAll(CATALOG_TABLES.skusAndProducts, skuRows)
			await tx.replaceAll(CATALOG_TABLES.categoryTree, tree.rows)
		})
		.catch(err => {
			throw withoutSqlPayload(err)
		})

	const notes = [...data.notes, `${tree.rows.length} nó(s) na árvore de categorias`]

	if (invalidProductIds.length > 0) {
		notes.push(
			`${invalidProductIds.length} produto(s) fora do formato (mantidos como estavam): ${shortList(invalidProductIds)}`
		)
	}

	if (tree.skippedIds.length > 0) {
		notes.push(
			`${tree.skippedIds.length} categoria(s) sem título ou meta description, fora da árvore: ${shortList(tree.skippedIds)}`
		)
	}

	return { results, notes }
}

const catalogJob: iJob = {
	name: 'vtex-catalog',
	source: 'vtex',
	scope: 'brand',
	description: 'Catálogo VTEX: produtos, mapa produto → SKUs e árvore de categorias',
	tables: catalogTablesOf,
	database: databaseOf,
	schedule: SCHEDULE_DAILY,
	run
}

export { CATEGORY_TREE_LEVELS, catalogJob, listProductAndSkuIds, writesProducts }
