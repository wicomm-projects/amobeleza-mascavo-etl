import { describe, expect, it } from 'vitest'

import { assertReadOnlyGrants, assertReadOnlySql, createRefReader } from '../../src/core/db/ref-reader.js'
import { SafetyError } from '../../src/core/errors.js'

import { fakeReference } from './fakes.js'

describe('ref-reader: SQL aceito no banco da cliente', () => {
	it.each([
		'SELECT 1',
		'select order_id, status from vtex_orders where order_id in (?)',
		'  SELECT * FROM sheets_google_drive_users WHERE `Date` BETWEEN ? AND ?',
		'SHOW CREATE TABLE `mascavo_etl`.`vtex_orders`',
		'SHOW GRANTS'
	])('aceita leitura: %s', sql => {
		expect(() => assertReadOnlySql(sql)).not.toThrow()
	})

	it.each([
		['INSERT INTO vtex_orders VALUES (1)', 'INSERT'],
		['UPDATE vtex_orders SET status = 1', 'UPDATE'],
		['DELETE FROM vtex_orders', 'DELETE'],
		['DROP TABLE vtex_orders', 'DROP'],
		['ALTER TABLE vtex_orders ADD x int', 'ALTER'],
		['TRUNCATE vtex_orders', 'TRUNCATE'],
		['REPLACE INTO vtex_orders VALUES (1)', 'REPLACE'],
		['SET GLOBAL read_only = 0', 'SET'],
		['CALL limpa()', 'CALL'],
		['LOAD DATA INFILE "x" INTO TABLE vtex_orders', 'LOAD'],
		['SELECT 1; DROP TABLE vtex_orders', 'dois comandos'],
		['/* SELECT */ DELETE FROM vtex_orders', 'comando escondido atrás de comentário'],
		['/*!CREATE TABLE mascavo_etl.t2 AS */ SELECT 1 AS x', 'comentário executável com DDL no começo'],
		['/*!80000 CREATE OR REPLACE VIEW mascavo_etl.v AS */ SELECT 1', 'comentário executável versionado'],
		['SELECT 1 /*!, (SELECT 1) */', 'comentário executável no meio'],
		['-- x\nSELECT 1', 'comentário de linha'],
		['# x\nSELECT 1', 'comentário com #'],
		['SELECT * FROM vtex_orders INTO OUTFILE "/tmp/x"', 'INTO OUTFILE'],
		['SELECT * FROM vtex_orders FOR UPDATE', 'FOR UPDATE'],
		['SELECT * FROM vtex_orders LOCK IN SHARE MODE', 'LOCK IN SHARE MODE'],
		['SELECT SLEEP(100)', 'SLEEP'],
		["SELECT LOAD_FILE('/etc/passwd')", 'LOAD_FILE'],
		['SELECT * FROM telescope_entries', 'tabela do Laravel'],
		['SELECT * FROM `failed_jobs`', 'tabela do Laravel com crase']
	])('recusa %s (%s)', sql => {
		expect(() => assertReadOnlySql(sql)).toThrow(SafetyError)
	})
})

describe('ref-reader: usuário de leitura comprovado por SHOW GRANTS', () => {
	it.each([
		[['GRANT USAGE ON *.* TO `leitura`@`%`', 'GRANT SELECT ON `mascavo_etl`.* TO `leitura`@`%`']],
		[['GRANT SELECT, SHOW VIEW ON `amobeleza_etl`.* TO `leitura`@`%`']],
		[['GRANT SELECT (order_id, status) ON `mascavo_etl`.`vtex_orders` TO `leitura`@`%`']]
	])('aceita usuário só leitura: %j', grants => {
		expect(() => assertReadOnlyGrants(grants)).not.toThrow()
	})

	it.each([
		[['GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION'], 'root'],
		[['GRANT SELECT, INSERT, UPDATE, DELETE ON `mascavo_etl`.* TO `etl`@`%`'], 'escrita'],
		[['GRANT SELECT, CREATE, CREATE VIEW ON `mascavo_etl`.* TO `etl`@`%`'], 'DDL'],
		[['GRANT SELECT ON `mascavo_etl`.* TO `etl`@`%` WITH GRANT OPTION'], 'GRANT OPTION'],
		[['GRANT SELECT ON *.* TO `etl`@`%`', 'GRANT `dba_role`@`%` TO `etl`@`%`'], 'role'],
		[['GRANT EXECUTE, TRIGGER, EVENT ON `mascavo_etl`.* TO `etl`@`%`'], 'rotinas'],
		[['GRANT FILE, SUPER ON *.* TO `etl`@`%`'], 'globais'],
		[['GRANT BACKUP_ADMIN ON *.* TO `etl`@`%`'], 'dinâmico do MySQL 8'],
		[["GRANT PROXY ON ''@'' TO `etl`@`%`"], 'PROXY'],
		[[], 'vazio']
	])('recusa %j (%s)', grants => {
		expect(() => assertReadOnlyGrants(grants)).toThrow(SafetyError)
	})

	it('confere os grants uma vez e depois roda a consulta em sessão e transação READ ONLY, com ROLLBACK', async () => {
		const fake = fakeReference()
		const reader = createRefReader(fake.source)

		await reader.query('SELECT 1 AS ok')
		await reader.query('SELECT 2 AS ok')

		const session = [
			'SET SESSION TRANSACTION READ ONLY',
			'SET SESSION max_execution_time = ?',
			'START TRANSACTION READ ONLY'
		]

		expect(fake.queries).toEqual([
			...session,
			'SHOW GRANTS',
			'ROLLBACK',
			...session,
			'SELECT 1 AS ok',
			'ROLLBACK',
			...session,
			'SELECT 2 AS ok',
			'ROLLBACK'
		])
		expect(fake.released()).toBe(3)
	})

	it('recusa trabalhar quando o usuário pode gravar: a consulta nem chega ao servidor', async () => {
		const fake = fakeReference(['GRANT SELECT, INSERT ON `mascavo_etl`.* TO `etl`@`%`'])
		const reader = createRefReader(fake.source)

		await expect(reader.query('SELECT 1 AS ok')).rejects.toThrow(SafetyError)
		expect(fake.queries).not.toContain('SELECT 1 AS ok')
	})

	it('não abre conexão quando o SQL é recusado', async () => {
		const fake = fakeReference()
		const reader = createRefReader(fake.source)

		await expect(reader.query('DELETE FROM vtex_orders')).rejects.toThrow(SafetyError)
		expect(fake.queries).toEqual([])
	})

	it('schema:pull só lê tabelas da lista dos jobs e nunca as do Laravel', async () => {
		const fake = fakeReference()
		const reader = createRefReader(fake.source)
		const allowed = new Set(['vtex_orders'])

		await expect(reader.showCreateTable('mascavo_etl', 'vtex_order_items', allowed)).rejects.toThrow(SafetyError)
		await expect(
			reader.showCreateTable('mascavo_etl', 'telescope_entries', new Set(['telescope_entries']))
		).rejects.toThrow(SafetyError)
		await expect(reader.showCreateTable('mascavo_etl', 'x`; DROP', allowed)).rejects.toThrow(SafetyError)
		expect(fake.queries).toEqual([])

		await expect(reader.showCreateTable('mascavo_etl', 'vtex_orders', allowed)).resolves.toContain('CREATE TABLE')
	})
})
