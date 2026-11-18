import { DATABASES, type tDatabase } from '../../config/index.js'
import { guardedTargetSource, type iConnectionSource, rowsOf } from '../../core/db/index.js'
import { SafetyError } from '../../core/errors.js'

import { ORDER_TABLES } from './tables.js'
import { toComparableUtc } from './values.js'

/**
 * Leituras no banco de DESTINO (Docker local, pela conexão protegida do núcleo), por order_id, em lotes. Só SELECT.
 *
 * - `readStoredLastChange`: last_change gravado em vtex_order_details, para buscar o detalhe só do que mudou. A base é
 *   o detalhe (não vtex_orders): ele só é gravado quando o detalhe veio, então um detalhe que falhou numa carga é
 *   buscado de novo na próxima.
 * - `readStoredSellerNames`: seller_name gravado em vtex_orders (só amobeleza_etl), para manter o valor dos pedidos que
 *   não mudaram — vtex_orders é regravada inteira a cada carga, e o seller vem do detalhe.
 */

const SELECT_BATCH_SIZE = 1000

/** Tabela e coluna entram no SQL: só estes pares, fixos no código. */
const READABLE = {
	lastChange: { table: ORDER_TABLES.details, column: 'last_change' },
	sellerName: { table: ORDER_TABLES.orders, column: 'seller_name' }
} as const

type tReadable = (typeof READABLE)[keyof typeof READABLE]

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = []

	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))

	return chunks
}

const selectByOrderIds = async (
	database: tDatabase,
	{ table, column }: tReadable,
	orderIds: readonly string[],
	source: iConnectionSource
): Promise<{ order_id: string; value: unknown }[]> => {
	// O nome do banco entra no SQL: só os dois bancos conhecidos (tDatabase), conferido também em tempo de execução.
	if (!(DATABASES as readonly string[]).includes(database)) throw new SafetyError(`Banco desconhecido: ${database}`)

	if (orderIds.length === 0) return []

	const connection = await source.getConnection()
	const rows: { order_id: string; value: unknown }[] = []

	try {
		for (const batch of chunk(orderIds, SELECT_BATCH_SIZE)) {
			rows.push(
				...rowsOf<{ order_id: string; value: unknown }>(
					await connection.query(
						`SELECT order_id, \`${column}\` AS value FROM \`${database}\`.\`${table}\` WHERE order_id IN (?)`,
						[batch]
					)
				)
			)
		}
	} finally {
		connection.release()
	}

	return rows
}

/** order_id → last_change gravado, em "AAAA-MM-DD HH:MM:SS" UTC. Pedido sem detalhe gravado não entra no mapa. */
const readStoredLastChange = async (
	database: tDatabase,
	orderIds: readonly string[],
	source: iConnectionSource = guardedTargetSource()
): Promise<Map<string, string>> => {
	const stored = new Map<string, string>()

	for (const row of await selectByOrderIds(database, READABLE.lastChange, orderIds, source)) {
		const lastChange = toComparableUtc(row.value as Date | string | null)

		if (lastChange) stored.set(row.order_id, lastChange)
	}

	return stored
}

/** order_id → seller_name gravado (nulo incluído: "a própria loja"). Pedido ausente não entra no mapa. */
const readStoredSellerNames = async (
	database: tDatabase,
	orderIds: readonly string[],
	source: iConnectionSource = guardedTargetSource()
): Promise<Map<string, string | null>> => {
	const stored = new Map<string, string | null>()

	for (const row of await selectByOrderIds(database, READABLE.sellerName, orderIds, source)) {
		stored.set(row.order_id, row.value === null || row.value === undefined ? null : String(row.value))
	}

	return stored
}

export { readStoredLastChange, readStoredSellerNames }
