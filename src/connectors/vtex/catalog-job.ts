import { getBrandConfig, getEnv, type tBrand, type tDatabase } from '../../config/index.js'
import { runWithConcurrency } from '../../core/concurrency.js'
import { AppError } from '../../core/errors.js'
import type { iJob, iJobContext, iRunSummary } from '../../core/jobs/types.js'

import { createBrandApi, type iVtexApi } from './client.js'
import { loadCatalogFixture } from './fixtures.js'
import type { iCategoryNode, tProduct, tProductAndSkuIds } from './schemas.js'
import { CATALOG_TABLES } from './tables.js'
import { productIdOf, toCategoryTreeRows, toProductRow, toSkusAndProductsRows } from './transform-catalog.js'

/**
 * vtex-catalog — catálogo da loja da marca, 1x por dia.
 *
 * 1. GetProductAndSkuIds, de 250 em 250 (teto da API), até cobrir o total → vtex_skus_and_products_id (replaceAll).
 * 2. Cadastro de cada produto → vtex_products (upsert por id; produto que sumiu do catálogo continua na tabela).
 * 3. Árvore de categorias → vtex_category_tree (replaceAll).
 *
 * replaceAll recusa lote vazio: catálogo vazio vindo da API derruba a carga em vez de apagar as tabelas.
 */

/** Teto de _to - _from em GetProductAndSkuIds (doc da VTEX). */
const PRODUCT_IDS_PAGE_SIZE = 250
/** Trava contra laço infinito se o `range.total` vier errado: 400 páginas = 100 mil produtos. */
const MAX_PRODUCT_IDS_PAGES = 400
/** Profundidade pedida à árvore de categorias (departamento → categoria → subcategoria). Confirmar na paridade. */
const CATEGORY_TREE_LEVELS = 3
/** 1x por dia, 05:15 (fuso de São Paulo, no agendador). */
const SCHEDULE_DAILY = '15 5 * * *'
const MAX_FAILED_IDS_IN_NOTES = 10

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

const addSkus = (target: Map<number, number[]>, page: tProductAndSkuIds): number => {
	const entries = Object.entries(page.data)

	entries.forEach(([key, skuIds]) => target.set(productIdOf(key), skuIds ?? []))

	return entries.length
}

const listProductAndSkuIds = async (api: Pick<iVtexApi, 'getProductAndSkuIds'>): Promise<Map<number, number[]>> => {
	const skusByProduct = new Map<number, number[]>()
	let from = 1
	let total = Number.POSITIVE_INFINITY

	for (let page = 0; page < MAX_PRODUCT_IDS_PAGES && from <= total; page += 1) {
		const to = from + PRODUCT_IDS_PAGE_SIZE - 1
		const response = await api.getProductAndSkuIds(from, to)

		total = response.range.total

		if (addSkus(skusByProduct, response) === 0) break

		from = to + 1
	}

	return skusByProduct
}

const fetchFromApi = async (ctx: iJobContext, brand: tBrand): Promise<iCatalogData> => {
	const api = createBrandApi(brand)
	const skusByProduct = await listProductAndSkuIds(api)
	const productIds = [...skusByProduct.keys()]
	const settled = await runWithConcurrency(
		productIds.map(id => () => api.getProduct(id)),
		getEnv().HTTP_CONCURRENCY
	)
	const products: tProduct[] = []
	const failedIds: number[] = []

	settled.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			products.push(result.value)

			return
		}

		const productId = productIds[index] ?? 0

		failedIds.push(productId)
		ctx.logger.warn({ productId, reason: errorMessage(result.reason) }, 'Cadastro do produto falhou')
	})

	if (productIds.length > 0 && products.length === 0) {
		throw new AppError(`Nenhum cadastro de produto obtido (${failedIds.length} falhas).`)
	}

	const tree = await api.getCategoryTree(CATEGORY_TREE_LEVELS)
	const notes = [`${productIds.length} produto(s) no catálogo, ${products.length} cadastro(s) lido(s)`]

	if (failedIds.length > 0) {
		const shown = failedIds.slice(0, MAX_FAILED_IDS_IN_NOTES).join(', ')

		notes.push(`${failedIds.length} cadastro(s) com falha (mantidos como estavam): ${shown}`)
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
	const productRows = data.products.map(toProductRow)
	const skuRows = toSkusAndProductsRows(data.skusByProduct)
	const treeRows = toCategoryTreeRows(data.tree)

	const { results } = await ctx.writer.transaction(async tx => {
		await tx.upsert(CATALOG_TABLES.products, productRows, { keyColumns: ['id'] })
		await tx.replaceAll(CATALOG_TABLES.skusAndProducts, skuRows)
		await tx.replaceAll(CATALOG_TABLES.categoryTree, treeRows)
	})

	return { results, notes: [...data.notes, `${treeRows.length} nó(s) na árvore de categorias`] }
}

const catalogJob: iJob = {
	name: 'vtex-catalog',
	source: 'vtex',
	scope: 'brand',
	description: 'Catálogo VTEX: produtos, mapa produto → SKUs e árvore de categorias',
	tables: [CATALOG_TABLES.products, CATALOG_TABLES.skusAndProducts, CATALOG_TABLES.categoryTree],
	database: databaseOf,
	schedule: SCHEDULE_DAILY,
	run
}

export { catalogJob, listProductAndSkuIds }
