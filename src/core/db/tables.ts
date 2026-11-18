/**
 * Tabelas internas do Laravel da WPP (lista da doc da Mascavo, p. 46–49). Ficam nos dois bancos da cliente e NUNCA entram
 * no código: nem leitura, nem escrita. `telescope_entries` sozinha tem 193 GB na Amobeleza — um SELECT nela pesaria no
 * servidor de produção.
 */
const LARAVEL_TABLES: ReadonlySet<string> = new Set([
	'failed_jobs',
	'migrations',
	'users',
	'password_resets',
	'personal_access_tokens'
])

const LARAVEL_TABLE_PREFIXES = ['telescope_', 'health_check_'] as const

const isLaravelTable = (table: string): boolean => {
	const name = table.toLowerCase()

	return LARAVEL_TABLES.has(name) || LARAVEL_TABLE_PREFIXES.some(prefix => name.startsWith(prefix))
}

/** Nome de tabela, banco ou coluna aceito pelo ETL: letras, números e underline. Barra injeção por nome antes do escapeId. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/

const isSafeIdentifier = (value: string): boolean => SAFE_IDENTIFIER.test(value)

/** Banco local que prova que o destino é o Docker de desenvolvimento (ver db/init/00-local.sql). */
const LOCAL_MARKER = { schema: 'etl_local_meta', table: 'marker', env: 'local-dev' } as const

export { LOCAL_MARKER, isLaravelTable, isSafeIdentifier }
