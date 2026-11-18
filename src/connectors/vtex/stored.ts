import { DATABASES, type tDatabase } from '../../config/index.js'
import { guardedTargetSource, type iConnectionSource, rowsOf } from '../../core/db/index.js'
import { SafetyError } from '../../core/errors.js'

import { ORDER_TABLES } from './tables.js'
import { toComparableUtc } from './values.js'

/**
 * Lê no banco de DESTINO (Docker local, pela conexão protegida do núcleo) o `last_change` gravado de cada pedido, para
 * buscar o detalhe só do que mudou. A base é vtex_order_details: ela só recebe o pedido quando o detalhe foi gravado,
 * então um detalhe que falhou numa carga é buscado de novo na próxima. Só SELECT, por chave, em lotes.
 */

const SELECT_BATCH_SIZE = 1000

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = []

	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))

	return chunks
}

/** order_id → last_change gravado, em "AAAA-MM-DD HH:MM:SS" UTC. Pedido ausente não entra no mapa. */
const readStoredLastChange = async (
	database: tDatabase,
	orderIds: readonly string[],
	source: iConnectionSource = guardedTargetSource()
): Promise<Map<string, string>> => {
	// O nome do banco entra no SQL: só os dois bancos conhecidos (tDatabase), conferido também em tempo de execução.
	if (!(DATABASES as readonly string[]).includes(database)) throw new SafetyError(`Banco desconhecido: ${database}`)

	const stored = new Map<string, string>()

	if (orderIds.length === 0) return stored

	const connection = await source.getConnection()

	try {
		for (const batch of chunk(orderIds, SELECT_BATCH_SIZE)) {
			const rows = rowsOf<{ order_id: string; last_change: Date | string | null }>(
				await connection.query(
					`SELECT order_id, last_change FROM \`${database}\`.\`${ORDER_TABLES.details}\` WHERE order_id IN (?)`,
					[batch]
				)
			)

			for (const row of rows) {
				const lastChange = toComparableUtc(row.last_change)

				if (lastChange) stored.set(row.order_id, lastChange)
			}
		}
	} finally {
		connection.release()
	}

	return stored
}

export { readStoredLastChange }
