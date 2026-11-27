import { describe, expect, it } from 'vitest'

import {
	MASK as ANYMARKET_MASK,
	maskPersonalData as maskAnymarket
} from '../../src/connectors/anymarket/personal-data.js'
import { ANYMARKET_TABLES } from '../../src/connectors/anymarket/tables.js'
import { MASK as VTEX_MASK, maskPersonalData as maskVtex } from '../../src/connectors/vtex/personal-data.js'
import { ORDER_TABLES } from '../../src/connectors/vtex/tables.js'

const profile = { id: 'u-1', first_name: 'Maria', email: 'maria@exemplo.com', document: '00000000000', type: 'cpf' }
const buyer = { id: 1, name: 'Maria', email: 'maria@exemplo.com', document: '00000000000', document_type: 'CPF' }

describe('máscara de dado pessoal por modo do destino', () => {
	it('modo local: VTEX grava o texto fixo no lugar do dado pessoal', () => {
		const [row] = maskVtex(ORDER_TABLES.clientProfile, [profile], 'local')

		expect(row).toMatchObject({
			id: 'u-1',
			first_name: VTEX_MASK,
			email: VTEX_MASK,
			document: VTEX_MASK,
			type: 'cpf'
		})
	})

	it('modo local: AnyMarket grava o texto fixo no lugar do dado pessoal', () => {
		const [row] = maskAnymarket(ANYMARKET_TABLES.buyer, [buyer], 'local')

		expect(row).toMatchObject({
			name: ANYMARKET_MASK,
			email: ANYMARKET_MASK,
			document: ANYMARKET_MASK,
			document_type: 'CPF'
		})
	})

	it('modo produção: VTEX grava o dado como o ETL antigo (o Power BI precisa dele)', () => {
		expect(maskVtex(ORDER_TABLES.clientProfile, [profile], 'production')).toEqual([profile])
	})

	it('modo produção: AnyMarket grava o dado como o ETL antigo', () => {
		expect(maskAnymarket(ANYMARKET_TABLES.buyer, [buyer], 'production')).toEqual([buyer])
	})

	it('sem modo explícito, vale o env: nos testes (sem TARGET_MODE) é local e mascara', () => {
		const [row] = maskVtex(ORDER_TABLES.clientProfile, [profile])

		expect(row?.email).toBe(VTEX_MASK)
	})
})
