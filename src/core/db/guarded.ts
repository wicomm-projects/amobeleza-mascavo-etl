import { fromPool, type iConnectionSource } from './connection.js'
import { getTargetPool } from './pools.js'
import { assertLocalTarget } from './target-guard.js'

/**
 * Conexão com o destino que SÓ é entregue depois de `assertLocalTarget` passar. É a única forma de código fora de
 * src/core/db chegar no banco de destino (o ESLint proíbe importar pools, connection e mysql2 fora daqui).
 */
const guardedTargetSource = (base: iConnectionSource = fromPool(getTargetPool)): iConnectionSource => ({
	getConnection: async () => {
		const connection = await base.getConnection()

		try {
			await assertLocalTarget(connection)
		} catch (err) {
			connection.release()
			throw err
		}

		return connection
	}
})

/** Abre e fecha uma conexão protegida: lança se o destino não for o Docker local. Usado pelo check-access. */
const checkLocalTarget = async (): Promise<void> => {
	const connection = await guardedTargetSource().getConnection()

	connection.release()
}

export { checkLocalTarget, guardedTargetSource }
