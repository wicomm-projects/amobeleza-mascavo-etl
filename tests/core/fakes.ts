import { PRODUCTION_TARGET } from '../../src/config/production-target.js'
import type { iConnectionSource } from '../../src/core/db/connection.js'

/**
 * Conexões falsas para testar as travas sem banco nenhum. Cada SQL enviado fica registrado em `queries`.
 */

const LOCAL_GRANTS = [
	{ g: 'GRANT USAGE ON *.* TO `etl_local`@`%`' },
	{ g: 'GRANT ALL PRIVILEGES ON `mascavo_etl`.* TO `etl_local`@`%`' },
	{ g: 'GRANT ALL PRIVILEGES ON `amobeleza_etl`.* TO `etl_local`@`%`' },
	{ g: 'GRANT SELECT ON `etl_local_meta`.* TO `etl_local`@`%`' }
]

const LOCAL_IDENTITY = { host: 'amo-etl-mysql-local', user: 'etl_local@%', marker: 1 }

const LOCAL_SERVER_UUID = 'aaaaaaaa-1111-2222-3333-444444444444'

type tTargetScenario =
	| 'local'
	| 'no-marker'
	| 'missing-marker-table'
	| 'other-host'
	| 'other-user'
	| 'global-privileges'
	| 'can-write-marker'

/** Destino falso. 'local' imita o Docker; os demais imitam um servidor que não é o Docker (ex.: túnel para produção). */
const fakeTarget = (scenario: tTargetScenario) => {
	const queries: string[] = []
	let connections = 0

	const identity = () => {
		if (scenario === 'no-marker') return { ...LOCAL_IDENTITY, marker: 0 }

		if (scenario === 'other-host') return { ...LOCAL_IDENTITY, host: 'srv-producao' }

		if (scenario === 'other-user') return { ...LOCAL_IDENTITY, user: 'root@%' }

		return LOCAL_IDENTITY
	}

	const grants = () => {
		if (scenario === 'global-privileges') return [{ g: 'GRANT ALL PRIVILEGES ON *.* TO `etl_local`@`%`' }]

		if (scenario === 'can-write-marker') {
			return [...LOCAL_GRANTS.slice(0, 3), { g: 'GRANT SELECT, INSERT ON `etl_local_meta`.* TO `etl_local`@`%`' }]
		}

		return LOCAL_GRANTS
	}

	const source: iConnectionSource = {
		getConnection: async () => {
			connections += 1

			return {
				query: async (sql: string) => {
					queries.push(sql)

					if (sql.includes('etl_local_meta')) {
						if (scenario === 'missing-marker-table') {
							throw new Error("Table 'etl_local_meta.marker' doesn't exist")
						}

						return [[identity()], []]
					}

					// Consulta de identidade do modo produção: o Docker responde com os dados dele, que não são os da cliente.
					if (sql.includes('@@server_uuid')) {
						return [[{ host: identity().host, uuid: LOCAL_SERVER_UUID, user: identity().user }], []]
					}

					if (sql === 'SHOW GRANTS') return [grants(), []]

					return [{ affectedRows: 1 }, []]
				},
				release: () => undefined
			}
		}
	}

	return { source, queries, connections: () => connections }
}

const PRODUCTION_USER_AT = '`wicomm_etl`@`203.0.113.10`'

const PRODUCTION_GRANTS = [
	{ g: `GRANT USAGE ON *.* TO ${PRODUCTION_USER_AT}` },
	{ g: `GRANT SELECT, INSERT, UPDATE, DELETE ON \`mascavo_etl\`.\`vtex_orders\` TO ${PRODUCTION_USER_AT}` },
	{ g: `GRANT SELECT, INSERT, UPDATE, DELETE ON \`amobeleza_etl\`.\`anymarket_orders\` TO ${PRODUCTION_USER_AT}` }
]

const PRODUCTION_IDENTITY = {
	host: PRODUCTION_TARGET.hostname,
	uuid: PRODUCTION_TARGET.serverUuid,
	user: 'wicomm_etl@203.0.113.10'
}

