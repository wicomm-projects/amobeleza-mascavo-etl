import { describe, expect, it } from 'vitest'

import { guardedTargetSource } from '../../src/core/db/guarded.js'
import { applySchemas } from '../../src/core/db/schema-files.js'
import { assertProductionGrants, assertTarget } from '../../src/core/db/target-guard.js'
import { createWriter } from '../../src/core/db/writer.js'
import { SafetyError } from '../../src/core/errors.js'

import { fakeProductionTarget, fakeTarget, type tProductionScenario } from './fakes.js'

const writes = (queries: string[]) => queries.filter(sql => /^(INSERT|DELETE|START|COMMIT)/.test(sql))

const now = () => new Date('2026-11-27T12:00:00.000Z')

const USER = '`wicomm_etl`@`203.0.113.10`'

const NOT_PRODUCTION: tProductionScenario[] = [
	'other-hostname',
	'other-uuid',
	'other-user',
	'wildcard-host',
	'dbeaver-grants',
	'schema-wide-grant',
	'ddl-on-table',
	'grant-option',
	'role',
	'no-tls'
]

describe('grants do usuário de produção (wicomm_etl)', () => {
	it('aceita USAGE global e SELECT/INSERT/UPDATE/DELETE tabela por tabela nos dois bancos', () => {
		expect(() =>
			assertProductionGrants([
				`GRANT USAGE ON *.* TO ${USER}`,
				`GRANT SELECT, INSERT, UPDATE, DELETE ON \`mascavo_etl\`.\`vtex_orders\` TO ${USER}`,
				`GRANT SELECT, INSERT ON \`amobeleza_etl\`.\`anymarket_orders\` TO ${USER}`
			])
		).not.toThrow()
	})

	it.each([
		`GRANT ALL PRIVILEGES ON *.* TO ${USER} WITH GRANT OPTION`,
		`GRANT SELECT ON *.* TO ${USER}`,
		`GRANT SELECT, INSERT ON \`mascavo_etl\`.* TO ${USER}`,
		`GRANT ALL PRIVILEGES ON \`mascavo_etl\`.\`vtex_orders\` TO ${USER}`,
		`GRANT SELECT, DROP ON \`mascavo_etl\`.\`vtex_orders\` TO ${USER}`,
		`GRANT ALTER ON \`amobeleza_etl\`.\`anymarket_orders\` TO ${USER}`,
		`GRANT CREATE ON \`amobeleza_etl\`.\`anymarket_orders\` TO ${USER}`,
		`GRANT SELECT ON \`mascavo_etl\`.\`vtex_orders\` TO ${USER} WITH GRANT OPTION`,
		`GRANT SELECT ON \`outro_banco\`.\`vtex_orders\` TO ${USER}`,
		`GRANT SELECT, INSERT ON \`mascavo_etl\`.\`failed_jobs\` TO ${USER}`,
		`GRANT SELECT, INSERT ON \`mascavo_etl\`.\`telescope_entries\` TO ${USER}`,
		`GRANT \`dba\`@\`%\` TO ${USER}`,
		`GRANT PROXY ON ''@'' TO ${USER}`,
		`GRANT PROXY ON \`\`@\`\` TO ${USER}`,
		`GRANT BACKUP_ADMIN ON *.* TO ${USER}`,
		`GRANT BACKUP_ADMIN,BINLOG_ADMIN ON *.* TO ${USER}`,
		`GRANT SELECT (\`order_id\`), INSERT ON \`mascavo_etl\`.\`vtex_orders\` TO ${USER}`,
		`GRANT EXECUTE ON PROCEDURE \`mascavo_etl\`.\`limpa\` TO ${USER}`,
		`GRANT SELECT, INSERT ON \`etl_local_meta\`.\`marker\` TO ${USER}`
	])('recusa %s', line => {
		expect(() => assertProductionGrants([line])).toThrow(SafetyError)
	})
})

