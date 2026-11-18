import axios, { AxiosError, type AxiosInstance } from 'axios'

import { getLogger } from '../../config/index.js'
import { sleep } from '../concurrency.js'
import { HttpError, SafetyError } from '../errors.js'

/**
 * Cliente HTTP SÓ DE LEITURA para as fontes (VTEX, AnyMarket).
 *
 * A interface expõe apenas `get`: não existe caminho no código para POST, PUT, PATCH ou DELETE nessas APIs, então o ETL
 * não consegue alterar nada na loja nem no marketplace, nem por engano. O método é fixo em 'GET' na chamada ao axios.
 *
 * Retentativa com espera exponencial (base × 2^tentativa, com jitter) em falha de rede, timeout, 429 e 5xx. Respeita o
 * header Retry-After quando vier. Erro 4xx (exceto 429) não é retentado: é credencial errada ou rota inexistente.
 */

type tQueryParams = Record<string, string | number | boolean | undefined>

interface iGetClient {
	get: <T = unknown>(path: string, params?: tQueryParams) => Promise<T>
}

interface iGetClientOptions {
	/** Nome da fonte, só para log e erro (ex.: "vtex:mascavo"). */
	source: string
	baseURL: string
	/** Headers fixos (credenciais). Nunca são logados. */
	headers: Record<string, string>
	timeoutMs: number
	maxAttempts: number
	/** Base da espera entre tentativas. Padrão 500 ms. */
	backoffBaseMs?: number
	/** Teto de espera por tentativa, inclusive vindo do Retry-After. Padrão 60 s. */
	maxDelayMs?: number
}

const DEFAULT_BACKOFF_BASE_MS = 500
const DEFAULT_MAX_DELAY_MS = 60_000
const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500

const isRetryableStatus = (status: number): boolean =>
	status === HTTP_TOO_MANY_REQUESTS || status >= HTTP_SERVER_ERROR_MIN

/** Retry-After pode vir em segundos ("120") ou como data HTTP. Devolve ms, ou undefined se ausente/ilegível. */
const parseRetryAfter = (value: unknown, now: number = Date.now()): number | undefined => {
	if (typeof value !== 'string' || value.trim() === '') return undefined

	const seconds = Number(value)

	if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

	const date = Date.parse(value)

	if (Number.isNaN(date)) return undefined

	return Math.max(0, date - now)
}

const backoffDelay = (attempt: number, baseMs: number, maxMs: number): number => {
	const exponential = baseMs * 2 ** attempt
	const jitter = Math.random() * baseMs

	return Math.min(maxMs, exponential + jitter)
}

const createGetClient = (options: iGetClientOptions): iGetClient => {
	const backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS
	const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS

	const instance: AxiosInstance = axios.create({
		baseURL: options.baseURL,
		timeout: options.timeoutMs,
		headers: { Accept: 'application/json', ...options.headers },
		// O status é tratado aqui embaixo; o axios não lança por status.
		validateStatus: () => true,
		// As credenciais vão nos headers: nunca para outro host. Sem URL absoluta e sem seguir redirect.
		allowAbsoluteUrls: false,
		maxRedirects: 0
	})

	const get = async <T>(path: string, params?: tQueryParams): Promise<T> => {
		const logger = getLogger()

		// Link "next" de paginação vem absoluto: o conector converte para caminho relativo antes de chamar.
		if (!path.startsWith('/') || path.startsWith('//')) {
			throw new SafetyError(`${options.source}: só caminho relativo ao baseURL ("/..."), recebido ${path}`)
		}

		for (let attempt = 0; attempt < options.maxAttempts; attempt += 1) {
			const startedAt = Date.now()
			const isLastAttempt = attempt === options.maxAttempts - 1

			try {
				const response = await instance.request<T>({ method: 'GET', url: path, params })

				logger.debug(
					{
						source: options.source,
						path,
						status: response.status,
						attempt,
						durationMs: Date.now() - startedAt
					},
					'GET concluído'
				)

				if (response.status >= 200 && response.status < 300) return response.data

				const retryable = isRetryableStatus(response.status)

				if (!retryable || isLastAttempt) {
					throw new HttpError({
						source: options.source,
						path,
						status: response.status,
						retryable,
						message: `${options.source}: GET ${path} respondeu ${response.status}`
					})
				}

				const retryAfter = parseRetryAfter(response.headers['retry-after'])
				const delay = Math.min(maxDelayMs, retryAfter ?? backoffDelay(attempt, backoffBaseMs, maxDelayMs))

				logger.warn(
					{ source: options.source, path, status: response.status, attempt, delayMs: Math.round(delay) },
					'GET com falha temporária, nova tentativa'
				)
				await sleep(delay)
			} catch (err) {
				if (err instanceof HttpError) throw err

				if (!(err instanceof AxiosError)) throw err

				if (isLastAttempt) {
					throw new HttpError({
						source: options.source,
						path,
						retryable: true,
						message: `${options.source}: GET ${path} falhou na rede (${err.code ?? 'sem código'})`,
						cause: err
					})
				}

				const delay = backoffDelay(attempt, backoffBaseMs, maxDelayMs)

				logger.warn(
					{ source: options.source, path, code: err.code, attempt, delayMs: Math.round(delay) },
					'GET com falha de rede, nova tentativa'
				)
				await sleep(delay)
			}
		}

		// Inalcançável: a última tentativa sempre retorna ou lança. Mantido para o compilador.
		throw new HttpError({
			source: options.source,
			path,
			retryable: false,
			message: `${options.source}: GET ${path} sem tentativas`
		})
	}

	return { get }
}

export { createGetClient, isRetryableStatus, parseRetryAfter }
export type { iGetClient, iGetClientOptions, tQueryParams }
