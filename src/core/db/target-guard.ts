import { DATABASES, type tDatabase } from '../../config/index.js'
import { SafetyError } from '../errors.js'

import { type iSqlConnection, rowsOf } from './connection.js'
import { LOCAL_MARKER, isLaravelTable, isSafeIdentifier } from './tables.js'

/**
 * Travas do banco de DESTINO. Rodam antes de qualquer gravação (e antes do lock); se uma falha, nada é feito.
 *
 * Um túnel SSH para a produção também aparece como 127.0.0.1, então o host da conexão não prova nada. A identidade do
 * Docker local é conferida no próprio servidor, na mesma conexão que vai gravar:
 * 1. marcador `etl_local_meta.marker` = 'local-dev';
 * 2. `@@hostname` = hostname fixo do container (docker-compose.yml);
 * 3. `CURRENT_USER()` = etl_local@%;
 * 4. `SHOW GRANTS` do usuário: nada global além de USAGE, nada além de SELECT no banco do marcador, sem role, sem GRANT
 *    OPTION — um usuário de produção (ou o root) nunca passa, mesmo que alguém crie o marcador lá por engano.
 */

const LOCAL_ONLY_MESSAGE = 'Gravação recusada: este código só grava no MySQL local do Docker.'

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

/** Bancos em que o usuário local pode ter qualquer privilégio. */
const LOCAL_WRITABLE_SCHEMAS = new Set(DATABASES.map(database => `\`${database}\`.*`))
const MARKER_SCHEMA_GRANT = `\`${LOCAL_MARKER.schema}\`.*`

/** Confere as linhas de SHOW GRANTS do usuário local. Exportado para teste. */
const assertLocalGrants = (grantLines: string[]): void => {
	for (const raw of grantLines) {
		const line = raw.trim()

		if (/WITH\s+GRANT\s+OPTION/i.test(line))
			throw new SafetyError(`Usuário com GRANT OPTION. ${LOCAL_ONLY_MESSAGE}`)

		const match = /^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s+/i.exec(line)

		if (!match?.[1] || !match[2]) throw new SafetyError(`Grant não reconhecido (role?). ${LOCAL_ONLY_MESSAGE}`)

		const privileges = match[1].trim().toUpperCase()
		const target = match[2]

		if (target === '*.*') {
			if (privileges !== 'USAGE') throw new SafetyError(`Usuário com privilégio global. ${LOCAL_ONLY_MESSAGE}`)

			continue
		}

		if (target === MARKER_SCHEMA_GRANT) {
			if (privileges !== 'SELECT') throw new SafetyError(`Usuário pode alterar o marcador. ${LOCAL_ONLY_MESSAGE}`)

			continue
		}

		if (!LOCAL_WRITABLE_SCHEMAS.has(target)) {
			throw new SafetyError(`Usuário com privilégio em ${target}. ${LOCAL_ONLY_MESSAGE}`)
		}
	}
}

interface iLocalIdentity {
	host: string | null
	user: string | null
	marker: number | string | null
}

const readIdentity = async (connection: iSqlConnection): Promise<iLocalIdentity | undefined> => {
	const result = await connection.query(
		`SELECT @@hostname AS host, CURRENT_USER() AS user, ` +
			`(SELECT COUNT(*) FROM \`${LOCAL_MARKER.schema}\`.\`${LOCAL_MARKER.table}\` WHERE env = ?) AS marker`,
		[LOCAL_MARKER.env]
	)

	return rowsOf<iLocalIdentity>(result)[0]
}

const assertLocalTarget = async (connection: iSqlConnection): Promise<void> => {
	const identity = await readIdentity(connection).catch((err: unknown) => {
		throw new SafetyError(`Destino sem o marcador do banco local (etl_local_meta.marker). ${LOCAL_ONLY_MESSAGE}`, {
			cause: err
		})
	})

	if (!identity || Number(identity.marker) < 1) {
		throw new SafetyError(`Marcador do banco local ausente. ${LOCAL_ONLY_MESSAGE}`)
	}

	if (identity.host !== LOCAL_MARKER.hostname) {
		throw new SafetyError(`O servidor não é o container local (hostname diferente). ${LOCAL_ONLY_MESSAGE}`)
	}

	if (identity.user !== LOCAL_MARKER.user) {
		throw new SafetyError(`Usuário conectado não é o etl_local do Docker. ${LOCAL_ONLY_MESSAGE}`)
	}

	const grants = rowsOf<Record<string, string>>(await connection.query('SHOW GRANTS'))

	assertLocalGrants(grants.map(row => Object.values(row).join(' ')))
}

export { assertLocalGrants, assertLocalTarget, assertTargetDatabase, assertWritableTable }
