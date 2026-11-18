import { type Logger, type LoggerOptions, pino } from 'pino'

import { getEnv } from './env.js'

/**
 * Logger central. O `redact` é a rede de segurança: mesmo que um log acidental leve headers ou credenciais, o pino remove
 * antes de escrever. A regra primária continua sendo não logar payload de API (só contagens e IDs) — pedidos e clientes
 * têm dado pessoal.
 */
const REDACT_PATHS = [
	'*.headers',
	'*.*.headers',
	'*.config.headers',
	'err.config.headers',
	'err.cause.config.headers',
	'*.*.password',
	'*.*.appToken',
	'*.*.token',
	'*.password',
	'*.appKey',
	'*.appToken',
	'*.token',
	'*.gumgaToken',
	'*.authorization',
	"*['x-vtex-api-appkey']",
	"*['x-vtex-api-apptoken']",
	'req.headers',
	'res.headers'
]

let cachedLogger: Logger | null = null

const getLogger = (): Logger => {
	if (cachedLogger) return cachedLogger

	const env = getEnv()

	const options: LoggerOptions = {
		level: env.LOG_LEVEL,
		base: { app: 'amobeleza-mascavo-etl' },
		redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
		formatters: { level: label => ({ level: label }) },
		timestamp: pino.stdTimeFunctions.isoTime
	}

	// pino-pretty roda numa worker thread e só faz sentido num terminal interativo. Na VPS a saída é JSON (journald).
	if (env.NODE_ENV === 'development' && process.stdout.isTTY) {
		cachedLogger = pino({
			...options,
			transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
		})

		return cachedLogger
	}

	cachedLogger = pino(options)

	return cachedLogger
}

/** Uso exclusivo em testes. */
const resetLoggerCache = () => {
	cachedLogger = null
}

export { getLogger, resetLoggerCache }
