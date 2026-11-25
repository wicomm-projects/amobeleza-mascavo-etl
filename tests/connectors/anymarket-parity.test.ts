import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import { anymarketParity } from '../../src/connectors/anymarket/parity.js'
import { MASK } from '../../src/connectors/anymarket/personal-data.js'
import {
	orderSchema,
	ordersPageSchema,
	type tAnymarketOrder,
	type tOrdersPage
} from '../../src/connectors/anymarket/schemas.js'
import { ANYMARKET_TABLES } from '../../src/connectors/anymarket/tables.js'
import { toOrderRows } from '../../src/connectors/anymarket/transform.js'
import type { iRefReader, tRow } from '../../src/core/db/index.js'
import type { iParityContext } from '../../src/core/jobs/types.js'
import type { iCompareResult } from '../../src/core/parity/compare.js'

/** Exemplo público da documentação do AnyMarket (nenhum dado da cliente). Sem rede e sem banco. */
const FIXTURE = path.resolve('src/connectors/anymarket/fixtures/orders-page.json')
const WINDOW = { from: new Date(Date.UTC(2022, 1, 24)), to: new Date(Date.UTC(2022, 1, 24, 23, 59, 59, 999)) }
const ORDER_ID = 123_456

const logger = pino({ level: 'silent' })

/** O que o MySQL devolveria: decimal como texto ("9.90"), datas como Date, o resto como veio. */
const asMysql = (row: tRow): tRow =>
	Object.fromEntries(
		Object.entries(row).map(([column, value]) => [
			column,
			typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(2) : value
		])
	)

const orderOf = async (): Promise<tAnymarketOrder> => {
	const page = ordersPageSchema.parse(JSON.parse(await readFile(FIXTURE, 'utf8')))
	const raw = page.content[0] as Record<string, unknown>

	return orderSchema.parse({
		...raw,
		id: ORDER_ID,
		accountName: 'MASCAVO',
		gross: 99.9,
		total: 109.9,
		items: [{ ...(raw.items as Record<string, unknown>[])[0], unit: 49.95, gross: 99.9, total: 99.9 }]
	})
}

const pageOf = (order: tAnymarketOrder, extra: unknown[] = []): tOrdersPage => ({
	links: [],
	content: [order, ...extra],
	page: null
})

/** "Produção" falsa: as linhas que a própria transformação gera, como o MySQL devolveria. */
const productionOf = (order: tAnymarketOrder, overrides: Record<string, tRow[]> = {}): Map<string, tRow[]> => {
	const rows = toOrderRows(order)
	const production = new Map<string, tRow[]>([
		[ANYMARKET_TABLES.orders, [rows.order]],
		[ANYMARKET_TABLES.items, rows.items],
		[ANYMARKET_TABLES.payments, rows.payments],
		[ANYMARKET_TABLES.shipping, rows.shipping],
		[ANYMARKET_TABLES.tracking, rows.tracking],
		[ANYMARKET_TABLES.buyer, rows.buyer]
	])

	for (const [table, tableRows] of Object.entries(overrides)) production.set(table, tableRows)

	return new Map([...production].map(([table, tableRows]) => [table, tableRows.map(asMysql)]))
}

const fakeRefReader = (tables: ReadonlyMap<string, tRow[]>) => {
	const queries: { sql: string; params: unknown[] }[] = []
	const reader: iRefReader = {
		query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
			queries.push({ sql, params })

			if (sql.includes('MAX(order_created_at)')) return (tables.get('__max__') ?? []) as T[]

			const table = /FROM `[a-z_]+`\.`([a-z_]+)`/.exec(sql)?.[1] ?? ''

			return (tables.get(table) ?? []) as T[]
		},
		showCreateTable: async () => ''
	}

	return { reader, queries }
}

const contextOf = (refReader: iRefReader, options: iParityContext['options'] = { sample: 10, ...WINDOW }) =>
	({ database: 'amobeleza_etl', logger, refReader, options }) satisfies iParityContext

const capture = () => {
	const captured: { results: iCompareResult[]; meta: Record<string, unknown> } = { results: [], meta: {} }
	const writeReport = async (_job: string, results: iCompareResult[], meta: Record<string, unknown> = {}) => {
		captured.results = results
		captured.meta = meta

		return 'reports/falso.json'
	}

	return { captured, writeReport }
}

const listPagesOf = (page: tOrdersPage, onFilters?: (filters: Record<string, string>) => void) =>
	async function* (filters: Record<string, string>) {
		onFilters?.(filters)

		yield page
	}

const resultOf = (results: iCompareResult[], table: string): iCompareResult => {
	const found = results.find(result => result.table === table)

	if (!found) throw new Error(`sem resultado para ${table}`)

	return found
}

