import { z } from 'zod'

/**
 * Variáveis de ambiente do ETL, validadas com zod na primeira chamada (fail-fast).
 *
 * Cada fonte (VTEX por marca, GA4 por marca, AnyMarket, banco de referência) é um grupo OPCIONAL: sem as chaves, a fonte
 * aparece como "aguardando chave" e o processo continua. Se só parte do grupo vier preenchida, a validação falha — evita
 * descobrir na hora da carga que faltou o AppToken.
 *
 * Travas desta etapa (ver docs/adr/2026-11-18-travas-de-escrita.md):
 * - Nenhum usuário de banco pode ser `root` (nem no destino, nem na referência).
 * - O destino (TARGET_DB_*) só pode ser o MySQL local. Gravar na produção da cliente exige um PR próprio de liberação.
 * - O servidor HTTP só escuta em loopback.
 */

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const

/** Destino aceito: só loopback (o Docker publica a porta em 127.0.0.1). A identidade real é conferida no servidor. */
const LOCAL_DB_HOSTS = LOOPBACK_HOSTS

const FORBIDDEN_DB_USERS = ['root']

const optionalText = z
	.string()
	.trim()
	.transform(value => (value === '' ? undefined : value))
	.optional()

const booleanFlag = (defaultValue: 'true' | 'false') =>
	z
		.string()
		.trim()
		.default(defaultValue)
		.transform(value => value.toLowerCase() === 'true')

const dbUser = optionalText.refine(
	value => value === undefined || !FORBIDDEN_DB_USERS.includes(value.toLowerCase()),
	'O usuário root nunca é usado pelo ETL. Peça um usuário próprio à cliente.'
)

const envSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

		// Servidor de status (Express). Só loopback: na VPS ninguém de fora acessa; consulta via túnel SSH.
		HOST: z
			.string()
			.trim()
			.default('127.0.0.1')
			.refine(
				value => (LOOPBACK_HOSTS as readonly string[]).includes(value),
				'HOST precisa ser loopback (127.0.0.1, localhost ou ::1): o ETL não abre porta para fora.'
			),
		PORT: z.coerce.number().int().positive().default(3000),

		// Agendador interno (node-cron). Desligado por padrão: só liga na VPS, depois da liberação de cada fonte.
		SCHEDULER_ENABLED: booleanFlag('false'),

		// Banco de DESTINO. Nesta etapa só o MySQL local (Docker). O writer ainda confere o marcador etl_local_meta.marker.
		TARGET_DB_HOST: z
			.string()
			.trim()
			.default('127.0.0.1')
			.refine(
				value => (LOCAL_DB_HOSTS as readonly string[]).includes(value),
				'Nesta etapa o destino só pode ser o MySQL local (Docker). Gravar na produção exige o PR de liberação.'
			),
		TARGET_DB_PORT: z.coerce.number().int().positive().default(3307),
		TARGET_DB_USER: dbUser,
		TARGET_DB_PASSWORD: optionalText,

		// Banco de REFERÊNCIA (MySQL da cliente), SÓ LEITURA: schema:pull e paridade. Sem usuário próprio, fica vazio.
		REF_DB_HOST: optionalText,
		REF_DB_PORT: z.coerce.number().int().positive().default(3306),
		REF_DB_USER: dbUser,
		REF_DB_PASSWORD: optionalText,
		// Teto por consulta na produção (ms). Protege o servidor da cliente de uma consulta pesada por engano.
		REF_DB_MAX_EXECUTION_MS: z.coerce.number().int().min(1000).max(120000).default(30000),

		// VTEX — uma loja por marca. Ambiente padrão: vtexcommercestable.
		VTEX_MASCAVO_ACCOUNT: optionalText,
		VTEX_MASCAVO_ENVIRONMENT: z.string().trim().default('vtexcommercestable'),
		VTEX_MASCAVO_APP_KEY: optionalText,
		VTEX_MASCAVO_APP_TOKEN: optionalText,
		VTEX_AMOBELEZA_ACCOUNT: optionalText,
		VTEX_AMOBELEZA_ENVIRONMENT: z.string().trim().default('vtexcommercestable'),
		VTEX_AMOBELEZA_APP_KEY: optionalText,
		VTEX_AMOBELEZA_APP_TOKEN: optionalText,

		// GA4 — ID numérico da propriedade de cada marca. A conta de serviço vem de GOOGLE_APPLICATION_CREDENTIALS (caminho de
		// um JSON FORA do repositório), lida pela própria biblioteca do Google.
		GA4_MASCAVO_PROPERTY_ID: optionalText.refine(
			value => value === undefined || /^\d+$/.test(value),
			'GA4_MASCAVO_PROPERTY_ID é numérico'
		),
		GA4_AMOBELEZA_PROPERTY_ID: optionalText.refine(
			value => value === undefined || /^\d+$/.test(value),
			'GA4_AMOBELEZA_PROPERTY_ID é numérico'
		),
		GOOGLE_APPLICATION_CREDENTIALS: optionalText,

		// AnyMarket — uma integração só, todas as contas, gravada em amobeleza_etl.
		ANYMARKET_BASE_URL: z.url().default('https://api.anymarket.com.br/v2'),
		ANYMARKET_TOKEN: optionalText,

		// Cliente HTTP (VTEX, AnyMarket).
		HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
		HTTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(4),
		HTTP_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(4)
	})
	.superRefine((env, ctx) => {
		const groups: Record<string, (keyof typeof env)[]> = {
			'banco de destino': ['TARGET_DB_USER', 'TARGET_DB_PASSWORD'],
			'banco de referência': ['REF_DB_HOST', 'REF_DB_USER', 'REF_DB_PASSWORD'],
			'VTEX Mascavo': ['VTEX_MASCAVO_ACCOUNT', 'VTEX_MASCAVO_APP_KEY', 'VTEX_MASCAVO_APP_TOKEN'],
			'VTEX Amobeleza': ['VTEX_AMOBELEZA_ACCOUNT', 'VTEX_AMOBELEZA_APP_KEY', 'VTEX_AMOBELEZA_APP_TOKEN']
		}

		for (const [group, keys] of Object.entries(groups)) {
			const filled = keys.filter(key => env[key] !== undefined)

			if (filled.length === 0 || filled.length === keys.length) continue

			const missing = keys.filter(key => env[key] === undefined)

			ctx.addIssue({
				code: 'custom',
				path: [missing[0] as string],
				message: `Grupo "${group}" incompleto: falta ${missing.join(', ')}`
			})
		}

		const ga4PropertySet = env.GA4_MASCAVO_PROPERTY_ID !== undefined || env.GA4_AMOBELEZA_PROPERTY_ID !== undefined

		if (ga4PropertySet && env.GOOGLE_APPLICATION_CREDENTIALS === undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['GOOGLE_APPLICATION_CREDENTIALS'],
				message: 'GA4: com ID de propriedade preenchido, falta o caminho do JSON da conta de serviço'
			})
		}
	})

type tEnv = z.infer<typeof envSchema>

let cachedEnv: tEnv | null = null

/** Valida na primeira chamada e lança com uma linha por variável inválida. */
const parseEnv = (source: NodeJS.ProcessEnv): tEnv => {
	const parsed = envSchema.safeParse(source)

	if (!parsed.success) {
		const details = parsed.error.issues
			.map(issue => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
			.join('\n')

		throw new Error(`Configuração de ambiente inválida:\n${details}`)
	}

	return parsed.data
}

const getEnv = (): tEnv => {
	if (cachedEnv) return cachedEnv

	cachedEnv = parseEnv(process.env)

	return cachedEnv
}

/** Uso exclusivo em testes: força a revalidação após mudar process.env. */
const resetEnvCache = () => {
	cachedEnv = null
}

export { getEnv, parseEnv, resetEnvCache, LOCAL_DB_HOSTS }
export type { tEnv }
