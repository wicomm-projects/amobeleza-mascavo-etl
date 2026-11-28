import { describe, expect, it } from 'vitest'

import type { tBrand, tDatabase } from '../../src/config/brands.js'
import { runBlockReason } from '../../src/core/jobs/allowed.js'
import type { iJob } from '../../src/core/jobs/types.js'

const databaseOf = (brand?: tBrand): tDatabase => (brand === 'amobeleza' ? 'amobeleza_etl' : 'mascavo_etl')

const job = (name: string, database: (brand?: tBrand) => tDatabase) => ({ name, database }) as unknown as iJob

const VTEX = job('vtex-orders', databaseOf)
const ANYMARKET = job('anymarket-orders', () => 'amobeleza_etl')
const BOTH: tDatabase[] = ['mascavo_etl', 'amobeleza_etl']

/** O que a VPS usa com só a Mascavo liberada e o AnyMarket da conta MASCAVO. */
const MASCAVO_COM_ANYMARKET = {
	databases: BOTH,
	jobs: ['vtex-orders:mascavo', 'vtex-catalog:mascavo', 'ga4:mascavo', 'anymarket-orders']
}

describe('o que o ETL pode gravar (TARGET_DATABASES + TARGET_JOBS)', () => {
	it('sem TARGET_JOBS, vale só o banco', () => {
		expect(runBlockReason(VTEX, 'amobeleza', { databases: ['mascavo_etl'] })).toMatch(/TARGET_DATABASES/)
		expect(runBlockReason(VTEX, 'mascavo', { databases: ['mascavo_etl'] })).toBeNull()
	})

	it('com os dois bancos e TARGET_JOBS: VTEX da Mascavo e AnyMarket passam', () => {
		expect(runBlockReason(VTEX, 'mascavo', MASCAVO_COM_ANYMARKET)).toBeNull()
		expect(runBlockReason(ANYMARKET, undefined, MASCAVO_COM_ANYMARKET)).toBeNull()
	})

	it('com os dois bancos e TARGET_JOBS: VTEX da Amobeleza fica de fora, mesmo com o banco liberado', () => {
		expect(runBlockReason(VTEX, 'amobeleza', MASCAVO_COM_ANYMARKET)).toMatch(/TARGET_JOBS/)
	})

	it('"job" sem marca libera todas as marcas daquele job; "job:marca" só a marca', () => {
		expect(runBlockReason(VTEX, 'amobeleza', { databases: BOTH, jobs: ['vtex-orders'] })).toBeNull()
		expect(runBlockReason(VTEX, 'amobeleza', { databases: BOTH, jobs: ['vtex-orders:mascavo'] })).toMatch(
			/TARGET_JOBS/
		)
	})

	it('o banco continua valendo mesmo com o job na lista', () => {
		expect(
			runBlockReason(ANYMARKET, undefined, { databases: ['mascavo_etl'], jobs: ['anymarket-orders'] })
		).toMatch(/TARGET_DATABASES/)
	})
})
