import mysql from 'mysql2/promise'

import { getEnv, getLogger } from '../../config/index.js'
import { SafetyError } from '../errors.js'

import { fromPool, type iConnectionSource, rowsOf } from './connection.js'
import { getRefPool } from './pools.js'
import { isLaravelTable, isSafeIdentifier } from './tables.js'

/**
 * Leitura do MySQL da CLIENTE (produção). Usado só por schema:pull e paridade.
 *
 * Três camadas de proteção:
 * 1. `assertReadOnlySql`: só aceita um único SELECT ou SHOW, sem `;`, sem INTO OUTFILE/variável, sem FOR UPDATE/SHARE
 *    (lock em linha de produção), sem SLEEP/BENCHMARK e sem citar tabela do Laravel.
 * 2. Cada consulta roda dentro de `START TRANSACTION READ ONLY` e termina em ROLLBACK: o próprio MySQL recusa escrita.
 * 3. `max_execution_time` na sessão: consulta pesada por engano é abortada pelo servidor.
 * Além disso, o usuário pedido à cliente é só de leitura e o env recusa `root`.
 */

const READ_ONLY_START = /^(SELECT|SHOW)\b/i
const FORBIDDEN_FRAGMENTS: { pattern: RegExp; reason: string }[] = [
	{ pattern: /;/, reason: 'mais de um comando (;)' },
	{ pattern: /\bINTO\s+(OUTFILE|DUMPFILE)\b|\bINTO\s+@/i, reason: 'SELECT ... INTO grava arquivo ou variável' },
	{ pattern: /\bFOR\s+(UPDATE|SHARE)\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i, reason: 'trava linhas de produção' },
	{ pattern: /\b(SLEEP|BENCHMARK|GET_LOCK)\s*\(/i, reason: 'função que segura o servidor' }
]

/** Remove espaços e comentários do começo (`/* *\/`, `-- `, `#`) para não esconder um comando atrás de um comentário. */
const stripLeadingComments = (sql: string): string => {
	let rest = sql.trimStart()

	for (;;) {
		if (rest.startsWith('/*')) {
			const end = rest.indexOf('*/')

			if (end === -1) return ''

			rest = rest.slice(end + 2).trimStart()
			continue
		}

		if (rest.startsWith('--') || rest.startsWith('#')) {
			const end = rest.indexOf('\n')

			if (end === -1) return ''

			rest = rest.slice(end + 1).trimStart()
			continue
		}

		return rest
	}
}

const assertReadOnlySql = (sql: string): void => {
	const body = stripLeadingComments(sql)

	if (!READ_ONLY_START.test(body)) {
		throw new SafetyError('Banco da cliente: só SELECT ou SHOW são permitidos.')
	}

	// Comentário no meio pode esconder trecho; para a produção, SQL sem comentário nenhum.
	if (/\/\*|--\s|#/.test(body)) {
		throw new SafetyError('Banco da cliente: SQL com comentário não é aceito.')
	}

	for (const { pattern, reason } of FORBIDDEN_FRAGMENTS) {
		if (pattern.test(body)) throw new SafetyError(`Banco da cliente: SQL recusado (${reason}).`)
	}

	const identifiers = body.match(/[A-Za-z0-9_]+/g) ?? []
	const laravel = identifiers.find(isLaravelTable)

	if (laravel) throw new SafetyError(`Banco da cliente: a tabela ${laravel} (Laravel) nunca é lida.`)
}

interface iRefReader {
	query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>
	showCreateTable: (database: string, table: string, allowedTables: ReadonlySet<string>) => Promise<string>
}

const createRefReader = (source: iConnectionSource = fromPool(getRefPool)): iRefReader => {
	const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
		assertReadOnlySql(sql)

		const connection = await source.getConnection()

		try {
			try {
				await connection.query('SET SESSION max_execution_time = ?', [getEnv().REF_DB_MAX_EXECUTION_MS])
			} catch {
				// MariaDB e MySQL < 5.7.8 não têm essa variável. A transação READ ONLY continua valendo.
				getLogger().warn('Banco da cliente sem max_execution_time; seguindo só com READ ONLY')
			}

			await connection.query('START TRANSACTION READ ONLY')

			return rowsOf<T>(await connection.query(sql, params))
		} finally {
			await connection.query('ROLLBACK').catch(() => undefined)
			connection.release()
		}
	}

	const showCreateTable = async (database: string, table: string, allowedTables: ReadonlySet<string>) => {
		if (!isSafeIdentifier(database) || !isSafeIdentifier(table)) {
			throw new SafetyError(`Nome inválido: ${database}.${table}`)
		}

		if (isLaravelTable(table)) throw new SafetyError(`A tabela ${table} (Laravel) nunca é lida.`)

		if (!allowedTables.has(table)) {
			throw new SafetyError(`A tabela ${table} não está na lista de nenhum job; o schema:pull não a lê.`)
		}

		const rows = await query<{ 'Create Table'?: string }>(
			`SHOW CREATE TABLE ${mysql.escapeId(database)}.${mysql.escapeId(table)}`
		)
		const ddl = rows[0]?.['Create Table']

		if (!ddl) throw new SafetyError(`SHOW CREATE TABLE ${database}.${table} não devolveu DDL.`)

		return ddl
	}

	return { query, showCreateTable }
}

export { assertReadOnlySql, createRefReader }
export type { iRefReader }
