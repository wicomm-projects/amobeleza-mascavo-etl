import mysql from 'mysql2/promise'

import type { tDatabase, tTargetMode } from '../../config/index.js'
import { AppError, SafetyError, sanitizeDbError } from '../errors.js'

import { affectedRowsOf, fromPool, type iConnectionSource, type iSqlConnection } from './connection.js'
import { getTargetPool } from './pools.js'
import { isSafeIdentifier } from './tables.js'
import { assertTarget, assertTargetDatabase, assertWritableTable } from './target-guard.js'

/**
 * Gravador do ETL. Reproduz como o ETL antigo da WPP gravava (Plano 2, "Como gravar em cada tabela"):
 * - upsert: INSERT ... ON DUPLICATE KEY UPDATE (tabelas com PK natural: vtex_order_details, vtex_products).
 * - replaceByKeys: apaga as linhas das chaves e insere de novo (vtex_orders e filhas por order_id; item removido some).
 * - replaceDateWindow: apaga a janela de datas e insere de novo (sheets_google_drive_*).
 * - replaceAll: substitui o conteúdo inteiro (tabelas pequenas: vtex_category_tree, ...). DELETE, não TRUNCATE: TRUNCATE
 *   é DDL, faz commit implícito e quebraria a transação.
 *
 * Tudo dentro de `transaction()`: se algo falha no meio, ROLLBACK e o Power BI continua vendo o dado anterior.
 * Antes de abrir a transação, `assertTarget` confere a identidade do destino do modo atual (Docker local ou produção).
 *
 * created_at / updated_at: preenchidos com o horário UTC da carga quando a linha não traz (convenção da WPP). No upsert,
 * created_at nunca é sobrescrito.
 *
 * Dry-run: nenhuma conexão é aberta; só conta o que seria gravado.
 */

type tRow = Record<string, unknown>

type tWriteStrategy = 'upsert' | 'replaceByKeys' | 'replaceDateWindow' | 'replaceAll'

interface iWriteResult {
	database: tDatabase
	table: string
	strategy: tWriteStrategy
	deleted: number
	inserted: number
	dryRun: boolean
}

interface iWriteTx {
	upsert: (table: string, rows: tRow[], options?: { keyColumns?: string[] }) => Promise<iWriteResult>
	replaceByKeys: (
		table: string,
		keyColumn: string,
		keys: readonly (string | number)[],
		rows: tRow[]
	) => Promise<iWriteResult>
	/**
	 * `from` e `to` no formato AAAA-MM-DD, inclusivos (funciona com coluna DATE ou DATETIME). Lote vazio é recusado —
	 * uma API que respondeu vazio por falha apagaria a janela inteira — a menos que `allowEmpty` seja explícito.
	 */
	replaceDateWindow: (
		table: string,
		dateColumn: string,
		from: string,
		to: string,
		rows: tRow[],
		options?: iEmptyOptions
	) => Promise<iWriteResult>
	/** Lote vazio é recusado (apagaria a tabela inteira), a menos que `allowEmpty` seja explícito. */
	replaceAll: (table: string, rows: tRow[], options?: iEmptyOptions) => Promise<iWriteResult>
}

interface iEmptyOptions {
	/** Aceitar zero linhas, apagando o que existe. Use só quando a fonte confirmou que não há dado. */
	allowEmpty?: boolean
}

interface iWriter {
	readonly database: tDatabase
	readonly dryRun: boolean
	transaction: <T>(work: (tx: iWriteTx) => Promise<T>) => Promise<{ value: T; results: iWriteResult[] }>
}

interface iWriterScope {
	database: string
	/** Tabelas que o job declarou. O writer recusa qualquer outra. */
	tables: readonly string[]
	dryRun: boolean
	/** Preenche created_at/updated_at quando a linha não traz. Padrão true. */
	stampTimestamps?: boolean
}

interface iWriterDeps {
	source?: iConnectionSource
	now?: () => Date
	/** Modo do destino. Sem valor, vale o TARGET_MODE do env. Injetado nos testes. */
	mode?: tTargetMode
}

const INSERT_BATCH_SIZE = 500
const DELETE_KEYS_BATCH_SIZE = 1000
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP_COLUMNS = ['created_at', 'updated_at'] as const

/** Dia seguinte a AAAA-MM-DD, em UTC. */
const nextDay = (day: string): string => {
	const date = new Date(`${day}T00:00:00.000Z`)

	date.setUTCDate(date.getUTCDate() + 1)

	return date.toISOString().slice(0, 10)
}

