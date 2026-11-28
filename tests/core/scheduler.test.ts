import { describe, expect, it } from 'vitest'

import type { tBrand, tDatabase } from '../../src/config/brands.js'
import { plannedRuns } from '../../src/core/jobs/scheduler.js'
import type { iJob } from '../../src/core/jobs/types.js'

const databaseOf = (brand?: tBrand): tDatabase => (brand === 'amobeleza' ? 'amobeleza_etl' : 'mascavo_etl')

const job = (name: string, scope: 'brand' | 'global', database: (brand?: tBrand) => tDatabase, schedule?: string) =>
	({ name, scope, database, schedule }) as unknown as iJob

const JOBS = [
	job('vtex-orders', 'brand', databaseOf, '*/30 * * * *'),
	job('ga4', 'brand', databaseOf, '15 */3 * * *'),
	job('anymarket-orders', 'global', () => 'amobeleza_etl', '*/30 * * * *'),
	job('sem-agenda', 'brand', databaseOf)
]

const names = (runs: ReturnType<typeof plannedRuns>) =>
	runs.planned.map(run => (run.brand ? `${run.job.name}:${run.brand}` : run.job.name))

describe('agendador: só os jobs dos bancos liberados', () => {
	it('só a Mascavo: agenda VTEX e GA4 da Mascavo; Amobeleza e AnyMarket ficam de fora', () => {
		const runs = plannedRuns(JOBS, ['mascavo_etl'])

		expect(names(runs)).toEqual(['vtex-orders:mascavo', 'ga4:mascavo'])
		expect(runs.skipped.map(run => (run.brand ? `${run.job.name}:${run.brand}` : run.job.name))).toEqual([
			'vtex-orders:amobeleza',
			'ga4:amobeleza',
			'anymarket-orders'
		])
	})

	it('os dois bancos: agenda tudo que tem horário', () => {
		expect(names(plannedRuns(JOBS, ['mascavo_etl', 'amobeleza_etl']))).toEqual([
			'vtex-orders:mascavo',
			'vtex-orders:amobeleza',
			'ga4:mascavo',
			'ga4:amobeleza',
			'anymarket-orders'
		])
	})
})
