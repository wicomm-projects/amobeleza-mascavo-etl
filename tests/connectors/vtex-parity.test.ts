import path from 'node:path'

import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import type { tDatabase } from '../../src/config/index.js'
import { catalogParity } from '../../src/connectors/vtex/catalog-parity.js'
import { loadCatalogFixture, loadOrdersFixture } from '../../src/connectors/vtex/fixtures.js'
import { orderParity } from '../../src/connectors/vtex/orders-parity.js'
import { pickSample } from '../../src/connectors/vtex/parity-shared.js'
import { MASK } from '../../src/connectors/vtex/personal-data.js'
import type { tListOrder, tOrderDetail } from '../../src/connectors/vtex/schemas.js'
import { ORDER_CHILD_TABLES, ORDER_TABLES } from '../../src/connectors/vtex/tables.js'
import { toCategoryTreeRows, toProductRow, toSkusAndProductsRows } from '../../src/connectors/vtex/transform-catalog.js'
import { toDetailRows, toOrderRow } from '../../src/connectors/vtex/transform-orders.js'
import { saoPauloWallClock } from '../../src/connectors/vtex/values.js'
import type { iRefReader, tRow } from '../../src/core/db/index.js'
import type { iParityContext } from '../../src/core/jobs/types.js'
import type { iCompareResult } from '../../src/core/parity/compare.js'

/** Exemplos públicos da documentação da VTEX (nenhum dado da cliente). Sem rede e sem banco. */
const FIXTURES = path.resolve('src/connectors/vtex/fixtures')
const NOW = new Date(Date.UTC(2026, 10, 24, 15, 0, 0))
const OLD_ETL_RUN = new Date(Date.UTC(2024, 1, 10, 9, 30, 0))
const WINDOW = { from: new Date(Date.UTC(2024, 1, 1)), to: new Date(Date.UTC(2024, 1, 8)) }

const logger = pino({ level: 'silent' })

/** O que o MySQL devolveria: decimal como texto ("9.90"), datas como Date, o resto como veio. */
const asMysql = (row: tRow): tRow =>
	Object.fromEntries(
		Object.entries(row).map(([column, value]) => [
			column,
			typeof value === 'number' && !Number.isInteger(value) ? value.toFixed(2) : value
		])
	)

interface iScenario {
	detail: tOrderDetail
	listed: tListOrder
}

const scenarioOf = async (): Promise<iScenario> => {
	const fixture = await loadOrdersFixture(path.join(FIXTURES, 'vtex-orders.json'))
	const detail = fixture.orders[0]
	const first = fixture.list.list[0]

	if (!detail || !first) throw new Error('fixture sem pedido')

	return {
		detail,
		listed: {
			...first,
			hostname: 'luxstore',
			orderId: detail.orderId,
			lastChange: detail.lastChange,
			creationDate: detail.creationDate
		}
	}
}

/** "Produção" falsa: as linhas que a própria transformação gera, com o relógio do ETL antigo. */
const productionOf = ({ detail, listed }: iScenario, overrides: Record<string, tRow[]> = {}): Map<string, tRow[]> => {
	const rows = toDetailRows(detail, { account: 'mascavo', processedAtLocal: saoPauloWallClock(OLD_ETL_RUN) })
	const production = new Map<string, tRow[]>([
		[ORDER_TABLES.orders, [toOrderRow(listed, null)]],
		[ORDER_TABLES.details, [rows.details]],
		[ORDER_TABLES.clientProfile, rows.clientProfile ? [rows.clientProfile] : []]
	])

	for (const table of ORDER_CHILD_TABLES) production.set(table, rows.children[table])

	for (const [table, tableRows] of Object.entries(overrides)) production.set(table, tableRows)

	return new Map([...production].map(([table, tableRows]) => [table, tableRows.map(asMysql)]))
}

const fakeRefReader = (tables: ReadonlyMap<string, tRow[]>) => {
	const queries: { sql: string; params: unknown[] }[] = []
	const reader: iRefReader = {
		query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
			queries.push({ sql, params })

			if (sql.includes('MAX(creation_date)')) return (tables.get('__max__') ?? []) as T[]

			const table = /FROM `[a-z_]+`\.`([a-z_]+)`/.exec(sql)?.[1] ?? ''

			return (tables.get(table) ?? []) as T[]
		},
		showCreateTable: async () => ''
	}

	return { reader, queries }
}

const contextOf = (
	refReader: iRefReader,
	database: tDatabase = 'mascavo_etl',
	options: iParityContext['options'] = { sample: 10, ...WINDOW }
): iParityContext => ({
	brand: database === 'mascavo_etl' ? 'mascavo' : 'amobeleza',
	database,
	logger,
	refReader,
	options
})

const capture = () => {
	const captured: { results: iCompareResult[]; meta: Record<string, unknown> } = { results: [], meta: {} }
	const writeReport = async (_job: string, results: iCompareResult[], meta: Record<string, unknown> = {}) => {
		captured.results = results
		captured.meta = meta

		return 'reports/falso.json'
	}

	return { captured, writeReport }
}

