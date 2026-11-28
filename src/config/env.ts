import { z } from 'zod'

import { DATABASES } from './databases.js'
import { PRODUCTION_TARGET } from './production-target.js'

/**
 * Variáveis de ambiente do ETL, validadas com zod na primeira chamada (fail-fast).
 *
 * Cada fonte (VTEX por marca, GA4 por marca, AnyMarket, banco de referência) é um grupo OPCIONAL: sem as chaves, a fonte
 * aparece como "aguardando chave" e o processo continua. Se só parte do grupo vier preenchida, a validação falha — evita
 * descobrir na hora da carga que faltou o AppToken.
 *
 * Travas desta etapa (ver docs/adr/2026-11-18-travas-de-escrita.md):
 * - Nenhum usuário de banco pode ser `root` (nem no destino, nem na referência).
 * - Destino (TARGET_DB_*) em dois modos (docs/adr/2026-11-27-modo-producao-do-destino.md):
 *   - `TARGET_MODE=local` (padrão): só o MySQL local (host loopback; o target-guard confere o marcador do Docker);
 *   - `TARGET_MODE=production`: só o MySQL da cliente de PRODUCTION_TARGET (host no `.env`, nunca loopback; porta e
 *     usuário fixos no código; o target-guard confere servidor, TLS, usuário e grants antes de gravar).
 * - O servidor HTTP só escuta em loopback.
 */

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1'] as const

/** Destino aceito: só loopback (o Docker publica a porta em 127.0.0.1). A identidade real é conferida no servidor. */
const LOCAL_DB_HOSTS = LOOPBACK_HOSTS

const FORBIDDEN_DB_USERS = ['root']

const TARGET_MODES = ['local', 'production'] as const

/** "job" ou "job:marca" (ex.: anymarket-orders, vtex-orders:mascavo). */
const TARGET_JOB_PATTERN = /^[a-z0-9-]+(:[a-z0-9]+)?$/

/**
 * Lista separada por vírgula, opcional. Sem a variável: undefined (sem restrição). Presente e vazia: erro, porque um
 * vazio por engano não pode virar "todos".
 */
const optionalList = (name: string, item: z.ZodType<string, string>) =>
	z
		.string()
		.optional()
		.transform(value =>
			value === undefined
				? undefined
				: value
						.split(',')
						.map(entry => entry.trim())
						.filter(entry => entry !== '')
		)
		.pipe(
			z
				.array(item)
				.min(1, `${name} presente e vazio: informe ao menos um valor (ou apague a variável).`)
				.optional()
		)

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

interface iTargetFields {
	TARGET_MODE: (typeof TARGET_MODES)[number]
	TARGET_DB_HOST: string
	TARGET_DB_PORT: number
	TARGET_DB_USER?: string | undefined
	TARGET_DB_PASSWORD?: string | undefined
}

/**
 * Host, porta e usuário do destino conforme o modo. No modo produção, o host (só no `.env`, fora do Git) nunca é
 * loopback: a gravação na produção só sai da VPS, que é o IP liberado para o wicomm_etl (um túnel do computador do dev
 * apareceria como 127.0.0.1 e é recusado aqui). Que o host é mesmo o banco da cliente, o target-guard confere no servidor
 * (`@@server_uuid`); porta e usuário têm de ser os de PRODUCTION_TARGET.
 */
