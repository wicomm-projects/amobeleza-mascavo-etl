import { AppError, HttpError } from '../../core/errors.js'

/**
 * Erro de gravação sem dado pessoal. O mysql2 anexa ao erro o SQL completo, com os valores (`err.sql`: nomes, e-mails,
 * documentos, endereços), e o runner loga o erro inteiro. Aqui o erro é refeito só com o código e a mensagem do MySQL,
 * sem `cause`, e os valores citados na mensagem ("Duplicate entry '...'", "Incorrect string value: '...'") são omitidos;
 * sobram nomes de coluna e de chave.
 *
 * Erro do próprio ETL (AppError e filhos) passa como está: a mensagem dele já não leva dado de cliente.
 */

const MAX_MESSAGE_LENGTH = 300
const QUOTED_VALUE = /\b(value|entry):?\s*'(?:[^'\\]|\\.)*'/gi

const scrubbedMessage = (message: string): string =>
	message.replace(QUOTED_VALUE, "$1 '[omitido]'").slice(0, MAX_MESSAGE_LENGTH)

const withoutSqlPayload = (err: unknown): Error => {
	if (err instanceof AppError) return err

	const message = err instanceof Error ? err.message : String(err)
	const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : undefined

	return new AppError(`Gravação recusada pelo banco${code ? ` (${code})` : ''}: ${scrubbedMessage(message)}`)
}

/** Falha de transporte (HTTP ou rede): credencial, permissão ou API fora do ar — não um pedido ruim. */
const isTransportFailure = (reason: unknown): boolean => reason instanceof HttpError

export { isTransportFailure, scrubbedMessage, withoutSqlPayload }
