import { guardedTargetSource, type iConnectionSource, rowsOf } from '../db/index.js'
import { AppError } from '../errors.js'

/**
 * Impede duas execuções do mesmo job ao mesmo tempo (agendador + CLI, ou uma carga que passou de 30 minutos).
 *
 * Duas camadas: um Set em memória (mesmo processo) e GET_LOCK do MySQL de destino (processos diferentes). GET_LOCK não
 * grava nada; o lock some sozinho se a conexão cair. A conexão vem de guardedTargetSource: o lock só é pedido depois
 * de provar que o destino é o Docker local. No dry-run só vale o lock em memória, porque não há banco.
 */

const inProcess = new Set<string>()

class JobLockedError extends AppError {}

const withJobLock = async <T>(
	lockName: string,
	useDatabaseLock: boolean,
	work: () => Promise<T>,
	source: iConnectionSource = guardedTargetSource()
): Promise<T> => {
	if (inProcess.has(lockName)) throw new JobLockedError(`${lockName} já está rodando neste processo.`)

	inProcess.add(lockName)

	try {
		if (!useDatabaseLock) return await work()

		const connection = await source.getConnection()

		try {
			const rows = rowsOf<{ acquired: number | null }>(
				await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [`amo_etl:${lockName}`])
			)

			if (rows[0]?.acquired !== 1) throw new JobLockedError(`${lockName} já está rodando em outro processo.`)

			try {
				return await work()
			} finally {
				await connection.query('SELECT RELEASE_LOCK(?)', [`amo_etl:${lockName}`]).catch(() => undefined)
			}
		} finally {
			connection.release()
		}
	} finally {
		inProcess.delete(lockName)
	}
}

export { JobLockedError, withJobLock }