const fakeOrdersApi = ({ detail, listed }: iScenario, onList?: (params: unknown) => void) => ({
	listOrders: async (params: unknown) => {
		onList?.(params)

		return { list: [listed], paging: { total: 1, pages: 1, currentPage: 1, perPage: 100 } }
	},
	getOrder: async () => detail
})

const resultOf = (results: iCompareResult[], table: string): iCompareResult => {
	const found = results.find(result => result.table === table)

	if (!found) throw new Error(`sem resultado para ${table}`)

	return found
}

describe('paridade de vtex-orders', () => {
	it('pedido estável com produção igual: nenhuma tabela diverge', async () => {
		const scenario = await scenarioOf()
		const { reader } = fakeRefReader(productionOf(scenario))
		const { captured, writeReport } = capture()
		const summary = await orderParity(contextOf(reader), { api: fakeOrdersApi(scenario), writeReport, now: NOW })

		expect(summary.reportPath).toBe('reports/falso.json')
		expect(summary.tables).toHaveLength(11)
		expect(summary.tables.every(table => table.divergent === 0)).toBe(true)
		expect(resultOf(captured.results, ORDER_TABLES.items).compared).toBeGreaterThan(0)
		expect(captured.meta).toMatchObject({ brand: 'mascavo', stable: 1, changedAfter: [] })
	})

	it('last_change diferente na produção: pedido vai para changedAfter e nada é comparado', async () => {
		const scenario = await scenarioOf()
		const production = productionOf(scenario)
		const [details] = production.get(ORDER_TABLES.details) ?? []

		production.set(ORDER_TABLES.details, [{ ...details, last_change: new Date(Date.UTC(2024, 1, 5)) }])

		const { reader } = fakeRefReader(production)
		const { captured, writeReport } = capture()
		const summary = await orderParity(contextOf(reader), { api: fakeOrdersApi(scenario), writeReport, now: NOW })

		expect(captured.meta).toMatchObject({ stable: 0, changedAfter: [scenario.detail.orderId] })
		expect(summary.tables.every(table => table.compared === 0)).toBe(true)
	})

	it('sellingprice em centavos na produção: 1 divergente em vtex_order_items', async () => {
		const scenario = await scenarioOf()
		const production = productionOf(scenario)
		const [stored] = production.get(ORDER_TABLES.items) ?? []

		production.set(ORDER_TABLES.items, [{ ...stored, sellingprice: '990.00' }])

		const { reader } = fakeRefReader(production)
		const { captured, writeReport } = capture()
		const summary = await orderParity(contextOf(reader), { api: fakeOrdersApi(scenario), writeReport, now: NOW })
		const items = resultOf(captured.results, ORDER_TABLES.items)

		expect(summary.tables.find(table => table.table === ORDER_TABLES.items)?.divergent).toBe(1)
		expect(items.divergentByColumn.sellingprice).toBe(1)
	})

	it('e-mail diferente em vtex_client_profile: a diferença sai mascarada', async () => {
		const scenario = await scenarioOf()
		const production = productionOf(scenario)
		const [profile] = production.get(ORDER_TABLES.clientProfile) ?? []

		production.set(ORDER_TABLES.clientProfile, [{ ...profile, email: 'outro@exemplo.com' }])

		const { reader } = fakeRefReader(production)
		const { captured, writeReport } = capture()

		await orderParity(contextOf(reader), { api: fakeOrdersApi(scenario), writeReport, now: NOW })

		const result = resultOf(captured.results, ORDER_TABLES.clientProfile)
		const diff = result.diffs.find(candidate => candidate.column === 'email')

		expect(result.divergentByColumn.email).toBe(1)
		expect(diff).toMatchObject({ expected: MASK, actual: MASK })
		expect(JSON.stringify(captured.results)).not.toContain('outro@exemplo.com')
	})

	it('sem authorizedDate na VTEX: authorizeddate é neutralizada e contada', async () => {
		const base = await scenarioOf()
		const scenario = { ...base, detail: { ...base.detail, authorizedDate: null } }
		const { reader } = fakeRefReader(productionOf(scenario))
		const { captured, writeReport } = capture()
		const summary = await orderParity(contextOf(reader), { api: fakeOrdersApi(scenario), writeReport, now: NOW })

		expect(summary.tables.find(table => table.table === ORDER_TABLES.details)?.divergent).toBe(0)
		expect(captured.meta.neutralizedDates).toBe(1)
	})

	it('toda consulta à produção é SELECT, com LIMIT e parâmetro', async () => {
		const scenario = await scenarioOf()
		const { reader, queries } = fakeRefReader(productionOf(scenario))
		const { writeReport } = capture()

		await orderParity(contextOf(reader), { api: fakeOrdersApi(scenario), writeReport, now: NOW })

		expect(queries.length).toBeGreaterThan(0)

		for (const { sql, params } of queries) {
			expect(sql).toMatch(/^SELECT /)
			expect(sql).toMatch(/\bLIMIT\b/)
			expect(sql).not.toMatch(/--|#|\/\*|;/)
			expect(params.length).toBeGreaterThan(0)
		}
	})

	it('sem --from/--to: janela vem do MAX(creation_date) menos 30 dias', async () => {
		const scenario = await scenarioOf()
		const production = productionOf(scenario)

		production.set('__max__', [{ ultima: new Date(Date.UTC(2024, 2, 1, 10)) }])

		const { reader, queries } = fakeRefReader(production)
		const { captured, writeReport } = capture()
		let filter = ''

		await orderParity(contextOf(reader, 'mascavo_etl', { sample: 10 }), {
			api: fakeOrdersApi(scenario, params => {
				filter = String((params as { f_creationDate?: string }).f_creationDate)
			}),
			writeReport,
			now: NOW
		})

		expect(queries[0]?.sql).toContain('MAX(creation_date)')
		expect(filter).toContain('2024-01-31T23:59:59.999Z')
		expect(captured.meta.window).toMatchObject({ to: '2024-01-31T23:59:59.999Z' })
	})
})

describe('pickSample', () => {
	const items = Array.from({ length: 100 }, (_, index) => index)

	it('devolve o tamanho pedido, em ordem e espaçado', () => {
		const sample = pickSample(items, 10)

		expect(sample).toHaveLength(10)
		expect(sample).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90])
	})

	it('é determinístico', () => {
		expect(pickSample(items, 7)).toEqual(pickSample(items, 7))
	})

	it('tamanho maior que a lista devolve tudo; zero devolve vazio', () => {
		expect(pickSample([1, 2, 3], 10)).toEqual([1, 2, 3])
		expect(pickSample([1, 2, 3], 0)).toEqual([])
	})
})

