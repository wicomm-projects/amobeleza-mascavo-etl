import { DATABASES, type tDatabase } from '../../config/index.js'
import { guardedTargetSource, type iConnectionSource, rowsOf } from '../../core/db/index.js'
import { SafetyError } from '../../core/errors.js'

import { ORDER_TABLES } from './tables.js'
import { toComparableUtc } from './values.js'

/**
 * Leituras no banco de DESTINO (Docker local, pela conexão protegida do núcleo), por chave, em lotes. Só SELECT; nunca
 * em dry-run.
 *
 * - `readStoredLastChange`: last_change gravado em vtex_order_details (diz se o pedido já tem detalhe) e em vtex_orders
 *   (a data da LISTA da carga anterior). Busca o detalhe de novo quando a data da lista muda. Pedido com detalhe que
 *   falhou não tem vtex_orders regravado, então a data antiga continua lá e ele é buscado de novo na próxima carga.
 * - `readStoredSellerNames`: seller_name gravado em vtex_orders (só amobeleza_etl), para manter o valor dos pedidos que
 *   não mudaram — vtex_orders é regravada inteira a cada carga, e o seller vem do detalhe.
 * - `readStoredItemOwners`: de qual pedido é cada uniqueid já gravado em vtex_order_items, para contar item que muda de
 *   pedido (uniqueId repetido entre pedidos).
 */

const SELECT_BATCH_SIZE = 1000

/** Tabela, chave e coluna entram no SQL: só estes trios, fixos no código. */
const READABLE = {
	lastChange: { table: ORDER_TABLES.details, key: 'order_id', column: 'last_change' },
	listLastChange: { table: ORDER_TABLES.orders, key: 'order_id', column: 'last_change' },
	sellerName: { table: ORDER_TABLES.orders, key: 'order_id', column: 'seller_name' },
	itemOwner: { table: ORDER_TABLES.items, key: 'uniqueid', column: 'order_id' }
} as const

type tReadable = (typeof READABLE)[keyof typeof READABLE]

interface iKeyValue {
	key: string
	value: unknown
}

const chunk = <T>(items: readonly T[], size: number): T[][] => {
	const chunks: T[][] = []

	for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))

	return chunks
}

const selectByKeys = async (
	database: tDatabase,
	{ table, key, column }: tReadable,
	keys: readonly string[],
	source: iConnectionSource
): Promise<iKeyValue[]> => {
	// O nome do banco entra no SQL: só os dois bancos conhecidos (tDatabase), conferido também em tempo de execução.
	if (!(DATABASES as readonly string[]).includes(database)) throw new SafetyError(`Banco desconhecido: ${database}`)

	if (keys.length === 0) return []

	const connection = await source.getConnection()
	const rows: iKeyValue[] = []

	try {
		for (const batch of chunk(keys, SELECT_BATCH_SIZE)) {
			rows.push(
				...rowsOf<iKeyValue>(
					await connection.query(
						`SELECT \`${key}\` AS \`key\`, \`${column}\` AS value FROM \`${database}\`.\`${table}\` WHERE \`${key}\` IN (?)`,
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

interface iStoredLastChange {
	/** last_change de vtex_order_details: quem não está aqui não tem detalhe gravado. */
	detail: Map<string, string>
	/** last_change de vtex_orders: a data da lista gravada na carga anterior. */
	list: Map<string, string>
}

const lastChangeMap = (rows: iKeyValue[]): Map<string, string> => {
	const map = new Map<string, string>()

	for (const row of rows) {
		const lastChange = toComparableUtc(row.value as Date | string | null)

		if (lastChange) map.set(row.key, lastChange)
	}

	return map
}

/** order_id → last_change gravado (detalhe e lista), em "AAAA-MM-DD HH:MM:SS" UTC. Pedido sem linha não entra no mapa. */
const readStoredLastChange = async (
	database: tDatabase,
	orderIds: readonly string[],
	source: iConnectionSource = guardedTargetSource()
): Promise<iStoredLastChange> => ({
	detail: lastChangeMap(await selectByKeys(database, READABLE.lastChange, orderIds, source)),
	list: lastChangeMap(await selectByKeys(database, READABLE.listLastChange, orderIds, source))
})

/** order_id → seller_name gravado (nulo incluído: "a própria loja"). Pedido ausente não entra no mapa. */
const readStoredSellerNames = async (
	database: tDatabase,
	orderIds: readonly string[],
	source: iConnectionSource = guardedTargetSource()
): Promise<Map<string, string | null>> => {
	const stored = new Map<string, string | null>()

	for (const row of await selectByKeys(database, READABLE.sellerName, orderIds, source)) {
		stored.set(row.key, row.value === null || row.value === undefined ? null : String(row.value))
	}

	return stored
}

/** uniqueid → order_id do item já gravado. */
const readStoredItemOwners = async (
	database: tDatabase,
	uniqueIds: readonly string[],
	source: iConnectionSource = guardedTargetSource()
): Promise<Map<string, string>> => {
	const stored = new Map<string, string>()

	for (const row of await selectByKeys(database, READABLE.itemOwner, uniqueIds, source)) {
		stored.set(row.key, String(row.value))
	}

	return stored
}

export { readStoredItemOwners, readStoredLastChange, readStoredSellerNames }
export type { iStoredLastChange }
