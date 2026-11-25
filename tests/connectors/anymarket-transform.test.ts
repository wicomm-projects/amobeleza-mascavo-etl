import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { orderSchema, ordersPageSchema } from '../../src/connectors/anymarket/schemas.js'
import { toOrderRows } from '../../src/connectors/anymarket/transform.js'

/** Exemplo público da documentação do AnyMarket (nenhum dado da cliente). */
const FIXTURE = path.resolve('src/connectors/anymarket/fixtures/orders-page.json')

const firstOrder = () => {
	const page = ordersPageSchema.parse(JSON.parse(readFileSync(FIXTURE, 'utf8')))
	const [order] = page.content

	if (!order) throw new Error('fixture sem pedido')

	return orderSchema.parse(order)
}

describe('metadata do pedido AnyMarket (grafia da API, paridade de 25/11/2026)', () => {
	it('system_origin vira meta_data_system_origin, como o ETL antigo gravava', () => {
		const order = { ...firstOrder(), metadata: { system_origin: 'Amazon Global Api' } }

		expect(toOrderRows(order).order.meta_data_system_origin).toBe('Amazon Global Api')
	})

	it('ShippingTypeToSend (S maiúsculo) fica vazio, igual ao ETL antigo', () => {
		const order = { ...firstOrder(), metadata: { ShippingTypeToSend: 'NORMAL' } }

		expect(toOrderRows(order).order.meta_data_shipping_type_to_send).toBeNull()
	})
})

describe('pagamentos do pedido AnyMarket (decisão AMO-Q34)', () => {
	it('grava só o último pagamento, como o ETL antigo', () => {
		const order = {
			...firstOrder(),
			payments: [
				{ method: 'visa', status: 'APPROVED', value: 100 },
				{ method: 'master', status: 'APPROVED', value: 50 }
			]
		}
		const { payments } = toOrderRows(order)

		expect(payments).toHaveLength(1)
		expect(payments[0]).toMatchObject({ method: 'master', value: 50 })
	})

	it('pedido sem pagamento continua sem linha', () => {
		expect(toOrderRows({ ...firstOrder(), payments: [] }).payments).toEqual([])
	})
})
