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

					if (sql === 'SHOW GRANTS') return [grants(), []]

					return [{ affectedRows: 1 }, []]
				},
				release: () => undefined
			}
		}
	}

	return { source, queries, connections: () => connections }
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

export { fakeReference, fakeTarget }
export type { tTargetScenario }
