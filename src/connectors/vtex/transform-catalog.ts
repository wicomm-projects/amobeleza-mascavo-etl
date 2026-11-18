import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'

import type { iCategoryNode, tProduct } from './schemas.js'
import { flag, toText } from './values.js'

/**
 * Transformações puras do catálogo → vtex_products, vtex_skus_and_products_id e vtex_category_tree, com a grafia do
 * dicionário (docs/contrato/mascavo_etl.md). Texto acima de 255 caracteres é cortado (colunas varchar(255)).
 */

/** vtex_products — PK id (ID do produto na VTEX). */
const toProductRow = (product: tProduct): tRow => ({
	id: product.Id,
	name: toText(product.Name),
	department_id: product.DepartmentId,
	category_id: product.CategoryId,
	brand_id: product.BrandId,
	link_id: toText(product.LinkId),
	ref_id: toText(product.RefId),
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
 */
const toCategoryTreeRows = (tree: readonly iCategoryNode[]): tRow[] => {
	const rows: tRow[] = []

	const visit = (node: iCategoryNode, department: string | null) => {
		rows.push({
			name: toText(node.name),
			department: department === null ? null : toText(department),
			has_children: flag(node.hasChildren),
			url: toText(node.url),
			title: toText(node.Title),
			meta_tag_description: toText(node.MetaTagDescription),
			sub_category_id: department === null ? 0 : node.id
		})

		node.children.forEach(child => visit(child, department ?? node.name))
	}

	tree.forEach(root => visit(root, null))

	return rows
}

export { productIdOf, toCategoryTreeRows, toProductRow, toSkusAndProductsRows }
