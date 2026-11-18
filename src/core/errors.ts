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

export { AppError, HttpError, NotConfiguredError, SafetyError }