describe('destino no modo produção', () => {
	it('banco da cliente com o wicomm_etl: passa', async () => {
		const fake = fakeProductionTarget('production')
		const connection = await fake.source.getConnection()

		await expect(assertTarget(connection, 'production')).resolves.toBeUndefined()
	})

	it.each(NOT_PRODUCTION)('recusa %s', async scenario => {
		const fake = fakeProductionTarget(scenario)
		const connection = await fake.source.getConnection()

		await expect(assertTarget(connection, 'production')).rejects.toThrow(SafetyError)
	})

	it('o Docker local não passa como produção (hostname e uuid não são os da cliente)', async () => {
		const fake = fakeTarget('local')
		const connection = await fake.source.getConnection()

		await expect(assertTarget(connection, 'production')).rejects.toThrow(/não é o banco de produção esperado/)
	})

	it('a produção não passa como Docker local (modo local continua igual)', async () => {
		const fake = fakeProductionTarget('production')
		const connection = await fake.source.getConnection()

		await expect(assertTarget(connection, 'local')).rejects.toThrow(SafetyError)
	})
})

describe('writer no modo produção', () => {
	it('grava na produção com o wicomm_etl, dentro de uma transação', async () => {
		const fake = fakeProductionTarget('production')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_orders'], dryRun: false },
			{ source: fake.source, now, mode: 'production' }
		)

		await writer.transaction(tx => tx.replaceByKeys('vtex_orders', 'order_id', ['1-01'], [{ order_id: '1-01' }]))

		expect(writes(fake.queries)[0]).toBe('START TRANSACTION')
		expect(writes(fake.queries).at(-1)).toBe('COMMIT')
	})

	it.each(NOT_PRODUCTION)('destino que não é o esperado (%s): recusa e não grava nada', async scenario => {
		const fake = fakeProductionTarget(scenario)
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_orders'], dryRun: false },
			{ source: fake.source, now, mode: 'production' }
		)

		await expect(
			writer.transaction(tx => tx.replaceByKeys('vtex_orders', 'order_id', ['1-01'], [{ order_id: '1-01' }]))
		).rejects.toThrow(SafetyError)

		expect(writes(fake.queries)).toEqual([])
	})

	it('apontado para o Docker local no modo produção: recusa e não grava nada', async () => {
		const fake = fakeTarget('local')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_orders'], dryRun: false },
			{ source: fake.source, now, mode: 'production' }
		)

		await expect(
			writer.transaction(tx => tx.replaceByKeys('vtex_orders', 'order_id', ['1-01'], [{ order_id: '1-01' }]))
		).rejects.toThrow(SafetyError)

		expect(writes(fake.queries)).toEqual([])
	})

	it('a lista de tabelas do job continua valendo na produção', async () => {
		const fake = fakeProductionTarget('production')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_orders'], dryRun: false },
			{ source: fake.source, now, mode: 'production' }
		)

		await expect(
			writer.transaction(tx => tx.replaceByKeys('vtex_products', 'id', ['1'], [{ id: '1' }]))
		).rejects.toThrow(SafetyError)

		expect(fake.queries).toContain('ROLLBACK')
		expect(fake.queries).not.toContain('COMMIT')
	})

	it('a conexão protegida (lock e check-access) também confere a produção', async () => {
		const ok = guardedTargetSource(fakeProductionTarget('production').source, 'production')

		await expect(ok.getConnection()).resolves.toBeDefined()

		const wrong = guardedTargetSource(fakeProductionTarget('dbeaver-grants').source, 'production')

		await expect(wrong.getConnection()).rejects.toThrow(SafetyError)
	})
})

describe('db:apply nunca roda na produção', () => {
	it('recusa no modo produção antes de abrir conexão', async () => {
		const fake = fakeProductionTarget('production')
		const files = [{ database: 'mascavo_etl' as const, table: 'vtex_orders', file: 'x.sql' }]

		await expect(applySchemas(files, fake.source, 'production')).rejects.toThrow(SafetyError)
		expect(fake.queries).toEqual([])
	})
})
