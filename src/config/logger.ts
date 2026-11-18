import { type Logger, type LoggerOptions, pino } from 'pino'

import { sanitizeErrorChain } from '../core/errors.js'

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
	'res.headers',
	// Erro do mysql2: o SQL montado e a mensagem do servidor carregam valores (dado pessoal).
	'*.sql',
	'*.sqlMessage',
	'*.*.sql',
	'*.*.sqlMessage',
	'err.cause.sql',
	'err.cause.sqlMessage'
]

/**
 * Serializador de erro: erro do driver MySQL vira DatabaseError (só código e coluna) antes de ir para o log, inclusive
 * quando está na cadeia de `cause` de outro erro. O redact
 * acima é a segunda camada, para o caso de um erro do driver chegar embrulhado em outro objeto.
 */
const serializeError = (value: unknown) => pino.stdSerializers.err(sanitizeErrorChain(value) as Error)

let cachedLogger: Logger | null = null

const getLogger = (): Logger => {
	if (cachedLogger) return cachedLogger

	const env = getEnv()

	const options: LoggerOptions = {
		level: env.LOG_LEVEL,
		base: { app: 'amobeleza-mascavo-etl' },
		redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
		serializers: { err: serializeError },
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

export { REDACT_PATHS, getLogger, resetLoggerCache, serializeError }
