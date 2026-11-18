import mysql, { type Pool } from 'mysql2/promise'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkLocalTarget } from '../../src/core/db/guarded.js'
import { closePools } from '../../src/core/db/pools.js'
import { prepareReadOnlySession } from '../../src/core/db/ref-reader.js'
import { createWriter } from '../../src/core/db/writer.js'

/**
 * Integração com o MySQL LOCAL do docker-compose (npm run db:up). Prova no servidor real o que os testes unitários só
 * provam com conexão falsa. Nunca aponta para outro banco: as travas do próprio código recusariam.
 *
 * O usuário etl_local TEM permissão de CREATE/INSERT em mascavo_etl — então, se uma escrita falha aqui, foi a sessão
 * só leitura que barrou, não falta de permissão (o primeiro teste prova isso).
 */

const PROBE_TABLE = 'it_probe'
const PROBE_VIEW = 'it_probe_view'
const ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION = 1792

let pool: Pool

const connectionOptions = () => ({
	host: '127.0.0.1',
	port: Number(process.env.TARGET_DB_PORT ?? 3307),
	user: process.env.TARGET_DB_USER ?? 'etl_local',
	password: process.env.TARGET_DB_PASSWORD ?? 'etl_local_dev',
	timezone: 'Z' as const
})

const dropProbes = async () => {
	await pool.query(`DROP VIEW IF EXISTS mascavo_etl.${PROBE_VIEW}`)
	await pool.query(`DROP TABLE IF EXISTS mascavo_etl.${PROBE_TABLE}`)
	await pool.query(`DROP TABLE IF EXISTS mascavo_etl.${PROBE_TABLE}_ctas`)
}

beforeAll(async () => {
	pool = mysql.createPool({ ...connectionOptions(), connectionLimit: 2 })
	await dropProbes()
})

afterAll(async () => {
	await dropProbes()
	await pool.end()
	await closePools()
})

describe('MySQL local: sessão só leitura do ref-reader', () => {
	it('sem a sessão só leitura, o usuário consegue criar tabela (prova que o bloqueio abaixo é da sessão)', async () => {
		await pool.query(`CREATE TABLE mascavo_etl.${PROBE_TABLE} (id int)`)
		await pool.query(`DROP TABLE mascavo_etl.${PROBE_TABLE}`)
	})

	it.each([
		['CREATE TABLE ... AS SELECT', `CREATE TABLE mascavo_etl.${PROBE_TABLE}_ctas AS SELECT 1 AS x`],
		['CREATE OR REPLACE VIEW', `CREATE OR REPLACE VIEW mascavo_etl.${PROBE_VIEW} AS SELECT 1 AS x`],
		['CREATE TABLE', `CREATE TABLE mascavo_etl.${PROBE_TABLE} (id int)`]
	])('com a sessão só leitura, o servidor recusa %s', async (_label, sql) => {
		// Conexão descartável: a sessão só leitura fica na conexão, então ela não volta para o pool do teste.
		const raw = await mysql.createConnection(connectionOptions())
		const connection = {
			query: async (statement: string, params?: unknown[]) =>
				raw.query(statement, params) as Promise<[unknown, unknown]>,
			release: () => undefined
		}

		try {
			await prepareReadOnlySession(connection)
			await connection.query('START TRANSACTION READ ONLY')
			await expect(connection.query(sql)).rejects.toMatchObject({
				errno: ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION
			})
		} finally {
			await raw.end()
		}

		const [rows] = await pool.query(
			'SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ? AND table_name LIKE ?',
			['mascavo_etl', `${PROBE_TABLE}%`]
		)

		expect((rows as { total: number }[])[0]?.total).toBe(0)
	})
})

describe('MySQL local: identidade e gravação', () => {
	it('o Docker local passa na conferência de identidade (marcador, hostname, usuário, grants)', async () => {
		await expect(checkLocalTarget()).resolves.toBeUndefined()
	})

	it('o writer grava, atualiza e reescreve janela no banco local, com datas em UTC', async () => {
		await pool.query(
			`CREATE TABLE mascavo_etl.${PROBE_TABLE} (order_id varchar(32) NOT NULL PRIMARY KEY, status varchar(32), ` +
				'total_value decimal(10,2), order_date datetime, created_at timestamp NULL, updated_at timestamp NULL)'
		)

		const writer = createWriter({ database: 'mascavo_etl', tables: [PROBE_TABLE], dryRun: false })

		await writer.transaction(tx =>
			tx.replaceByKeys(
				PROBE_TABLE,
				'order_id',
				['A-01', 'B-01'],
				[
					{
						order_id: 'A-01',
						status: 'invoiced',
						total_value: 12345,
						order_date: new Date('2026-11-01T03:30:00Z')
					},
					{
						order_id: 'B-01',
						status: 'canceled',
						total_value: 500,
						order_date: new Date('2026-11-03T23:10:00Z')
					}
				]
			)
		)
		await writer.transaction(tx =>
			tx.upsert(
				PROBE_TABLE,
				[
					{
						order_id: 'A-01',
						status: 'payment-approved',
						total_value: 999,
						order_date: new Date('2026-11-01T03:30:00Z')
					}
				],
				{ keyColumns: ['order_id'] }
			)
		)
		// Janela 01..03 com DATETIME: a linha das 23:10 do dia 03 também é apagada e reinserida (sem duplicar).
		await writer.transaction(tx =>
			tx.replaceDateWindow(PROBE_TABLE, 'order_date', '2026-11-01', '2026-11-03', [
				{ order_id: 'C-01', status: 'invoiced', total_value: 1, order_date: '2026-11-03 23:59:59' }
			])
		)

		const [rows] = await pool.query(
			`SELECT order_id, status, DATE_FORMAT(order_date, '%Y-%m-%d %H:%i:%s') AS order_date FROM mascavo_etl.${PROBE_TABLE} ORDER BY order_id`
		)

		expect(rows).toEqual([{ order_id: 'C-01', status: 'invoiced', order_date: '2026-11-03 23:59:59' }])
	})
})
