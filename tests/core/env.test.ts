import { describe, expect, it } from 'vitest'

import { parseEnv } from '../../src/config/env.js'
import { PRODUCTION_TARGET } from '../../src/config/production-target.js'

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

/** Endereço de documentação (RFC 5737): o host real da produção só existe no .env da VPS. */
const CLIENT_HOST = '203.0.113.20'

describe('env: modo do destino (TARGET_MODE)', () => {
	// Como a VPS em 28/11/2026: só a Mascavo liberada (com os dois bancos, TARGET_JOBS e ANYMARKET_ACCOUNTS são exigidos).
	const production = {
		TARGET_MODE: 'production',
		TARGET_DATABASES: 'mascavo_etl',
		TARGET_DB_HOST: CLIENT_HOST,
		TARGET_DB_PORT: String(PRODUCTION_TARGET.port),
		TARGET_DB_USER: PRODUCTION_TARGET.user,
		TARGET_DB_PASSWORD: 'x'
	}

	it('sem TARGET_MODE, o modo é local', () => {
		expect(parseEnv({}).TARGET_MODE).toBe('local')
	})

	it('recusa valor desconhecido em TARGET_MODE (erro de digitação não vira produção nem passa calado)', () => {
		expect(() => parseEnv({ TARGET_MODE: 'producao' })).toThrow(/TARGET_MODE/)
	})

	it('no modo local, o host da produção continua recusado', () => {
		expect(() => parseEnv({ ...production, TARGET_MODE: 'local' })).toThrow(/MySQL local/)
	})

	it('aceita o modo produção com o host do .env e porta e usuário da produção', () => {
		const env = parseEnv(production)

		expect(env.TARGET_MODE).toBe('production')
		expect(env.TARGET_DB_HOST).toBe(CLIENT_HOST)
	})

	it.each(['127.0.0.1', 'localhost', '::1'])(
		'no modo produção, recusa loopback (túnel do computador do dev): %s',
		host => {
			expect(() => parseEnv({ ...production, TARGET_DB_HOST: host })).toThrow(/nunca loopback/)
		}
	)

	it('no modo produção, recusa porta diferente', () => {
		expect(() => parseEnv({ ...production, TARGET_DB_PORT: '3307' })).toThrow(/TARGET_DB_PORT/)
	})

	it.each(['dbeaver', 'wicomm_leitura', 'etl_local'])('no modo produção, recusa o usuário %s', user => {
		expect(() => parseEnv({ ...production, TARGET_DB_USER: user })).toThrow(/wicomm_etl/)
	})

	it('no modo produção, o root continua recusado', () => {
		expect(() => parseEnv({ ...production, TARGET_DB_USER: 'root' })).toThrow(/root nunca/)
	})

	it('no modo produção, exige usuário e senha', () => {
		expect(() => parseEnv({ TARGET_MODE: 'production', TARGET_DB_HOST: CLIENT_HOST })).toThrow(/TARGET_DB_USER/)
	})
})

describe('env: bancos que o ETL pode gravar (TARGET_DATABASES)', () => {
	it('sem a variável, os dois bancos (comportamento de antes)', () => {
		expect(parseEnv({}).TARGET_DATABASES).toEqual(['mascavo_etl', 'amobeleza_etl'])
	})

	it('aceita só a Mascavo, com espaços em volta', () => {
		expect(parseEnv({ TARGET_DATABASES: ' mascavo_etl ' }).TARGET_DATABASES).toEqual(['mascavo_etl'])
	})

	it('aceita os dois separados por vírgula', () => {
		expect(parseEnv({ TARGET_DATABASES: 'mascavo_etl, amobeleza_etl' }).TARGET_DATABASES).toEqual([
			'mascavo_etl',
			'amobeleza_etl'
		])
	})

	it.each(['outro_banco', 'mascavo', 'mascavo_etl,amobeleza'])('recusa banco desconhecido: %s', value => {
		expect(() => parseEnv({ TARGET_DATABASES: value })).toThrow(/TARGET_DATABASES/)
	})

	it('recusa a variável vazia (vazio não pode virar "todos" nem "nenhum" calado)', () => {
		expect(() => parseEnv({ TARGET_DATABASES: '' })).toThrow(/TARGET_DATABASES/)
	})
})

