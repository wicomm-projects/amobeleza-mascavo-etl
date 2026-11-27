import type { tTargetMode } from '../../config/index.js'

import { fromPool, type iConnectionSource } from './connection.js'
import { getTargetPool } from './pools.js'
import { assertTarget } from './target-guard.js'

/**
 * Conexão com o destino que SÓ é entregue depois de `assertTarget` passar (Docker local ou, no modo produção, o banco da
 * cliente com o wicomm_etl). É a única forma de código fora de src/core/db chegar no banco de destino (o ESLint proíbe
 * importar pools, connection e mysql2 fora daqui).
 */
const guardedTargetSource = (
	base: iConnectionSource = fromPool(getTargetPool),
	mode?: tTargetMode
): iConnectionSource => ({
	getConnection: async () => {
		const connection = await base.getConnection()

		try {
			await assertTarget(connection, mode)
		} catch (err) {
			connection.release()
			throw err
		}

		return connection
	}
})

/** Abre e fecha uma conexão protegida: lança se o destino não for o do modo atual. Usado pelo check-access. */
const checkTarget = async (): Promise<void> => {
	const connection = await guardedTargetSource().getConnection()

	connection.release()
}

export { checkTarget, guardedTargetSource }
