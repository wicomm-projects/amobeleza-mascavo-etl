import { DATABASES, PRODUCTION_TARGET, getTargetMode, type tDatabase, type tTargetMode } from '../../config/index.js'
import { SafetyError } from '../errors.js'

import { type iSqlConnection, rowsOf } from './connection.js'
import { LOCAL_MARKER, isLaravelTable, isSafeIdentifier } from './tables.js'

/**
 * Travas do banco de DESTINO. Rodam antes de qualquer gravação (e antes do lock); se uma falha, nada é feito.
 * `assertTarget` escolhe pelo modo (TARGET_MODE): local (abaixo) ou produção (assertProductionTarget, no fim do arquivo).
 *
 * Modo local:
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

/**
 * Modo produção (TARGET_MODE=production). Troca a identidade do Docker por uma identidade equivalente da produção,
 * conferida no servidor, na mesma conexão que vai gravar:
 * 1. `@@hostname` e `@@server_uuid` = os de PRODUCTION_TARGET (outro servidor no mesmo IP, ou um túnel, não passa);
 * 2. sessão cifrada (`Ssl_cipher` preenchido): o dado pessoal vai sem máscara pela internet;
 * 3. `CURRENT_USER()` = wicomm_etl@<IPv4 literal> (conta presa a um IP, nunca `%`);
 * 4. `SHOW GRANTS`: só USAGE global e SELECT/INSERT/UPDATE/DELETE tabela por tabela em mascavo_etl e amobeleza_etl.
 *    Um usuário que pode mais (o `dbeaver` da WPP, o root, um GRANT em `banco`.*, DDL, GRANT OPTION, role) é recusado:
 *    o ETL só roda com permissão mínima.
 */

const PRODUCTION_ONLY_MESSAGE =
	'Gravação recusada: no modo produção o ETL só grava no banco da cliente com o wicomm_etl.'

const PRODUCTION_PRIVILEGES: ReadonlySet<string> = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])

/** `` `banco`.`tabela` `` — grant de uma tabela só. */
const TABLE_GRANT_TARGET = /^`([A-Za-z0-9_]+)`\.`([A-Za-z0-9_]+)`$/

/** wicomm_etl preso a um IPv4 literal: sem curinga (`%`, `_`) nem nome de host. */
const PRODUCTION_USER_PATTERN = new RegExp(`^${PRODUCTION_TARGET.user}@(\\d{1,3}\\.){3}\\d{1,3}$`)

/** Confere as linhas de SHOW GRANTS do wicomm_etl. Exportado para teste. */
const assertProductionGrants = (grantLines: string[]): void => {
	for (const raw of grantLines) {
		const line = raw.trim()

		if (/WITH\s+GRANT\s+OPTION/i.test(line))
			throw new SafetyError(`Usuário com GRANT OPTION. ${PRODUCTION_ONLY_MESSAGE}`)

		const match = /^GRANT\s+(.+?)\s+ON\s+(\S+)\s+TO\s+/i.exec(line)

		if (!match?.[1] || !match[2]) throw new SafetyError(`Grant não reconhecido (role?). ${PRODUCTION_ONLY_MESSAGE}`)

		const privileges = match[1].split(',').map(privilege => privilege.trim().toUpperCase())
		const target = match[2]

		if (target === '*.*') {
			if (privileges.length !== 1 || privileges[0] !== 'USAGE') {
				throw new SafetyError(`Usuário com privilégio global. ${PRODUCTION_ONLY_MESSAGE}`)
			}

			continue
		}

		const table = TABLE_GRANT_TARGET.exec(target)

		if (!table?.[1] || !table[2]) {
			throw new SafetyError(
				`Usuário com privilégio em ${target} (só tabela por tabela). ${PRODUCTION_ONLY_MESSAGE}`
			)
		}

		if (!(DATABASES as readonly string[]).includes(table[1])) {
			throw new SafetyError(`Usuário com privilégio no banco ${table[1]}. ${PRODUCTION_ONLY_MESSAGE}`)
		}

		if (isLaravelTable(table[2])) {
			throw new SafetyError(`Usuário com privilégio na tabela do Laravel ${table[2]}. ${PRODUCTION_ONLY_MESSAGE}`)
		}

		const extra = privileges.filter(privilege => !PRODUCTION_PRIVILEGES.has(privilege))

		if (extra.length > 0) {
			throw new SafetyError(`Usuário com ${extra.join(', ')} em ${target}. ${PRODUCTION_ONLY_MESSAGE}`)
		}
	}
}

interface iProductionIdentity {
	host: string | null
	uuid: string | null
	user: string | null
}

const assertProductionTarget = async (connection: iSqlConnection): Promise<void> => {
	const result = await connection.query('SELECT @@hostname AS host, @@server_uuid AS uuid, CURRENT_USER() AS user')
	const identity = rowsOf<iProductionIdentity>(result)[0]

	if (!identity) throw new SafetyError(`Não foi possível ler a identidade do servidor. ${PRODUCTION_ONLY_MESSAGE}`)

	if (identity.host !== PRODUCTION_TARGET.hostname || identity.uuid !== PRODUCTION_TARGET.serverUuid) {
		throw new SafetyError(`O servidor não é o banco de produção esperado. ${PRODUCTION_ONLY_MESSAGE}`)
	}

	// Dado pessoal sem máscara viaja pela internet: a sessão precisa estar cifrada (o pool pede TLS 1.2+; aqui confere).
	const tls = rowsOf<{ Value?: string | null }>(await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'"))[0]

	if (!tls?.Value) throw new SafetyError(`Conexão com a produção sem TLS. ${PRODUCTION_ONLY_MESSAGE}`)

	if (!identity.user || !PRODUCTION_USER_PATTERN.test(identity.user)) {
		throw new SafetyError(`Usuário conectado não é o wicomm_etl preso ao IP da VPS. ${PRODUCTION_ONLY_MESSAGE}`)
	}

	const grants = rowsOf<Record<string, string>>(await connection.query('SHOW GRANTS'))

	assertProductionGrants(grants.map(row => Object.values(row).join(' ')))
}

/** Trava do destino conforme o modo. Sem modo explícito, vale o do env (local, se ninguém escreveu production). */
const assertTarget = async (connection: iSqlConnection, mode: tTargetMode = getTargetMode()): Promise<void> => {
	if (mode === 'production') return assertProductionTarget(connection)

	return assertLocalTarget(connection)
}

export {
	assertLocalGrants,
	assertLocalTarget,
	assertProductionGrants,
	assertProductionTarget,
	assertTarget,
	assertTargetDatabase,
	assertWritableTable
}