describe('paridade de anymarket-orders', () => {
	it('pedido igual nos dois lados: nenhuma tabela diverge e o pedido é estável', async () => {
		const order = await orderOf()
		const { reader } = fakeRefReader(productionOf(order))
		const { captured, writeReport } = capture()
		const summary = await anymarketParity(contextOf(reader), { listPages: listPagesOf(pageOf(order)), writeReport })

		expect(summary.reportPath).toBe('reports/falso.json')
		expect(summary.tables).toHaveLength(6)
		expect(summary.tables.every(table => table.divergent === 0)).toBe(true)
		expect(summary.tables.every(table => table.compared > 0)).toBe(true)
		expect(captured.meta).toMatchObject({
			stable: 1,
			changedAfter: [],
			withoutProduction: [],
			sample: 1,
			listed: 1,
			byAccount: { MASCAVO: 1 }
		})
	})

	it('status diferente na produção: vai para "(mudou depois)" sem divergência', async () => {
		const order = await orderOf()
		const production = productionOf(order)
		const [stored] = production.get(ANYMARKET_TABLES.orders) ?? []

		production.set(ANYMARKET_TABLES.orders, [{ ...stored, status: 'PAID_WAITING_SHIP' }])

		const { reader } = fakeRefReader(production)
		const { captured, writeReport } = capture()
		const summary = await anymarketParity(contextOf(reader), { listPages: listPagesOf(pageOf(order)), writeReport })
		const changed = summary.tables.find(table => table.table === `${ANYMARKET_TABLES.orders} (mudou depois)`)

		expect(captured.meta).toMatchObject({ stable: 0, changedAfter: [ORDER_ID] })
		expect(changed).toMatchObject({ compared: 1, divergent: 0 })
		expect(summary.tables.some(table => table.table === ANYMARKET_TABLES.orders)).toBe(false)
		expect(summary.tables.every(table => table.divergent === 0)).toBe(true)
	})

	it('gross em centavos na produção: 1 divergente em anymarket_orders', async () => {
		const order = await orderOf()
		const production = productionOf(order)
		const [stored] = production.get(ANYMARKET_TABLES.orders) ?? []

		production.set(ANYMARKET_TABLES.orders, [{ ...stored, gross: '9990.00' }])

		const { reader } = fakeRefReader(production)
		const { captured, writeReport } = capture()
		const summary = await anymarketParity(contextOf(reader), { listPages: listPagesOf(pageOf(order)), writeReport })

		expect(summary.tables.find(table => table.table === ANYMARKET_TABLES.orders)?.divergent).toBe(1)
		expect(resultOf(captured.results, ANYMARKET_TABLES.orders).divergentByColumn.gross).toBe(1)
	})

	it('e-mail diferente em anymarket_order_buyer: a diferença sai mascarada dos dois lados', async () => {
		const order = await orderOf()
		const production = productionOf(order)
		const [buyer] = production.get(ANYMARKET_TABLES.buyer) ?? []

		production.set(ANYMARKET_TABLES.buyer, [{ ...buyer, email: 'outro@exemplo.com' }])

		const { reader } = fakeRefReader(production)
		const { captured, writeReport } = capture()

		await anymarketParity(contextOf(reader), { listPages: listPagesOf(pageOf(order)), writeReport })

		const result = resultOf(captured.results, ANYMARKET_TABLES.buyer)
		const diff = result.diffs.find(candidate => candidate.column === 'email')

		expect(result.divergentByColumn.email).toBe(1)
		expect(diff).toMatchObject({ expected: MASK, actual: MASK })
		expect(JSON.stringify(captured.results)).not.toContain('outro@exemplo.com')
	})

	it('pedido fora da produção: entra em withoutProduction e não é comparado', async () => {
		const order = await orderOf()
		const { reader } = fakeRefReader(new Map())
		const { captured, writeReport } = capture()
		const summary = await anymarketParity(contextOf(reader), { listPages: listPagesOf(pageOf(order)), writeReport })

		expect(captured.meta).toMatchObject({ stable: 0, changedAfter: [], withoutProduction: [ORDER_ID] })
		expect(summary.tables).toEqual([])
	})

	it('pedido fora do formato entra em invalid e a lista usa os filtros de criação', async () => {
		const order = await orderOf()
		const { reader } = fakeRefReader(productionOf(order))
		const { captured, writeReport } = capture()
		const filters: Record<string, string>[] = []

		await anymarketParity(contextOf(reader), {
			listPages: listPagesOf(pageOf(order, [{ id: 999 }]), seen => filters.push(seen)),
			writeReport
		})

		expect(captured.meta).toMatchObject({ invalid: [999], listed: 2, sample: 1 })
		expect(filters).toHaveLength(1)
		expect(Object.keys(filters[0] ?? {}).sort()).toEqual(['createdAfter', 'createdBefore'])
	})

	it('toda consulta à produção é SELECT, com LIMIT e parâmetro', async () => {
		const order = await orderOf()
		const { reader, queries } = fakeRefReader(productionOf(order))
		const { writeReport } = capture()

		await anymarketParity(contextOf(reader), { listPages: listPagesOf(pageOf(order)), writeReport })

		expect(queries).toHaveLength(6)

		for (const { sql, params } of queries) {
			expect(sql).toMatch(/^SELECT /)
			expect(sql).toMatch(/\bLIMIT\b/)
			expect(sql).not.toMatch(/--|#|\/\*|;/)
			expect(params.length).toBeGreaterThan(0)
		}
	})

	it('sem --from/--to: janela vem do MAX(order_created_at) menos 30 dias, com 2 dias de largura', async () => {
		const order = await orderOf()
		const production = productionOf(order)

		production.set('__max__', [{ ultima: new Date(Date.UTC(2024, 2, 1, 10)) }])

		const { reader, queries } = fakeRefReader(production)
		const { captured, writeReport } = capture()

		await anymarketParity(contextOf(reader, { sample: 10 }), { listPages: listPagesOf(pageOf(order)), writeReport })

		expect(queries[0]?.sql).toContain('MAX(order_created_at)')
		expect(queries[0]?.sql).toMatch(/LIMIT 1$/)
		expect(captured.meta.window).toMatchObject({
			from: '2024-01-29T23:59:59.999Z',
			to: '2024-01-31T23:59:59.999Z'
		})
	})
})