describe('paridade de vtex-catalog', () => {
	const catalogOf = async () => {
		const fixture = await loadCatalogFixture(path.join(FIXTURES, 'vtex-catalog.json'))
		const skusByProduct = new Map<number, number[]>(
			Object.entries(fixture.productAndSkuIds.data).map(([key, skuIds]) => [Number(key), skuIds ?? []])
		)
		const api = {
			getProductAndSkuIds: async () => fixture.productAndSkuIds,
			getProduct: async (id: number) => {
				const product = fixture.products[0]

				if (!product) throw new Error('fixture sem produto')

				return { ...product, Id: id }
			},
			getCategoryTree: async () => fixture.categoryTree
		}
		const tree = toCategoryTreeRows(fixture.categoryTree).rows
		const product = fixture.products[0]

		if (!product) throw new Error('fixture sem produto')

		const production = new Map<string, tRow[]>([
			['vtex_category_tree', tree],
			['vtex_skus_and_products_id', toSkusAndProductsRows(skusByProduct)],
			['vtex_products', [...skusByProduct.keys()].map(id => toProductRow({ ...product, Id: id }))]
		])

		return { api, production, tree }
	}

	it('árvore, mapa e produtos iguais: 0 divergentes (Mascavo)', async () => {
		const { api, production } = await catalogOf()
		const { reader } = fakeRefReader(production)
		const { writeReport } = capture()
		const summary = await catalogParity(contextOf(reader, 'mascavo_etl', { sample: 50 }), { api, writeReport })

		expect(summary.tables.map(table => table.table)).toEqual([
			'vtex_category_tree',
			'vtex_skus_and_products_id',
			'vtex_products'
		])
		expect(summary.tables.every(table => table.divergent === 0)).toBe(true)
		expect(summary.tables.every(table => table.compared > 0)).toBe(true)
	})

	it('department diferente na produção: divergência em department', async () => {
		const { api, production, tree } = await catalogOf()
		const withDepartment = tree.findIndex(row => row.department !== null)

		production.set(
			'vtex_category_tree',
			tree.map((row, index) => (index === withDepartment ? { ...row, department: 'Outro' } : row))
		)

		const { reader } = fakeRefReader(production)
		const { captured, writeReport } = capture()

		await catalogParity(contextOf(reader, 'mascavo_etl', { sample: 50 }), { api, writeReport })

		expect(resultOf(captured.results, 'vtex_category_tree').divergentByColumn.department).toBe(1)
	})

	it('Amobeleza não consulta vtex_products', async () => {
		const { api, production } = await catalogOf()
		const { reader, queries } = fakeRefReader(production)
		const { captured, writeReport } = capture()

		await catalogParity(contextOf(reader, 'amobeleza_etl', { sample: 50 }), { api, writeReport })

		expect(queries.some(({ sql }) => sql.includes('vtex_products'))).toBe(false)
		expect(captured.results.map(result => result.table)).not.toContain('vtex_products')
		expect(captured.meta).toMatchObject({ writesProducts: false })
	})
})
