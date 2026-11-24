import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'

import type { iCategoryNode, tProduct } from './schemas.js'
import { flag, required, toText } from './values.js'

/**
 * Transformações puras do catálogo → vtex_products, vtex_skus_and_products_id e vtex_category_tree, com a grafia do
 * dicionário (docs/contrato/mascavo_etl.md). Texto acima de 255 caracteres é cortado (colunas varchar(255)). Coluna NOT
 * NULL sem valor lança (`required`): só aquele produto ou nó fica fora da carga.
 */

/**
 * `ref_id` é NOT NULL. Produto sem código de referência na VTEX: o ETL antigo gravava "1". Medido na produção (só
 * leitura, 24/11/2026): os 10 produtos que hoje vêm sem RefId estão lá com ref_id = "1", como vários outros.
 */
const OLD_ETL_PRODUCT_REF_ID = '1'

const refIdOf = (product: tProduct): string => {
	const refId = toText(product.RefId)

	return refId === null || refId.trim() === '' ? OLD_ETL_PRODUCT_REF_ID : refId
}

/** vtex_products — PK id (ID do produto na VTEX). */
const toProductRow = (product: tProduct): tRow => ({
	id: product.Id,
	name: toText(product.Name),
	department_id: product.DepartmentId,
	category_id: product.CategoryId,
	brand_id: product.BrandId,
	link_id: toText(product.LinkId),
	ref_id: refIdOf(product),
	is_visible: flag(product.IsVisible),
	description: toText(product.Description),
	description_short: toText(product.DescriptionShort),
	release_date: toText(product.ReleaseDate),
	key_words: toText(product.KeyWords),
	title: toText(product.Title),
	is_active: flag(product.IsActive),
	tax_code: toText(product.TaxCode),
	meta_tag_description: toText(product.MetaTagDescription),
	supplier_id: toText(product.SupplierId),
	show_without_stock: toText(product.ShowWithoutStock),
	ad_words_remarketing_code: toText(product.AdWordsRemarketingCode),
	lomadee_campaign_code: toText(product.LomadeeCampaignCode),
	score: toText(product.Score)
})

/**
 * vtex_skus_and_products_id — uma linha por produto, com a lista de SKUs em JSON. `id` é técnico (auto incremento):
 * não vai na linha. Ordem por product_id para a carga ser estável.
 */
const toSkusAndProductsRows = (skusByProduct: ReadonlyMap<number, readonly number[]>): tRow[] =>
	[...skusByProduct.entries()]
		.sort(([left], [right]) => left - right)
		.map(([productId, skuIds]) => ({ product_id: productId, sku_id: JSON.stringify(skuIds) }))

/** "1" → 1. As chaves de GetProductAndSkuIds são IDs de produto em texto. */
const productIdOf = (key: string): number => {
	const id = Number(key)

	if (!Number.isInteger(id) || id <= 0)
		throw new AppError(`VTEX: ID de produto inválido em GetProductAndSkuIds (${key})`)

	return id
}

/**
 * vtex_category_tree — a árvore achatada, um nó por linha, `id` técnico (não vai na linha).
 * - Departamento (raiz): `department` nulo e `sub_category_id` 0 ("0 quando é nó raiz", dicionário).
 * - Categoria abaixo dele: `department` = nome do departamento e `sub_category_id` = ID da categoria na VTEX.
 * A regra exata do ETL antigo para `department` e `sub_category_id` não está documentada: confirmar na paridade.
 * Nó sem título ou meta description (NOT NULL) fica de fora, com o ID em `skippedIds`; os filhos dele seguem.
 */
const toCategoryTreeRows = (tree: readonly iCategoryNode[]): { rows: tRow[]; skippedIds: number[] } => {
	const rows: tRow[] = []
	const skippedIds: number[] = []

	const visit = (node: iCategoryNode, department: string | null) => {
		try {
			rows.push({
				name: toText(node.name),
				department: department === null ? null : toText(department),
				has_children: flag(node.hasChildren),
				url: toText(node.url),
				title: toText(required(node.Title, `categoria ${node.id} title`)),
				meta_tag_description: toText(
					required(node.MetaTagDescription, `categoria ${node.id} meta_tag_description`)
				),
				sub_category_id: department === null ? 0 : node.id
			})
		} catch {
			skippedIds.push(node.id)
		}

		node.children.forEach(child => visit(child, department ?? node.name))
	}

	tree.forEach(root => visit(root, null))

	return { rows, skippedIds }
}

export { productIdOf, toCategoryTreeRows, toProductRow, toSkusAndProductsRows }
