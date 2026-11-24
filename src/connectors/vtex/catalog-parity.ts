import { getEnv } from '../../config/index.js'
import { runWithConcurrency } from '../../core/concurrency.js'
import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iParityContext, iParitySummary } from '../../core/jobs/types.js'
import { compareRows, type iCompareResult, writeParityReport } from '../../core/parity/compare.js'

import { CATEGORY_TREE_LEVELS, listProductAndSkuIds, writesProducts } from './catalog-job.js'
import { createBrandApi, type iVtexApi } from './client.js'
import {
	acceptedNotes,
	extraNotes,
	pickSample,
	qualified,
	redactPersonal,
	summarize,
	type tAcceptedDifferences
} from './parity-shared.js'
import type { tProduct } from './schemas.js'
import { CATALOG_TABLES } from './tables.js'
import { toCategoryTreeRows, toProductRow, toSkusAndProductsRows } from './transform-catalog.js'

/**
 * Paridade de vtex-catalog: monta em memória, com as MESMAS funções da carga (catalog-job.ts), a árvore de categorias,
 * o mapa produto → SKUs e os produtos de uma amostra, e compara com a produção (só SELECT, com LIMIT, por chave).
 * Nada é gravado em banco nenhum. A Amobeleza não grava vtex_products: a tabela não entra na comparação.
 */

/** A árvore é pequena (centenas de nós); o teto só protege a consulta. */
const CATEGORY_TREE_LIMIT = 5000
/** Linhas esperadas por produto no mapa (1; folga para duplicata do ETL antigo). */
const MAP_ROWS_PER_PRODUCT = 5
const STAMPS = ['created_at', 'updated_at']

const SEO_EDITED = 'texto de SEO editado na VTEX depois da última carga do ETL antigo'

/**
 * Diferenças conhecidas com o ETL antigo, *assumidas, a confirmar* (paridade de 24/11/2026). Continuam no relatório
 * completo, mas não contam como divergência.
 */
const ACCEPTED_DIFFERENCES: tAcceptedDifferences = {
	[CATALOG_TABLES.categoryTree]: {
		department:
			'o ETL antigo dava às raízes o nome da primeira raiz; o novo grava nulo na raiz (conferir no Power BI da Amobeleza)',
		title: SEO_EDITED,
		meta_tag_description: SEO_EDITED
	},
	[CATALOG_TABLES.products]: {
		description: 'o ETL antigo gravava "0"; o novo grava o texto da VTEX (nenhum relatório lê)',
		description_short: 'o ETL antigo gravava "0"; o novo grava o texto da VTEX (nenhum relatório lê)',
		key_words: 'o ETL antigo gravava "0"; o novo grava o texto da VTEX (nenhum relatório lê)',
		meta_tag_description: 'o ETL antigo gravava "0"; o novo grava o texto da VTEX (nenhum relatório lê)',
		ad_words_remarketing_code: 'o ETL antigo gravava "0"; o novo grava o que a VTEX manda (nenhum relatório lê)',
		title: SEO_EDITED
	}
}

interface iCatalogParityDeps {
	api?: Pick<iVtexApi, 'getProductAndSkuIds' | 'getProduct' | 'getCategoryTree'>
	writeReport?: typeof writeParityReport
}

const errorMessage = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

const readByKey = async (
	ctx: iParityContext,
	table: string,
	column: 'id' | 'product_id',
	ids: readonly number[],
	limitPerId: number
): Promise<tRow[]> => {
	if (ids.length === 0) return []

	return ctx.refReader.query<tRow>(`SELECT * FROM ${qualified(ctx.database, table)} WHERE ${column} IN (?) LIMIT ?`, [
		[...ids],
		ids.length * limitPerId
	])
}

