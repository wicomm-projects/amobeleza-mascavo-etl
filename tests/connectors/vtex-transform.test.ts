import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadCatalogFixture, loadOrdersFixture } from '../../src/connectors/vtex/fixtures.js'
import type { iCategoryNode } from '../../src/connectors/vtex/schemas.js'
import { toCategoryTreeRows } from '../../src/connectors/vtex/transform-catalog.js'
import {
	toDetailRow,
	toItemRows,
	toLogisticsInfoRows,
	toOrderRow,
	toPaymentRows
} from '../../src/connectors/vtex/transform-orders.js'
import { toReais } from '../../src/connectors/vtex/values.js'

/** Exemplos públicos da documentação da VTEX (nenhum dado da cliente). */
const FIXTURES = path.resolve('src/connectors/vtex/fixtures')
const CONTEXT = { account: 'exemplo', processedAtLocal: new Date(Date.UTC(2026, 10, 24, 12, 0, 0)) }

const loadOrders = () => loadOrdersFixture(path.join(FIXTURES, 'vtex-orders.json'))

const firstOf = async () => {
	const fixture = await loadOrders()
	const detail = fixture.orders[0]

	if (!detail) throw new Error('fixture sem pedido')

	return detail
}

const node = (id: number, name: string, children: iCategoryNode[] = []): iCategoryNode => ({
	id,
	name,
	hasChildren: children.length > 0,
	url: `/${name}`,
	Title: name,
	MetaTagDescription: name,
	children
})

describe('toReais', () => {
	it('converte centavos em reais, inclusive negativo e zero', () => {
		expect(toReais(4405)).toBe(44.05)
		expect(toReais(-585)).toBe(-5.85)
		expect(toReais(0)).toBe(0)
	})

	it('vazio continua vazio', () => {
		expect(toReais(null)).toBeNull()
		expect(toReais(undefined)).toBeNull()
	})
})

describe('valores dos pedidos: só vtex_orders.total_value fica em centavos', () => {
	it('vtex_orders.total_value fica como a VTEX manda', async () => {
		const fixture = await loadOrders()
		const order = fixture.list.list[0]

		if (!order) throw new Error('fixture sem pedido na lista')

		expect(toOrderRow(order, 'exemplo').total_value).toBe(order.totalValue)
	})

	it('vtex_order_details: value e totals em reais', async () => {
		const detail = await firstOf()
		const row = toDetailRow(detail, CONTEXT)

		expect(row.value).toBe(11.6)
		expect(row.totals_items).toBe(0.99)
		expect(row.totals_shipping).toBe(3)
		expect(row.totals_discounts).toBe(0)
	})

	it('vtex_order_items: colunas decimal em reais, colunas int como a VTEX manda', async () => {
		const detail = await firstOf()
		const [item] = toItemRows(detail)

		expect(item).toMatchObject({
			price: 9.9,
			listprice: 19.9,
			sellingprice: 9.9,
			costprice: 5.2,
			shippingprice: null,
			rewardvalue: 1599,
			commission: 0,
			tax: 0,
			manualprice: null
		})
	})

	it('colunas int não zero continuam como a VTEX manda', async () => {
		const detail = await firstOf()
		const [first] = detail.items ?? []

		if (!first) throw new Error('fixture sem item')

		const [item] = toItemRows({
			...detail,
			items: [{ ...first, commission: 2500, tax: 150, freightCommission: 800 }]
		})

		expect(item).toMatchObject({ commission: 2500, tax: 150, freightcommission: 800, rewardvalue: 1599 })
	})

	it('logística e pagamentos em reais', async () => {
		const detail = await firstOf()
		const [logistics] = toLogisticsInfoRows(detail)
		const [payment] = toPaymentRows(detail)

		expect(logistics).toMatchObject({ price: 30, list_price: 30, selling_price: 30 })
		expect(payment).toMatchObject({ value: 39.9, reference_value: 39.9 })
	})
})

describe('vtex_category_tree: id da VTEX e pai em sub_category_id', () => {
	it('raiz com pai 0; filho e neto apontam para o pai direto', () => {
		const tree = [node(81927, 'Face', [node(81948, 'Base', [node(900, 'Base líquida')])]), node(21866, 'Lábios')]
		const { rows, skippedIds } = toCategoryTreeRows(tree)

		expect(skippedIds).toEqual([])
		expect(rows.map(row => [row.id, row.sub_category_id, row.department])).toEqual([
			[81927, 0, null],
			[81948, 81927, 'Face'],
			[900, 81948, 'Face'],
			[21866, 0, null]
		])
	})

	it('nó sem título fica de fora e os filhos continuam apontando para ele', () => {
		const semTitulo = { ...node(81948, 'Base', [node(900, 'Base líquida')]), Title: null }
		const { rows, skippedIds } = toCategoryTreeRows([node(81927, 'Face', [semTitulo])])

		expect(skippedIds).toEqual([81948])
		expect(rows.map(row => [row.id, row.sub_category_id])).toEqual([
			[81927, 0],
			[900, 81948]
		])
	})

	it('ID repetido ou fora da faixa fica de fora (e o filho de pai fora da faixa também)', () => {
		const grande = 3_000_000_000
		const tree = [
			node(81927, 'Face', [node(81948, 'Base')]),
			node(81948, 'Base de novo'),
			node(grande, 'Gigante', [node(5, 'Filho')])
		]
		const { rows, skippedIds } = toCategoryTreeRows(tree)

		expect(rows.map(row => row.id)).toEqual([81927, 81948])
		expect(skippedIds).toEqual([81948, grande, 5])
	})

	it('fixture pública: toda linha tem id, e filho aponta para uma raiz', async () => {
		const fixture = await loadCatalogFixture(path.join(FIXTURES, 'vtex-catalog.json'))
		const { rows } = toCategoryTreeRows(fixture.categoryTree)
		const roots = new Set(rows.filter(row => row.sub_category_id === 0).map(row => row.id))

		expect(rows.every(row => typeof row.id === 'number')).toBe(true)
		expect(rows.filter(row => row.sub_category_id !== 0).every(row => roots.has(row.sub_category_id))).toBe(true)
	})
})
