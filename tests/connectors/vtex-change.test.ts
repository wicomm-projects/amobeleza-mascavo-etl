import { describe, expect, it } from 'vitest'

import { classifyChange, hasChanged, listedToWrite } from '../../src/connectors/vtex/orders-job.js'
import type { tListOrder } from '../../src/connectors/vtex/schemas.js'

/**
 * Regra de "pedido mudou" (VTEX). Compara a data da LISTA com a data da lista gravada na carga anterior
 * (vtex_orders.last_change), em "AAAA-MM-DD HH:MM:SS" UTC. Não compara com o detalhe: medido na produção em
 * 28/11/2026, a lista registra a alteração de 1 a 46 segundos depois do detalhe, então lista ≠ detalhe quase sempre.
 */

const order = (lastChange: string | null, orderId = '1-01'): tListOrder =>
	({ orderId, lastChange }) as unknown as tListOrder

const stored = {
	detail: new Map([['1-01', '2026-11-27 18:19:20']]),
	list: new Map([['1-01', '2026-11-27 18:19:33']])
}

describe('VTEX: quando buscar o detalhe do pedido de novo', () => {
	it('sem detalhe gravado: novo, busca', () => {
		expect(classifyChange(order('2026-11-27T18:19:33.0000000+00:00'), { detail: new Map(), list: new Map() })).toBe(
			'novo'
		)
	})

	it('lista sem lastChange ou ilegível: busca', () => {
		expect(classifyChange(order(null), stored)).toBe('sem lastChange')
		expect(classifyChange(order('ontem'), stored)).toBe('sem lastChange')
	})

	it('detalhe gravado mas sem linha em vtex_orders: busca', () => {
		expect(classifyChange(order('2026-11-27T18:19:33.0000000+00:00'), { ...stored, list: new Map() })).toBe(
			'sem lista gravada'
		)
	})

	it('lista igual à da carga anterior (mesmo com 7 casas ou outro fuso): igual, não busca', () => {
		expect(classifyChange(order('2026-11-27T18:19:33.7891234+00:00'), stored)).toBe('igual')
		expect(classifyChange(order('2026-11-27T15:19:33.0000000-03:00'), stored)).toBe('igual')
	})

	it('lista 13 s depois do detalhe, como a VTEX faz, mas igual à anterior: não busca', () => {
		expect(hasChanged(order('2026-11-27T18:19:33.0000000+00:00'), stored)).toBe(false)
	})

	it('lista diferente da anterior (para frente ou para trás): mudou, busca', () => {
		expect(classifyChange(order('2026-11-27T18:19:34.0000000+00:00'), stored)).toBe('mudou')
		expect(classifyChange(order('2026-11-27T18:19:00.0000000+00:00'), stored)).toBe('mudou')
	})
})

describe('VTEX: pedido com detalhe que falhou não tem vtex_orders regravado', () => {
	it('deixa de fora quem precisa ser buscado de novo, para a data antiga da lista continuar gravada', () => {
		const listed = [order('a', '1-01'), order('b', '2-01'), order('c', '3-01')]

		expect(listedToWrite(listed, new Set(['2-01'])).map(item => item.orderId)).toEqual(['1-01', '3-01'])
		expect(listedToWrite(listed, new Set()).map(item => item.orderId)).toEqual(['1-01', '2-01', '3-01'])
	})
})