describe('env: TARGET_JOBS e ANYMARKET_ACCOUNTS', () => {
	it('sem as variáveis: todos os jobs e todas as contas (undefined)', () => {
		const env = parseEnv({})

		expect(env.TARGET_JOBS).toBeUndefined()
		expect(env.ANYMARKET_ACCOUNTS).toBeUndefined()
	})

	it('TARGET_JOBS aceita "job" e "job:marca", separados por vírgula', () => {
		expect(parseEnv({ TARGET_JOBS: ' vtex-orders:mascavo , anymarket-orders ' }).TARGET_JOBS).toEqual([
			'vtex-orders:mascavo',
			'anymarket-orders'
		])
	})

	it.each(['vtex orders', 'vtex-orders:', ':mascavo', 'VTEX-ORDERS'])(
		'TARGET_JOBS recusa formato inválido: %s',
		value => {
			expect(() => parseEnv({ TARGET_JOBS: value })).toThrow(/TARGET_JOBS/)
		}
	)

	it('ANYMARKET_ACCOUNTS guarda os nomes exatos das contas', () => {
		expect(parseEnv({ ANYMARKET_ACCOUNTS: 'MASCAVO' }).ANYMARKET_ACCOUNTS).toEqual(['MASCAVO'])
	})

	it.each(['TARGET_JOBS', 'ANYMARKET_ACCOUNTS'])(
		'%s presente e vazio é erro (vazio não pode virar "todos")',
		name => {
			expect(() => parseEnv({ [name]: '  ' })).toThrow(new RegExp(name))
		}
	)
})

describe('env: banco da Amobeleza liberado em produção exige TARGET_JOBS e ANYMARKET_ACCOUNTS', () => {
	const production = {
		TARGET_MODE: 'production',
		TARGET_DB_HOST: '203.0.113.20',
		TARGET_DB_PORT: String(PRODUCTION_TARGET.port),
		TARGET_DB_USER: PRODUCTION_TARGET.user,
		TARGET_DB_PASSWORD: 'x'
	}
	const BOTH = 'mascavo_etl,amobeleza_etl'
	const MASCAVO_JOBS = 'vtex-orders:mascavo,vtex-catalog:mascavo,ga4:mascavo,anymarket-orders'

	it('só a Mascavo liberada: as variáveis novas continuam opcionais', () => {
		expect(() => parseEnv({ ...production, TARGET_DATABASES: 'mascavo_etl' })).not.toThrow()
	})

	it('Amobeleza liberada sem TARGET_JOBS: erro (não vira "todos" calado)', () => {
		expect(() => parseEnv({ ...production, TARGET_DATABASES: BOTH, ANYMARKET_ACCOUNTS: 'MASCAVO' })).toThrow(
			/TARGET_JOBS/
		)
	})

	it('Amobeleza liberada sem ANYMARKET_ACCOUNTS: erro', () => {
		expect(() => parseEnv({ ...production, TARGET_DATABASES: BOTH, TARGET_JOBS: MASCAVO_JOBS })).toThrow(
			/ANYMARKET_ACCOUNTS/
		)
	})

	it('sem TARGET_DATABASES (padrão: os dois bancos) em produção também exige as duas', () => {
		expect(() => parseEnv(production)).toThrow(/TARGET_JOBS/)
	})

	it('com as três variáveis: aceita', () => {
		expect(() =>
			parseEnv({
				...production,
				TARGET_DATABASES: BOTH,
				TARGET_JOBS: MASCAVO_JOBS,
				ANYMARKET_ACCOUNTS: 'MASCAVO'
			})
		).not.toThrow()
	})

	it('"*" libera tudo de forma explícita (para quando a Amobeleza for liberada)', () => {
		const env = parseEnv({ ...production, TARGET_DATABASES: BOTH, TARGET_JOBS: '*', ANYMARKET_ACCOUNTS: '*' })

		expect(env.TARGET_JOBS).toEqual(['*'])
		expect(env.ANYMARKET_ACCOUNTS).toEqual(['*'])
	})

	it('no modo local não exige nada', () => {
		expect(() => parseEnv({ TARGET_DATABASES: BOTH })).not.toThrow()
	})

	it.each(['ANYMARKET_ACCOUNT', 'TARGET_JOB', 'TARGET_DATABASE'])(
		'recusa variável com nome parecido e desconhecido: %s',
		name => {
			expect(() => parseEnv({ [name]: 'MASCAVO' })).toThrow(new RegExp(name))
		}
	)
})
