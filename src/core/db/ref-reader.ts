import mysql from 'mysql2/promise'

import { getEnv, getLogger } from '../../config/index.js'
import { SafetyError } from '../errors.js'

import { fromPool, type iConnectionSource, type iSqlConnection, rowsOf } from './connection.js'
import { getRefPool } from './pools.js'
import { isLaravelTable, isSafeIdentifier } from './tables.js'

/**
 * Leitura do MySQL da CLIENTE (produção). Usado só por schema:pull, paridade e check-access.
 *
 * Camadas de proteção (todas obrigatórias):
 * 1. `assertReadOnlySql`: um único SELECT ou SHOW; recusa QUALQUER comentário (inclusive o executável `/*! ... *\/`, que o
 *    MySQL roda), `;`, INTO OUTFILE/variável, FOR UPDATE/SHARE, SLEEP/BENCHMARK/GET_LOCK/LOAD_FILE e tabela do Laravel.
 * 2. Usuário só leitura comprovado: antes da primeira consulta, `SHOW GRANTS` precisa ter só SELECT / SHOW VIEW / USAGE /
 *    SHOW DATABASES, sem role, sem PROXY, sem GRANT OPTION. Senão, o reader recusa trabalhar.
 * 3. Sessão em modo só leitura (`SET SESSION TRANSACTION READ ONLY`) e cada consulta dentro de
 *    `START TRANSACTION READ ONLY` + ROLLBACK. O modo de sessão é o que barra DDL (CREATE TABLE ... AS SELECT, CREATE
 *    VIEW), que o START TRANSACTION sozinho deixaria passar por causa do commit implícito.
 * 4. `max_execution_time` na sessão: consulta pesada por engano é abortada pelo servidor.
 * Além disso, o env recusa o usuário `root`.
 */

const READ_ONLY_START = /^(SELECT|SHOW)\b/i
const FORBIDDEN_FRAGMENTS: { pattern: RegExp; reason: string }[] = [
	{ pattern: /\/\*|\*\/|--|#/, reason: 'comentário (pode esconder comando executável)' },
	{ pattern: /;/, reason: 'mais de um comando (;)' },
	{ pattern: /\bINTO\s+(OUTFILE|DUMPFILE)\b|\bINTO\s+@/i, reason: 'SELECT ... INTO grava arquivo ou variável' },
	{ pattern: /\bFOR\s+(UPDATE|SHARE)\b|\bLOCK\s+IN\s+SHARE\s+MODE\b/i, reason: 'trava linhas de produção' },
	{ pattern: /\b(SLEEP|BENCHMARK|GET_LOCK|LOAD_FILE)\s*\(/i, reason: 'função que segura o servidor ou lê arquivo' }
]

/** Privilégios aceitos no usuário de leitura. Qualquer outro (inclusive dinâmicos do MySQL 8) faz o reader recusar. */
const READ_ONLY_PRIVILEGES = new Set(['SELECT', 'SHOW VIEW', 'USAGE', 'SHOW DATABASES'])

/** MySQL: variável de sistema desconhecida (MariaDB, MySQL < 5.7.8 não têm max_execution_time). */
const ER_UNKNOWN_SYSTEM_VARIABLE = 1193

const assertReadOnlySql = (sql: string): void => {
	// Nenhuma remoção de comentário antes de checar: o SQL é avaliado exatamente como vai para o servidor.
	const body = sql.trim()

	if (!READ_ONLY_START.test(body)) {
		throw new SafetyError('Banco da cliente: só SELECT ou SHOW são permitidos.')
	}

	for (const { pattern, reason } of FORBIDDEN_FRAGMENTS) {
		if (pattern.test(body)) throw new SafetyError(`Banco da cliente: SQL recusado (${reason}).`)
	}

	const identifiers = body.match(/[A-Za-z0-9_]+/g) ?? []
	const laravel = identifiers.find(isLaravelTable)

	if (laravel) throw new SafetyError(`Banco da cliente: a tabela ${laravel} (Laravel) nunca é lida.`)
}

/**
 * Confere as linhas de `SHOW GRANTS`. Lança se o usuário puder fazer qualquer coisa além de ler. Role não é aceita porque
 * o SHOW GRANTS mostra só o nome dela, não o que ela permite.
 */
const assertReadOnlyGrants = (grantLines: string[]): void => {
	if (grantLines.length === 0) throw new SafetyError('Banco da cliente: SHOW GRANTS não devolveu nada.')

	for (const line of grantLines) {
		if (/WITH\s+GRANT\s+OPTION/i.test(line)) {
			throw new SafetyError('Banco da cliente: o usuário tem GRANT OPTION. Peça um usuário só de leitura.')
		}

		const match = /^GRANT\s+(.+?)\s+ON\s+/i.exec(line.trim())

		if (!match?.[1]) {
			throw new SafetyError(
				'Banco da cliente: o usuário recebe uma role (ou grant que não dá para conferir). Peça um usuário só de leitura, sem role.'
			)
		}

		const privileges = match[1]
			.replace(/\([^)]*\)/g, '')
			.split(',')
			.map(privilege => privilege.trim().toUpperCase())
		const extra = privileges.filter(privilege => !READ_ONLY_PRIVILEGES.has(privilege))

		if (extra.length > 0) {
			throw new SafetyError(
				`Banco da cliente: o usuário tem permissão além de leitura (${extra.join(', ')}). Peça um usuário só de leitura.`
			)
		}
	}
}

const errorNumber = (err: unknown): number | undefined =>
	typeof (err as { errno?: unknown })?.errno === 'number' ? (err as { errno: number }).errno : undefined

/** Prepara a conexão: sessão só leitura (barra DDL) e teto de tempo por consulta. Exportado para o teste de integração. */
const prepareReadOnlySession = async (connection: iSqlConnection): Promise<void> => {
	await connection.query('SET SESSION TRANSACTION READ ONLY')

	try {
		await connection.query('SET SESSION max_execution_time = ?', [getEnv().REF_DB_MAX_EXECUTION_MS])
	} catch (err) {
		if (errorNumber(err) !== ER_UNKNOWN_SYSTEM_VARIABLE) throw err

		getLogger().warn({ err }, 'Banco da cliente sem max_execution_time; seguindo com sessão READ ONLY')
	}
}

interface iRefReader {
	query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<T[]>
	showCreateTable: (database: string, table: string, allowedTables: ReadonlySet<string>) => Promise<string>
}

const createRefReader = (source: iConnectionSource = fromPool(getRefPool)): iRefReader => {
	let grantsChecked: Promise<void> | null = null

	/** Executa um SQL já validado numa sessão só leitura, dentro de transação READ ONLY, sempre com ROLLBACK. */
	const execute = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
		const connection = await source.getConnection()

		try {
			await prepareReadOnlySession(connection)
			await connection.query('START TRANSACTION READ ONLY')

			return rowsOf<T>(await connection.query(sql, params))
		} finally {
			await connection.query('ROLLBACK').catch(() => undefined)
			connection.release()
		}
	}

	const ensureReadOnlyUser = (): Promise<void> => {
		grantsChecked ??= execute<Record<string, string>>('SHOW GRANTS').then(rows =>
			assertReadOnlyGrants(rows.map(row => Object.values(row).join(' ')))
		)

		return grantsChecked
	}

	const query = async <T>(sql: string, params: unknown[] = []): Promise<T[]> => {
		assertReadOnlySql(sql)
		await ensureReadOnlyUser()

		return execute<T>(sql, params)
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

export { assertReadOnlyGrants, assertReadOnlySql, createRefReader, prepareReadOnlySession }
export type { iRefReader }
