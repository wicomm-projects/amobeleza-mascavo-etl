import { describe, expect, it } from 'vitest'

import { classifyChange, hasChanged } from '../../src/connectors/vtex/orders-job.js'
import type { tListOrder } from '../../src/connectors/vtex/schemas.js'

/**
 * Regra de "pedido mudou" (VTEX). O gravado é o lastChange do detalhe, em "AAAA-MM-DD HH:MM:SS" UTC. A lista do OMS vem
 * de um índice de busca que pode ficar atrás do detalhe: lista mais antiga que o gravado não é mudança.
 */

const order = (lastChange: string | null): tListOrder => ({ orderId: '1-01', lastChange }) as unknown as tListOrder

const stored = new Map([['1-01', '2026-11-27 18:19:33']])

describe('VTEX: quando buscar o detalhe do pedido de novo', () => {
	it('sem detalhe gravado: novo, busca', () => {
		expect(classifyChange(order('2026-11-27T18:19:33.0000000+00:00'), new Map())).toBe('novo')
	})

	it('lista sem lastChange: busca (não dá para saber)', () => {
		expect(classifyChange(order(null), stored)).toBe('sem lastChange')
	})

	it('lista com data ilegível: busca', () => {
		expect(classifyChange(order('ontem'), stored)).toBe('sem lastChange')
	})

	it('mesmo instante, com fração de segundo e 7 casas: igual, não busca', () => {
		expect(classifyChange(order('2026-11-27T18:19:33.7891234+00:00'), stored)).toBe('igual')
	})

	it('mesmo instante em outro fuso: igual, não busca', () => {
		expect(classifyChange(order('2026-11-27T15:19:33.0000000-03:00'), stored)).toBe('igual')
	})

	it('lista mais nova que o gravado: mudou, busca', () => {
		expect(classifyChange(order('2026-11-27T21:05:10.0000000+00:00'), stored)).toBe('mudou')
	})

	it('lista mais antiga que o gravado (índice atrasado): não busca', () => {
		expect(classifyChange(order('2026-11-27T17:02:00.0000000+00:00'), stored)).toBe('lista mais antiga')
	})

	it('hasChanged só é verdadeiro para novo, sem lastChange e mudou', () => {
		expect(hasChanged(order('2026-11-27T21:05:10.0000000+00:00'), stored)).toBe(true)
		expect(hasChanged(order('2026-11-27T18:19:33.5000000+00:00'), stored)).toBe(false)
		expect(hasChanged(order('2026-11-27T17:02:00.0000000+00:00'), stored)).toBe(false)
		expect(hasChanged(order('2026-11-27T18:19:33.0000000+00:00'), new Map())).toBe(true)
	})
})