const assertNotEmpty = (table: string, rows: tRow[], options: iEmptyOptions) => {
	if (rows.length > 0 || options.allowEmpty) return

	throw new AppError(
		`${table}: lote vazio recusado (apagaria os dados existentes). Se a fonte confirmou que não há dado, use allowEmpty.`
	)
}

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = []

	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))

	return chunks
}

const assertColumn = (column: string) => {
	if (!isSafeIdentifier(column)) throw new SafetyError(`Nome de coluna inválido: ${column}`)
}

/** Todas as linhas precisam ter exatamente as mesmas colunas (contrato da tabela). Devolve a lista de colunas. */
const columnsOf = (table: string, rows: tRow[]): string[] => {
	const first = rows[0]

	if (!first) return []

	const columns = Object.keys(first)
	const signature = [...columns].sort().join(',')

	columns.forEach(assertColumn)

	rows.forEach((row, index) => {
		if (Object.keys(row).sort().join(',') !== signature) {
			throw new AppError(
				`${table}: a linha ${index} tem colunas diferentes da primeira. Confira a transformação.`
			)
		}
	})

	return columns
}

const stamp = (rows: tRow[], now: Date): tRow[] =>
	rows.map(row => {
		const stamped: tRow = { ...row }

		for (const column of TIMESTAMP_COLUMNS) {
			if (!(column in stamped)) stamped[column] = now
		}

		return stamped
	})

