import { DATABASES, type tDatabase } from '../../config/index.js'
import { SafetyError } from '../errors.js'

import { type iSqlConnection, rowsOf } from './connection.js'
import { LOCAL_MARKER, isLaravelTable, isSafeIdentifier } from './tables.js'

/**
 * Travas do banco de DESTINO. Rodam antes de qualquer gravação; se uma falha, nada é gravado.
 *
 * O marcador local é a trava principal: um túnel SSH para a produção também aparece como 127.0.0.1, então o host sozinho
 * não prova nada. O marcador só existe no Docker local (db/init/00-local.sql) e o usuário do ETL não tem permissão de
 * criá-lo — o código não consegue "fabricar" um destino local.
 */

const assertTargetDatabase = (database: string): tDatabase => {
	if (!(DATABASES as readonly string[]).includes(database)) {
		throw new SafetyError(`Banco de destino desconhecido: ${database}. Só ${DATABASES.join(' e ')}.`)
	}

	return database as tDatabase
}

const assertWritableTable = (table: string, allowedTables: ReadonlySet<string>): void => {
	if (!isSafeIdentifier(table)) throw new SafetyError(`Nome de tabela inválido: ${table}`)

	if (isLaravelTable(table)) throw new SafetyError(`A tabela ${table} é do Laravel e nunca é gravada.`)

	if (!allowedTables.has(table)) {
		throw new SafetyError(`A tabela ${table} não está na lista deste job; gravação recusada.`)
	}
}

const readMarker = async (connection: iSqlConnection): Promise<boolean> => {
	const result = await connection.query(
		`SELECT env FROM \`${LOCAL_MARKER.schema}\`.\`${LOCAL_MARKER.table}\` WHERE env = ? LIMIT 1`,
		[LOCAL_MARKER.env]
	)

	return rowsOf(result).length > 0
}

const assertLocalTarget = async (connection: iSqlConnection): Promise<void> => {
	const found = await readMarker(connection).catch((err: unknown) => {
		throw new SafetyError(
			'Destino sem o marcador do banco local (etl_local_meta.marker). Gravação recusada: este código só grava no Docker local.',
			{ cause: err }
		)
	})

	if (!found) {
		throw new SafetyError(
			'Marcador do banco local ausente. Gravação recusada: este código só grava no Docker local.'
		)
	}
}

export { assertLocalTarget, assertTargetDatabase, assertWritableTable }
