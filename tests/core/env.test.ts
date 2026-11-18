import { describe, expect, it } from 'vitest'

import { parseEnv } from '../../src/config/env.js'

describe('env: travas de configuração', () => {
	it('aceita env vazio: todas as fontes ficam aguardando chave', () => {
		const env = parseEnv({})

		expect(env.TARGET_DB_HOST).toBe('127.0.0.1')
		expect(env.VTEX_MASCAVO_APP_KEY).toBeUndefined()
		expect(env.SCHEDULER_ENABLED).toBe(false)
	})

	it.each(['root', 'ROOT', 'Root'])('recusa o usuário %s no banco de destino', user => {
		expect(() => parseEnv({ TARGET_DB_USER: user, TARGET_DB_PASSWORD: 'x' })).toThrow(/root nunca/)
	})

	it('recusa o usuário root no banco de referência (cliente)', () => {
		expect(() => parseEnv({ REF_DB_HOST: 'db.exemplo', REF_DB_USER: 'root', REF_DB_PASSWORD: 'x' })).toThrow(
			/root nunca/
		)
	})

	it.each(['10.0.0.5', 'db.cliente.com.br', '0.0.0.0', 'mysql'])('recusa destino fora do MySQL local: %s', host => {
		expect(() => parseEnv({ TARGET_DB_HOST: host })).toThrow(/MySQL local/)
	})

	it.each(['127.0.0.1', 'localhost', '::1'])('aceita destino local: %s', host => {
		expect(parseEnv({ TARGET_DB_HOST: host }).TARGET_DB_HOST).toBe(host)
	})

	it('recusa servidor HTTP fora de loopback', () => {
		expect(() => parseEnv({ HOST: '0.0.0.0' })).toThrow(/loopback/)
	})

	it('recusa grupo VTEX preenchido pela metade', () => {
		expect(() => parseEnv({ VTEX_MASCAVO_APP_KEY: 'chave' })).toThrow(/VTEX Mascavo.*incompleto/)
	})

	it('recusa destino com usuário sem senha', () => {
		expect(() => parseEnv({ TARGET_DB_USER: 'etl_local' })).toThrow(/banco de destino.*incompleto/)
	})

	it('recusa propriedade GA4 sem o JSON da conta de serviço', () => {
		expect(() => parseEnv({ GA4_MASCAVO_PROPERTY_ID: '123' })).toThrow(/conta de serviço/)
	})

	it('recusa ID de propriedade GA4 não numérico', () => {
		expect(() => parseEnv({ GA4_MASCAVO_PROPERTY_ID: 'G-ABC123' })).toThrow(/numérico/)
	})
})
