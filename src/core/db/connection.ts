import type { Pool } from 'mysql2/promise'

/**
 * Interface mínima de conexão usada pelo writer e pelo ref-reader. Existe para que as travas de segurança possam ser
 * testadas com uma conexão falsa, sem banco nenhum.
 */
interface iSqlConnection {
	query: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>
	release: () => void
}

interface iConnectionSource {
	getConnection: () => Promise<iSqlConnection>
}

const fromPool = (getPool: () => Pool): iConnectionSource => ({
	getConnection: async () => {
		const connection = await getPool().getConnection()

		return {
			query: async (sql, params) => connection.query(sql, params) as Promise<[unknown, unknown]>,
			release: () => connection.release()
		}
	}
})

/** Linhas de um SELECT, ou lista vazia quando o driver devolve outra coisa. */
const rowsOf = <T>(result: [unknown, unknown]): T[] => (Array.isArray(result[0]) ? (result[0] as T[]) : [])

/** affectedRows de um INSERT/DELETE. */
const affectedRowsOf = (result: [unknown, unknown]): number => {
	const header = result[0] as { affectedRows?: unknown } | undefined

	return typeof header?.affectedRows === 'number' ? header.affectedRows : 0
}

export { affectedRowsOf, fromPool, rowsOf }
export type { iConnectionSource, iSqlConnection }