type tProductionScenario =
	| 'production'
	| 'other-hostname'
	| 'other-uuid'
	| 'other-user'
	| 'wildcard-host'
	| 'dbeaver-grants'
	| 'schema-wide-grant'
	| 'ddl-on-table'
	| 'grant-option'
	| 'role'
	| 'no-tls'

/** Destino falso no modo produção. 'production' imita o banco da cliente com o wicomm_etl; os demais, o que não pode passar. */
const fakeProductionTarget = (scenario: tProductionScenario) => {
	const queries: string[] = []

	const identity = () => {
		if (scenario === 'other-hostname') return { ...PRODUCTION_IDENTITY, host: 'amo-etl-mysql-local' }

		if (scenario === 'other-uuid') return { ...PRODUCTION_IDENTITY, uuid: '00000000-0000-0000-0000-000000000000' }

		if (scenario === 'other-user') return { ...PRODUCTION_IDENTITY, user: 'dbeaver@%' }

		if (scenario === 'wildcard-host') return { ...PRODUCTION_IDENTITY, user: 'wicomm_etl@%' }

		return PRODUCTION_IDENTITY
	}

	const grants = () => {
		if (scenario === 'dbeaver-grants') return [{ g: `GRANT ALL PRIVILEGES ON *.* TO ${PRODUCTION_USER_AT}` }]

		if (scenario === 'schema-wide-grant') {
			return [...PRODUCTION_GRANTS, { g: `GRANT SELECT, INSERT ON \`mascavo_etl\`.* TO ${PRODUCTION_USER_AT}` }]
		}

		if (scenario === 'ddl-on-table') {
			return [
				...PRODUCTION_GRANTS,
				{ g: `GRANT DROP ON \`mascavo_etl\`.\`vtex_orders\` TO ${PRODUCTION_USER_AT}` }
			]
		}

		if (scenario === 'grant-option') {
			return [
				...PRODUCTION_GRANTS,
				{
					g: `GRANT SELECT ON \`mascavo_etl\`.\`vtex_products\` TO ${PRODUCTION_USER_AT} WITH GRANT OPTION`
				}
			]
		}

		if (scenario === 'role') return [...PRODUCTION_GRANTS, { g: `GRANT \`dba\`@\`%\` TO ${PRODUCTION_USER_AT}` }]

		return PRODUCTION_GRANTS
	}

	const source: iConnectionSource = {
		getConnection: async () => ({
			query: async (sql: string) => {
				queries.push(sql)

				if (sql.includes('etl_local_meta')) throw new Error("Table 'etl_local_meta.marker' doesn't exist")

				if (sql.includes('@@server_uuid')) return [[identity()], []]

				if (sql.includes('Ssl_cipher')) {
					const cipher = scenario === 'no-tls' ? '' : 'TLS_AES_256_GCM_SHA384'

					return [[{ Variable_name: 'Ssl_cipher', Value: cipher }], []]
				}

				if (sql === 'SHOW GRANTS') return [grants(), []]

				return [{ affectedRows: 1 }, []]
			},
			release: () => undefined
		})
	}

	return { source, queries }
}

/** Banco da cliente falso, para o ref-reader. `grants` simula o SHOW GRANTS do usuário de leitura. */
const fakeReference = (grants: string[] = ['GRANT SELECT, SHOW VIEW ON `mascavo_etl`.* TO `leitura`@`%`']) => {
	const queries: string[] = []
	let released = 0
	const source: iConnectionSource = {
		getConnection: async () => ({
			query: async (sql: string) => {
				queries.push(sql)

				if (sql === 'SHOW GRANTS') return [grants.map(line => ({ g: line })), []]

				if (sql.startsWith('SHOW CREATE TABLE')) return [[{ 'Create Table': 'CREATE TABLE `x` (id int)' }], []]

				return [[{ ok: 1 }], []]
			},
			release: () => {
				released += 1
			}
		})
	}

	return { source, queries, released: () => released }
}

export { fakeProductionTarget, fakeReference, fakeTarget }
export type { tProductionScenario, tTargetScenario }
