import { describe, expect, it } from 'vitest'

import type { tBrand, tDatabase } from '../../src/config/index.js'
import { tablesByDatabase, tablesOf } from '../../src/core/jobs/registry.js'
import type { iJob } from '../../src/core/jobs/types.js'

const job = (overrides: Partial<iJob>): iJob => ({
	name: 'teste',
	source: 'ga4',
	scope: 'brand',
	description: 'job de teste',
	tables: [],
	database: brand => (brand === 'mascavo' ? 'mascavo_etl' : 'amobeleza_etl'),
	run: async () => ({ results: [] }),
	...overrides
})

const MASCAVO_GA4 = ['sheets_google_drive_trafego', 'sheets_google_drive_vendas', 'sheets_google_drive_users']
const AMOBELEZA_GA4 = ['sheets_google_drive_trafego', 'sheets_google_drive_transacoes']

const ga4Like = job({ tables: (brand?: tBrand) => (brand === 'mascavo' ? MASCAVO_GA4 : AMOBELEZA_GA4) })

const sorted = (map: Map<tDatabase, Set<string>>, database: tDatabase) => [...(map.get(database) ?? [])].sort()

describe('tabelas por marca no job', () => {
	it('lista fixa vale igual para as duas marcas', () => {
		const fixed = job({ tables: ['vtex_orders'] })

		expect(tablesOf(fixed, 'mascavo')).toEqual(['vtex_orders'])
		expect(tablesOf(fixed, 'amobeleza')).toEqual(['vtex_orders'])
	})

	it('função devolve a lista de cada marca', () => {
		expect(tablesOf(ga4Like, 'mascavo')).toEqual(MASCAVO_GA4)
		expect(tablesOf(ga4Like, 'amobeleza')).toEqual(AMOBELEZA_GA4)
	})

	it('schema:pull: cada banco recebe só as tabelas que o job grava naquela marca', () => {
		const map = tablesByDatabase([ga4Like])

		expect(sorted(map, 'mascavo_etl')).toEqual([...MASCAVO_GA4].sort())
		expect(sorted(map, 'amobeleza_etl')).toEqual([...AMOBELEZA_GA4].sort())
		expect(map.get('amobeleza_etl')?.has('sheets_google_drive_vendas')).toBe(false)
	})

	it('job global grava só no banco dele', () => {
		const global = job({
			source: 'anymarket',
			scope: 'global',
			tables: ['anymarket_orders'],
			database: () => 'amobeleza_etl'
		})
		const map = tablesByDatabase([global])

		expect(sorted(map, 'amobeleza_etl')).toEqual(['anymarket_orders'])
		expect(map.has('mascavo_etl')).toBe(false)
	})
})