const createWriter = (scope: iWriterScope, deps: iWriterDeps = {}): iWriter => {
	const database = assertTargetDatabase(scope.database)
	const allowedTables = new Set(scope.tables)
	const now = deps.now ?? (() => new Date())
	const stampTimestamps = scope.stampTimestamps ?? true

	scope.tables.forEach(table => assertWritableTable(table, allowedTables))

	const qualified = (table: string) => `${mysql.escapeId(database)}.${mysql.escapeId(table)}`

	const prepareRows = (rows: tRow[]) => (stampTimestamps ? stamp(rows, now()) : rows)

	const insertRows = async (connection: iSqlConnection, table: string, rows: tRow[]): Promise<number> => {
		const columns = columnsOf(table, rows)

		if (columns.length === 0) return 0

		let inserted = 0

		for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
			const values = batch.map(row => columns.map(column => row[column]))
			const result = await connection.query(
				`INSERT INTO ${qualified(table)} (${columns.map(column => mysql.escapeId(column)).join(', ')}) VALUES ?`,
				[values]
			)

			inserted += affectedRowsOf(result)
		}

		return inserted
	}

	const result = (table: string, strategy: tWriteStrategy, deleted: number, inserted: number): iWriteResult => ({
		database,
		table,
		strategy,
		deleted,
		inserted,
		dryRun: scope.dryRun
	})

	const buildTx = (connection: iSqlConnection | null): iWriteTx => {
		const upsert: iWriteTx['upsert'] = async (table, rawRows, options = {}) => {
			assertWritableTable(table, allowedTables)
			const rows = prepareRows(rawRows)

			if (!connection) return result(table, 'upsert', 0, rows.length)

			const columns = columnsOf(table, rows)

			if (columns.length === 0) return result(table, 'upsert', 0, 0)

			const keep = new Set<string>(['created_at', ...(options.keyColumns ?? [])])
			const updates = columns
				.filter(column => !keep.has(column))
				.map(column => `${mysql.escapeId(column)} = VALUES(${mysql.escapeId(column)})`)

			for (const batch of chunk(rows, INSERT_BATCH_SIZE)) {
				const values = batch.map(row => columns.map(column => row[column]))
				const sql =
					`INSERT INTO ${qualified(table)} (${columns.map(column => mysql.escapeId(column)).join(', ')}) VALUES ?` +
					(updates.length > 0 ? ` ON DUPLICATE KEY UPDATE ${updates.join(', ')}` : '')

				await connection.query(sql, [values])
			}

			// affectedRows do MySQL conta 2 por linha atualizada no ON DUPLICATE KEY; o resumo mostra linhas gravadas.
			return result(table, 'upsert', 0, rows.length)
		}

		const replaceByKeys: iWriteTx['replaceByKeys'] = async (table, keyColumn, keys, rawRows) => {
			assertWritableTable(table, allowedTables)
			assertColumn(keyColumn)
			const rows = prepareRows(rawRows)
			const keySet = new Set(keys.map(String))

			rows.forEach((row, index) => {
				if (!keySet.has(String(row[keyColumn]))) {
					throw new AppError(
						`${table}: a linha ${index} tem ${keyColumn} fora das chaves que serão apagadas.`
					)
				}
			})

			if (!connection) return result(table, 'replaceByKeys', 0, rows.length)

			let deleted = 0

			for (const batch of chunk([...keySet], DELETE_KEYS_BATCH_SIZE)) {
				deleted += affectedRowsOf(
					await connection.query(
						`DELETE FROM ${qualified(table)} WHERE ${mysql.escapeId(keyColumn)} IN (?)`,
						[batch]
					)
				)
			}

			return result(table, 'replaceByKeys', deleted, await insertRows(connection, table, rows))
		}

		const replaceDateWindow: iWriteTx['replaceDateWindow'] = async (
			table,
			dateColumn,
			from,
			to,
			rawRows,
			options = {}
		) => {
			assertWritableTable(table, allowedTables)
			assertColumn(dateColumn)

			if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
				throw new AppError(`${table}: janela inválida ${from}..${to} (use AAAA-MM-DD, início <= fim).`)
			}

			assertNotEmpty(table, rawRows, options)

			const rows = prepareRows(rawRows)

			rows.forEach((row, index) => {
				const value = row[dateColumn]
				const day = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10)

				if (day < from || day > to) {
					throw new AppError(
						`${table}: a linha ${index} tem ${dateColumn}=${day}, fora da janela ${from}..${to}.`
					)
				}
			})

			if (!connection) return result(table, 'replaceDateWindow', 0, rows.length)

			// `>= início AND < dia seguinte ao fim` cobre DATE e DATETIME (BETWEEN perderia o último dia depois de 00:00).
			const deleted = affectedRowsOf(
				await connection.query(
					`DELETE FROM ${qualified(table)} WHERE ${mysql.escapeId(dateColumn)} >= ? AND ${mysql.escapeId(dateColumn)} < ?`,
					[from, nextDay(to)]
				)
			)

			return result(table, 'replaceDateWindow', deleted, await insertRows(connection, table, rows))
		}

		const replaceAll: iWriteTx['replaceAll'] = async (table, rawRows, options = {}) => {
			assertWritableTable(table, allowedTables)
			assertNotEmpty(table, rawRows, options)
			const rows = prepareRows(rawRows)

			if (!connection) return result(table, 'replaceAll', 0, rows.length)

			const deleted = affectedRowsOf(await connection.query(`DELETE FROM ${qualified(table)}`))

			return result(table, 'replaceAll', deleted, await insertRows(connection, table, rows))
		}

		return { upsert, replaceByKeys, replaceDateWindow, replaceAll }
	}

	/** Registra o resultado de cada operação do tx, para o resumo da carga. */
	const recording = (tx: iWriteTx, results: iWriteResult[]): iWriteTx => ({
		upsert: async (...args) => {
			const output = await tx.upsert(...args)

			results.push(output)

			return output
		},
		replaceByKeys: async (...args) => {
			const output = await tx.replaceByKeys(...args)

			results.push(output)

			return output
		},
		replaceDateWindow: async (...args) => {
			const output = await tx.replaceDateWindow(...args)

			results.push(output)

			return output
		},
		replaceAll: async (...args) => {
			const output = await tx.replaceAll(...args)

			results.push(output)

			return output
		}
	})

	const transaction: iWriter['transaction'] = async work => {
		const results: iWriteResult[] = []

		if (scope.dryRun) {
			const value = await work(recording(buildTx(null), results))

			return { value, results }
		}

		const source = deps.source ?? fromPool(getTargetPool)
		const connection = await source.getConnection()

		try {
			// Trava principal: sem a identidade do destino do modo (Docker local ou produção), nem a transação é aberta.
			await assertTarget(connection, deps.mode)
			await connection.query('START TRANSACTION')

			try {
				const value = await work(recording(buildTx(connection), results))

				await connection.query('COMMIT')

				return { value, results }
			} catch (err) {
				await connection.query('ROLLBACK').catch(() => undefined)
				// Erro do driver leva o INSERT montado (dado pessoal): sobe só código e coluna.
				throw sanitizeDbError(err)
			}
		} finally {
			connection.release()
		}
	}

	return { database, dryRun: scope.dryRun, transaction }
}

export { createWriter }
export type { iWriteResult, iWriteTx, iWriter, iWriterScope, tRow, tWriteStrategy }
