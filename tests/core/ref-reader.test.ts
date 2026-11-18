import { describe, expect, it } from 'vitest'

import type { iConnectionSource } from '../../src/core/db/connection.js'
import { assertReadOnlySql, createRefReader } from '../../src/core/db/ref-reader.js'
import { SafetyError } from '../../src/core/errors.js'

/** Conexão falsa que registra cada SQL. Nenhum banco real é usado. */
const fakeSource = () => {
	const queries: string[] = []
	let released = 0
	const source: iConnectionSource = {
		getConnection: async () => ({
			query: async (sql: string) => {
				queries.push(sql)

				if (sql.startsWith('SHOW CREATE TABLE')) return [[{ 'Create Table': 'CREATE TABLE `x` (id int)' }], []]

				return [[{ ok: 1 }], []]
			},
			release: () => {
				released += 1
			}
		})
	}

	return { source, queries, released: () => released }
}

describe('ref-reader: banco da cliente só em leitura', () => {
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
		['SELECT 1 /* ; DELETE */', 'comentário no meio'],
		['SELECT * FROM vtex_orders INTO OUTFILE "/tmp/x"', 'INTO OUTFILE'],
		['SELECT * FROM vtex_orders FOR UPDATE', 'FOR UPDATE'],
		['SELECT * FROM vtex_orders LOCK IN SHARE MODE', 'LOCK IN SHARE MODE'],
		['SELECT SLEEP(100)', 'SLEEP'],
		['SELECT * FROM telescope_entries', 'tabela do Laravel'],
		['SELECT * FROM failed_jobs', 'tabela do Laravel']
	])('recusa %s (%s)', sql => {
		expect(() => assertReadOnlySql(sql)).toThrow(SafetyError)
	})

	it('roda cada consulta dentro de transação READ ONLY e termina em ROLLBACK', async () => {
		const fake = fakeSource()
		const reader = createRefReader(fake.source)

		await reader.query('SELECT 1 AS ok')

		expect(fake.queries).toEqual([
			'SET SESSION max_execution_time = ?',
			'START TRANSACTION READ ONLY',
			'SELECT 1 AS ok',
			'ROLLBACK'
		])
		expect(fake.released()).toBe(1)
	})

	it('não abre conexão quando o SQL é recusado', async () => {
		const fake = fakeSource()
		const reader = createRefReader(fake.source)

		await expect(reader.query('DELETE FROM vtex_orders')).rejects.toThrow(SafetyError)
		expect(fake.queries).toEqual([])
	})

	it('schema:pull só lê tabelas da lista dos jobs e nunca as do Laravel', async () => {
		const fake = fakeSource()
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
