import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import type { iPreparedTable } from '../../src/connectors/ga4/job.js'
import { ga4Parity } from '../../src/connectors/ga4/parity.js'
import { reportsOf } from '../../src/connectors/ga4/reports.js'
import type { iRefReader, tRow } from '../../src/core/db/index.js'
import type { iParityContext } from '../../src/core/jobs/types.js'
import type { iCompareResult } from '../../src/core/parity/compare.js'

const logger = pino({ level: 'silent' })
const OPTIONS = { sample: 0, from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-07T23:59:59.999Z') }
const TRAFEGO = 'sheets_google_drive_trafego'

const trafegoRow = (overrides: tRow = {}): tRow => ({
	date: '2026-08-03',
	ga4_property_id: 123,
	session_source: 'google / cpc',
	session_campaign_name: 'cb_1',
	platform_device_category: 'web / mobile',
	event_count: 10,
	vehicle_channel_no_pay: 'google ads',
	type: 'pago',
	...overrides
})

const preparedOf = (rows: tRow[]): iPreparedTable[] => {
	const definition = reportsOf('mascavo').find(candidate => candidate.table === TRAFEGO)

	if (!definition) throw new Error('sem definição do tráfego')

	return [{ definition, window: { from: '2026-08-01', to: '2026-08-07' }, rows }]
}

const fakeRefReader = (tables: Record<string, tRow[]>) => {
	const queries: { sql: string; params: unknown[] }[] = []
	const reader: iRefReader = {
		query: async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
			queries.push({ sql, params })

			if (sql.includes('MAX(date)')) return (tables.__max__ ?? []) as T[]

			const table = /FROM `[a-z_]+`\.`([a-z_]+)`/.exec(sql)?.[1] ?? ''

			return (tables[table] ?? []) as T[]
		},
		showCreateTable: async () => ''
	}

	return { reader, queries }
}

const contextOf = (refReader: iRefReader, options: iParityContext['options'] = OPTIONS) =>
	({ brand: 'mascavo', database: 'mascavo_etl', logger, refReader, options }) satisfies iParityContext

const capture = () => {
	const captured: { results: iCompareResult[]; meta: Record<string, unknown>; job: string } = {
		results: [],
		meta: {},
		job: ''
	}
	const writeReport = async (job: string, results: iCompareResult[], meta: Record<string, unknown> = {}) => {
		captured.job = job
		captured.results = results
		captured.meta = meta

		return 'reports/falso.json'
	}

	return { captured, writeReport }
}

const readOf = (rows: tRow[], notes: string[] = []) => {
	const calls: { from: string; to: string }[] = []
	const read = async (_brand: string, from: string, to: string) => {
		calls.push({ from, to })

		return { prepared: preparedOf(rows), notes }
	}

	return { read, calls }
}

describe('paridade do ga4', () => {
	it('produção igual ao novo: 0 divergentes e totais iguais', async () => {
		const { reader } = fakeRefReader({ [TRAFEGO]: [trafegoRow()] })
		const { captured, writeReport } = capture()
		const { read } = readOf([trafegoRow()])
		const summary = await ga4Parity(contextOf(reader), { read, writeReport })

		expect(summary.reportPath).toBe('reports/falso.json')
		expect(summary.tables).toEqual([{ table: TRAFEGO, compared: 1, divergent: 0 }])
		expect(captured.job).toBe('ga4-mascavo')
		expect(summary.notes).toContain('Janela: 2026-08-01 a 2026-08-07')
		expect(summary.notes).toContain(`Total ${TRAFEGO}.event_count: produção 10, novo 10 (0%)`)
	})

	it('métrica diferente: 1 divergente em event_count e a diferença em % nos totais', async () => {
		const { reader } = fakeRefReader({ [TRAFEGO]: [trafegoRow({ event_count: 8 })] })
		const { captured, writeReport } = capture()
		const { read } = readOf([trafegoRow()], ['De/Para incompleto (trafego): 1 origem/campanha sem regra'])
		const summary = await ga4Parity(contextOf(reader), { read, writeReport })

		expect(summary.tables[0]?.divergent).toBe(1)
		expect(captured.results[0]?.divergentByColumn.event_count).toBe(1)
		expect(summary.notes).toContain(`Total ${TRAFEGO}.event_count: produção 8, novo 10 (25%)`)
		expect(summary.notes?.some(note => note.startsWith('De/Para incompleto'))).toBe(true)
	})

	it('toda consulta à produção é SELECT, com LIMIT e parâmetro', async () => {
		const { reader, queries } = fakeRefReader({ [TRAFEGO]: [trafegoRow()] })
		const { writeReport } = capture()
		const { read } = readOf([trafegoRow()])

		await ga4Parity(contextOf(reader), { read, writeReport })

		expect(queries).toHaveLength(1)

		for (const { sql, params } of queries) {
			expect(sql).toMatch(/^SELECT /)
			expect(sql).toMatch(/\bLIMIT\b/)
			expect(sql).not.toMatch(/--|#|\/\*|;/)
			expect(params).toEqual(['2026-08-01', '2026-08-07'])
		}
	})

	it('sem --from/--to: a janela vem do MAX(date) menos 7 dias, com 7 dias ao todo', async () => {
		const { reader, queries } = fakeRefReader({ __max__: [{ ultima: '2026-08-19' }], [TRAFEGO]: [] })
		const { writeReport } = capture()
		const { read, calls } = readOf([])

		await ga4Parity(contextOf(reader, { sample: 0 }), { read, writeReport })

		expect(queries[0]?.sql).toContain('MAX(date)')
		expect(queries[0]?.sql).toMatch(/WHERE date >= \? LIMIT 1$/)
		expect(queries[0]?.params).toEqual(['2025-01-01'])
		expect(calls).toEqual([{ from: '2026-08-06', to: '2026-08-12' }])
	})

	it('só --from: o fim fica 6 dias depois', async () => {
		const { reader } = fakeRefReader({ [TRAFEGO]: [] })
		const { writeReport } = capture()
		const { read, calls } = readOf([])

		await ga4Parity(contextOf(reader, { sample: 0, from: OPTIONS.from }), { read, writeReport })

		expect(calls).toEqual([{ from: '2026-08-01', to: '2026-08-07' }])
	})

	it('Amobeleza fica fora da comparação, com nota, e não lê o GA4', async () => {
		const { reader, queries } = fakeRefReader({})
		const { captured, writeReport } = capture()
		const { read, calls } = readOf([])
		const context = { ...contextOf(reader), brand: 'amobeleza', database: 'amobeleza_etl' } satisfies iParityContext
		const summary = await ga4Parity(context, { read, writeReport })

		expect(summary.tables).toEqual([])
		expect(summary.notes?.[0]).toMatch(/Amobeleza fora da paridade/)
		expect(calls).toEqual([])
		expect(queries).toEqual([])
		expect(captured.job).toBe('ga4-amobeleza')
	})
})