const checkTargetMode = (env: iTargetFields, ctx: z.RefinementCtx): void => {
	if (env.TARGET_MODE === 'local') {
		if ((LOCAL_DB_HOSTS as readonly string[]).includes(env.TARGET_DB_HOST)) return

		ctx.addIssue({
			code: 'custom',
			path: ['TARGET_DB_HOST'],
			message:
				'No modo local o destino só pode ser o MySQL local (Docker). Gravar na produção exige TARGET_MODE=production.'
		})

		return
	}

	if ((LOOPBACK_HOSTS as readonly string[]).includes(env.TARGET_DB_HOST)) {
		ctx.addIssue({
			code: 'custom',
			path: ['TARGET_DB_HOST'],
			message:
				'No modo produção o destino é o endereço do banco da cliente, nunca loopback: a gravação só sai da VPS (sem túnel).'
		})
	}

	if (env.TARGET_DB_PORT !== PRODUCTION_TARGET.port) {
		ctx.addIssue({
			code: 'custom',
			path: ['TARGET_DB_PORT'],
			message: `No modo produção a porta é ${PRODUCTION_TARGET.port}.`
		})
	}

	if (env.TARGET_DB_USER === undefined || env.TARGET_DB_PASSWORD === undefined) {
		ctx.addIssue({
			code: 'custom',
			path: ['TARGET_DB_USER'],
			message: 'No modo produção, TARGET_DB_USER e TARGET_DB_PASSWORD são obrigatórios.'
		})

		return
	}

	if (env.TARGET_DB_USER !== PRODUCTION_TARGET.user) {
		ctx.addIssue({
			code: 'custom',
			path: ['TARGET_DB_USER'],
			message: `No modo produção o usuário só pode ser ${PRODUCTION_TARGET.user} (permissão mínima, tabela por tabela).`
		})
	}
}

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

		// Banco de DESTINO. `local` (padrão) = Docker; `production` = MySQL da cliente, só o de PRODUCTION_TARGET. Qualquer
		// outro valor é erro: um erro de digitação não pode virar produção nem passar calado. Host, porta e usuário são
		// conferidos por modo no superRefine (checkTargetMode).
		TARGET_MODE: z.enum(TARGET_MODES, { error: 'TARGET_MODE aceita só local ou production.' }).default('local'),
		TARGET_DB_HOST: z.string().trim().default('127.0.0.1'),
		// Bancos em que o ETL pode gravar, separados por vírgula. Sem a variável, os dois. Na virada só da Mascavo, a VPS usa
		// TARGET_DATABASES=mascavo_etl: o agendador não agenda os jobs da Amobeleza nem o AnyMarket (que grava em
		// amobeleza_etl), e o runner recusa gravar neles (dry-run continua livre).
		TARGET_DATABASES: z
			.string()
			.trim()
			.default(DATABASES.join(','))
			.transform(value =>
				value
					.split(',')
					.map(item => item.trim())
					.filter(item => item !== '')
			)
			.pipe(
				z
					.array(z.enum(DATABASES, { error: `TARGET_DATABASES aceita só ${DATABASES.join(' e ')}.` }))
					.min(1, 'TARGET_DATABASES vazio: informe ao menos um banco (ou apague a variável para os dois).')
			),
		// Jobs que podem gravar, além do banco liberado: "job" (todas as marcas) ou "job:marca". Sem a variável, todos os jobs
		// dos bancos de TARGET_DATABASES. Usada para gravar o AnyMarket (banco da Amobeleza) sem ligar VTEX e GA4 da
		// Amobeleza: TARGET_JOBS=vtex-orders:mascavo,vtex-catalog:mascavo,ga4:mascavo,anymarket-orders.
		TARGET_JOBS: optionalList(
			'TARGET_JOBS',
			z
				.string()
				.regex(TARGET_JOB_PATTERN, 'TARGET_JOBS: cada item é "job" ou "job:marca" (ex.: vtex-orders:mascavo).')
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
		// Contas do AnyMarket gravadas, pelo nome exato de `accountName` (ex.: MASCAVO). Sem a variável, todas. Com só MASCAVO,
		// as contas da Amobeleza não são tocadas: o job grava por id de pedido.
		ANYMARKET_ACCOUNTS: optionalList('ANYMARKET_ACCOUNTS', z.string()),

		// Cliente HTTP (VTEX, AnyMarket).
		HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
		HTTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(8).default(4),
		HTTP_CONCURRENCY: z.coerce.number().int().min(1).max(10).default(4)
	})
	.superRefine((env, ctx) => {
		checkTargetMode(env, ctx)

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

type tTargetMode = tEnv['TARGET_MODE']

/** Modo do destino (local ou produção), lido do env já validado. */
const getTargetMode = (): tTargetMode => getEnv().TARGET_MODE

export { getEnv, getTargetMode, parseEnv, resetEnvCache, LOCAL_DB_HOSTS, TARGET_MODES }
export type { tEnv, tTargetMode }