const catalogParity = async (ctx: iParityContext, deps: iCatalogParityDeps = {}): Promise<iParitySummary> => {
	const brand = ctx.brand

	if (!brand) throw new AppError('Paridade de vtex-catalog roda por marca: informe --brand.')

	const api = deps.api ?? createBrandApi(brand)
	const writeReport = deps.writeReport ?? writeParityReport
	const results: iCompareResult[] = []
	const notes: string[] = []

	// 1. Árvore de categorias, inteira.
	const tree = toCategoryTreeRows(await api.getCategoryTree(CATEGORY_TREE_LEVELS))
	const productionTree = await ctx.refReader.query<tRow>(
		`SELECT * FROM ${qualified(ctx.database, CATALOG_TABLES.categoryTree)} LIMIT ?`,
		[CATEGORY_TREE_LIMIT]
	)

	results.push(
		compareRows({
			table: CATALOG_TABLES.categoryTree,
			keyColumns: ['id'],
			expected: productionTree,
			actual: tree.rows,
			ignoreColumns: STAMPS
		})
	)

	if (tree.skippedIds.length > 0)
		notes.push(`${tree.skippedIds.length} categoria(s) fora da árvore nova (sem título ou ID inválido)`)

	// 2. Mapa produto → SKUs, só da amostra.
	const skusByProduct = await listProductAndSkuIds(api)
	const productIds = pickSample(
		[...skusByProduct.keys()].sort((left, right) => left - right),
		ctx.options.sample
	)
	const sampledSkus = new Map(productIds.map(id => [id, skusByProduct.get(id) ?? []]))

	results.push(
		compareRows({
			table: CATALOG_TABLES.skusAndProducts,
			keyColumns: ['product_id'],
			expected: await readByKey(
				ctx,
				CATALOG_TABLES.skusAndProducts,
				'product_id',
				productIds,
				MAP_ROWS_PER_PRODUCT
			),
			actual: toSkusAndProductsRows(sampledSkus)
		})
	)

	// 3. Produtos, só nas marcas que gravam vtex_products.
	const writes = writesProducts(brand)

	if (writes) {
		const settled = await runWithConcurrency(
			productIds.map(id => () => api.getProduct(id)),
			getEnv().HTTP_CONCURRENCY
		)
		const productRows: tRow[] = []
		const failed: number[] = []

		settled.forEach((result, index) => {
			const productId = productIds[index] ?? 0

			if (result.status === 'rejected') {
				failed.push(productId)
				ctx.logger.warn(
					{ productId, reason: errorMessage(result.reason) },
					'Cadastro do produto falhou na paridade'
				)

				return
			}

			try {
				productRows.push(toProductRow(result.value as tProduct))
			} catch (err) {
				failed.push(productId)
				ctx.logger.warn({ productId, reason: errorMessage(err) }, 'Produto fora do formato na paridade')
			}
		})

		const failedIds = new Set(failed)

		results.push(
			compareRows({
				table: CATALOG_TABLES.products,
				keyColumns: ['id'],
				expected: (await readByKey(ctx, CATALOG_TABLES.products, 'id', productIds, 1)).filter(
					row => !failedIds.has(Number(row.id))
				),
				actual: productRows,
				ignoreColumns: STAMPS
			})
		)

		if (failed.length > 0) notes.push(`${failed.length} produto(s) fora da comparação (falha ou fora do formato)`)
	} else {
		notes.push(`${brand} não grava vtex_products: tabela fora da comparação`)
	}

	const redacted = results.map(result => redactPersonal(result.table, result))
	const meta = {
		brand,
		database: ctx.database,
		sample: productIds.length,
		productsInCatalog: skusByProduct.size,
		writesProducts: writes,
		acceptedDifferences: ACCEPTED_DIFFERENCES
	}
	const reportPath = await writeReport(`vtex-catalog-${brand}`, redacted, meta)

	notes.unshift(`${skusByProduct.size} produto(s) no catálogo, amostra de ${productIds.length}`)
	notes.push(...extraNotes(redacted), ...acceptedNotes(redacted, ACCEPTED_DIFFERENCES))

	return { reportPath, tables: summarize(redacted, ACCEPTED_DIFFERENCES), notes }
}

export { catalogParity }
