/** Erro base da aplicação. `detail` nunca carrega segredo nem dado pessoal: vai para log. */
class AppError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options)
		this.name = new.target.name
	}
}

/**
 * Uma trava de segurança barrou a operação (gravar fora do banco local, tabela fora da lista, SQL que não é leitura na
 * produção...). Nunca deve ser capturado e ignorado: a operação inteira para.
 */
class SafetyError extends AppError {}

/** Falha de chamada HTTP a uma fonte (VTEX, AnyMarket). `path` vai sem querystring para não vazar filtros sensíveis. */
class HttpError extends AppError {
	readonly source: string
	readonly status?: number
	readonly path: string
	readonly retryable: boolean

	constructor(params: {
		source: string
		path: string
		status?: number
		retryable: boolean
		message: string
		cause?: unknown
	}) {
		super(params.message, { cause: params.cause })
		this.source = params.source
		this.status = params.status
		this.path = params.path
		this.retryable = params.retryable
	}
}

/** A fonte ainda não tem credencial no .env. Não é erro de execução: a carga é pulada como "aguardando chave". */
class NotConfiguredError extends AppError {}

/**
 * Erro do MySQL sem dado: só código, número e, quando der, o nome da coluna ou da chave. O erro original do mysql2 traz
 * em `sql` o comando montado e, na mensagem, valores ("Duplicate entry 'joao@x.com' for key ..."): com pedidos e
 * compradores, isso é dado pessoal que não pode ir para log, /status nem relatório. O original não é guardado em `cause`.
 */
class DatabaseError extends AppError {
	readonly code?: string
	readonly errno?: number

	constructor(params: { code?: string; errno?: number; column?: string; key?: string }) {
		const where = [params.column && `coluna ${params.column}`, params.key && `chave ${params.key}`]
			.filter(Boolean)
			.join(', ')

		super(
			`Erro do banco ${params.code ?? 'sem código'}${params.errno ? ` (${params.errno})` : ''}${where ? `: ${where}` : ''}`
		)
		this.code = params.code
		this.errno = params.errno
	}
}

const isDriverError = (err: unknown): err is { code?: unknown; errno?: unknown; message?: unknown } =>
	typeof err === 'object' && err !== null && ('sql' in err || 'sqlMessage' in err || 'sqlState' in err)

/** Troca um erro do driver MySQL por DatabaseError (sem SQL nem valores). Qualquer outro erro passa como está. */
const sanitizeDbError = (err: unknown): unknown => {
	if (!isDriverError(err)) return err

	const message = typeof err.message === 'string' ? err.message : ''

	return new DatabaseError({
		code: typeof err.code === 'string' ? err.code : undefined,
		errno: typeof err.errno === 'number' ? err.errno : undefined,
		column: /column '([A-Za-z0-9_]+)'/i.exec(message)?.[1],
		key: /for key '([A-Za-z0-9_.]+)'/i.exec(message)?.[1]
	})
}

const MAX_CAUSE_DEPTH = 5

/**
 * Sanitiza o erro e toda a cadeia de `cause`: o serializador do pino escreve a mensagem e a pilha das causas, então um
 * erro do driver embrulhado em outro também vazaria. Não altera o erro original: devolve uma cópia quando precisa.
 */
const sanitizeErrorChain = (value: unknown, depth = 0): unknown => {
	const sanitized = sanitizeDbError(value)

	if (depth >= MAX_CAUSE_DEPTH || !(sanitized instanceof Error) || sanitized.cause === undefined) return sanitized

	const cause = sanitizeErrorChain(sanitized.cause, depth + 1)

	if (cause === sanitized.cause) return sanitized

	const copy = Object.assign(Object.create(Object.getPrototypeOf(sanitized) as object) as Error, sanitized)

	Object.defineProperties(copy, {
		message: { value: sanitized.message, writable: true, configurable: true },
		stack: { value: sanitized.stack, writable: true, configurable: true },
		cause: { value: cause, writable: true, configurable: true }
	})

	return copy
}

export { AppError, DatabaseError, HttpError, NotConfiguredError, SafetyError, sanitizeDbError, sanitizeErrorChain }
