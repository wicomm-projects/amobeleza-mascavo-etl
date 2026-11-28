import { describe, expect, it } from 'vitest'

import { isAccountAllowed } from '../../src/connectors/anymarket/orders-job.js'

const AMOBELEZA_ACCOUNTS = [
	'AMOBELEZA',
	'Amobeleza',
	'AMOBELEZACOMERCIODIGITALE',
	'Beleza na Web',
	'Itau',
	'VinkloByFestalab'
]

describe('AnyMarket: filtro por conta (ANYMARKET_ACCOUNTS)', () => {
	it('sem filtro: todas as contas', () => {
		expect(isAccountAllowed('AMOBELEZA', undefined)).toBe(true)
		expect(isAccountAllowed('MASCAVO', undefined)).toBe(true)
	})

	it('só MASCAVO: as contas da Amobeleza ficam de fora', () => {
		for (const account of AMOBELEZA_ACCOUNTS) expect(isAccountAllowed(account, ['MASCAVO'])).toBe(false)

		expect(isAccountAllowed('MASCAVO', ['MASCAVO'])).toBe(true)
	})

	it('nome exato, como o Power BI da Mascavo filtra (account_name = "MASCAVO")', () => {
		expect(isAccountAllowed('Mascavo', ['MASCAVO'])).toBe(false)
		expect(isAccountAllowed(' MASCAVO ', ['MASCAVO'])).toBe(false)
	})
})
