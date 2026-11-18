import type { Logger } from 'pino'

import { getEnv, type tEnv } from '../../config/index.js'
import { sleep } from '../../core/concurrency.js'
import { AppError, HttpError, NotConfiguredError, SafetyError } from '../../core/errors.js'
import { createGetClient, type iGetClient, type tQueryParams } from '../../core/http/transport.js'

import { ordersPageSchema, type tOrdersPage } from './schemas.js'

/**
 * Cliente do AnyMarket (API v2 Backoffice), SÓ LEITURA: usa o transporte do núcleo, que só tem GET, só aceita caminho
 * relativo ao ANYMARKET_BASE_URL e não segue redirect. O gumgaToken nunca sai para outro host.
 *
 * Paginação (https://developers.anymarket.com.br/knowing_anymarket/first_steps/rules_api): envelope
 * `{ links, content, page }`, `offset`/`limit` (máx. 100). O link `next` vem ABSOLUTO; aqui ele é conferido (mesmo host,
 * mesmo caminho base) e reduzido a caminho relativo + parâmetros. Os filtros da janela são reaplicados por cima do link:
 * se a API devolver um `next` sem os filtros, a carga não sai varrendo todos os pedidos.
 *
 * Limite de requisições: no 429 o AnyMarket manda `ratelimit-reset` (segundos), não `Retry-After`. O transporte do núcleo
 * já tenta de novo com espera exponencial curta; se ainda assim vier 429, o conector espera a janela de 1 minuto renovar
 * e repete a mesma página, até RATE_LIMIT_MAX_ROUNDS vezes.
 */

const SOURCE = 'anymarket'
const ORDERS_PATH = '/orders'

/** Máximo da API (rules_api: "de 20 a no máximo 100"; spec do /orders: 5 a 100). */
const PAGE_LIMIT = 100

/**
 * Identificação do sistema integrador. A especificação só exige `gumgaToken`; o guia oficial de integração diz que
 * `platform` também é obrigatório e dá exemplos (TOTVS, WINTHOR, ERP_PROPRIO). Valor assumido, a confirmar com o token.
 */
const PLATFORM_HEADER = 'ERP_PROPRIO'

/** A janela do limite é de 1 minuto (cabeçalho ratelimit-remaining: "requisições restantes no minuto atual"). */
const RATE_LIMIT_WAIT_MS = 60_000
const RATE_LIMIT_MAX_ROUNDS = 3
const HTTP_TOO_MANY_REQUESTS = 429

/** Trava contra laço infinito (link `next` que nunca acaba). Um dia de pedidos fica muito abaixo disso. */
const MAX_PAGES_PER_WINDOW = 1000

interface iRelativeRequest {
	path: string
	params: tQueryParams
}

interface iAnymarketClient {
	baseURL: string
	http: iGetClient
}

const createAnymarketClient = (env: tEnv = getEnv()): iAnymarketClient => {
	const token = env.ANYMARKET_TOKEN

	if (!token) throw new NotConfiguredError('AnyMarket: ANYMARKET_TOKEN vazio no .env (aguardando chave).')

	return {
		baseURL: env.ANYMARKET_BASE_URL,
		http: createGetClient({
			source: SOURCE,
			baseURL: env.ANYMARKET_BASE_URL,
			headers: { gumgaToken: token, platform: PLATFORM_HEADER },
			timeoutMs: env.HTTP_TIMEOUT_MS,
			maxAttempts: env.HTTP_MAX_ATTEMPTS
		})
	}
}

/**
 * Link de paginação absoluto → caminho relativo ao baseURL + parâmetros. Recusa link de outro host ou fora do caminho
 * base (ex.: baseURL `https://api.anymarket.com.br/v2` e link `https://api.anymarket.com.br/v2/orders?offset=100`
 * → `{ path: '/orders', params: { offset: '100' } }`). O esquema (http/https) do link não importa: a chamada sempre sai
 * pelo baseURL do .env.
 */
const relativeFromLink = (href: string, baseURL: string): iRelativeRequest => {
	const base = new URL(baseURL)
	let link: URL

	try {
		link = new URL(href, base)
	} catch {
		throw new SafetyError(`${SOURCE}: link de paginação ilegível.`)
	}

	if (link.hostname !== base.hostname) {
		throw new SafetyError(`${SOURCE}: link de paginação aponta para outro host (${link.hostname}); recusado.`)
	}

	const basePath = base.pathname.replace(/\/+$/, '')

	if (!link.pathname.startsWith(`${basePath}/`)) {
		throw new SafetyError(`${SOURCE}: link de paginação fora do caminho base ${basePath || '/'}; recusado.`)
	}

	return { path: link.pathname.slice(basePath.length), params: Object.fromEntries(link.searchParams) }
}

/** GET com uma camada a mais de espera para o 429 (o transporte já tentou HTTP_MAX_ATTEMPTS vezes). */
const getWithRateLimit = async (
	client: iAnymarketClient,
	request: iRelativeRequest,
	logger: Logger
): Promise<unknown> => {
	for (let round = 0; ; round += 1) {
		try {
			return await client.http.get<unknown>(request.path, request.params)
		} catch (err) {
			const rateLimited = err instanceof HttpError && err.status === HTTP_TOO_MANY_REQUESTS

			if (!rateLimited || round >= RATE_LIMIT_MAX_ROUNDS) throw err

			logger.warn(
				{ source: SOURCE, path: request.path, round: round + 1, waitMs: RATE_LIMIT_WAIT_MS },
				'AnyMarket: limite de requisições (429); aguardando a janela renovar'
			)
			await sleep(RATE_LIMIT_WAIT_MS)
		}
	}
}

const parsePage = (raw: unknown): tOrdersPage => {
	const parsed = ordersPageSchema.safeParse(raw)

	if (parsed.success) return parsed.data

	const where = parsed.error.issues.map(issue => issue.path.join('.') || '(raiz)').join(', ')

	throw new AppError(`${SOURCE}: resposta de ${ORDERS_PATH} fora do formato paginado esperado (${where}).`)
}

const offsetOf = (params: tQueryParams): number => Number(params.offset ?? 0)

/**
 * Percorre as páginas de `GET /orders` com os filtros dados (ex.: updatedAfter/updatedBefore), seguindo o link `next`.
 * Para quando não há `next` ou a página vem vazia. No fim, compara o recebido com o `page.totalElements` da primeira
 * página: diferença vira aviso no log (pedido que mudou durante a paginação desloca o offset; ver docs do conector).
 */
async function* listOrderPages(
	client: iAnymarketClient,
	filters: Record<string, string>,
	logger: Logger
): AsyncGenerator<tOrdersPage> {
	let request: iRelativeRequest = { path: ORDERS_PATH, params: { ...filters, offset: 0, limit: PAGE_LIMIT } }
	let expected: number | null | undefined
	let received = 0

	for (let pageIndex = 0; pageIndex < MAX_PAGES_PER_WINDOW; pageIndex += 1) {
		const page = parsePage(await getWithRateLimit(client, request, logger))

		expected ??= page.page?.totalElements
		received += page.content.length
		yield page

		const next = page.links.find(link => link.rel === 'next')

		if (!next || page.content.length === 0) {
			if (typeof expected === 'number' && received !== expected) {
				logger.warn(
					{ source: SOURCE, expected, received, pages: pageIndex + 1 },
					'AnyMarket: total recebido diferente do totalElements da primeira página'
				)
			}

			return
		}

		const link = relativeFromLink(next.href, client.baseURL)

		if (link.path !== ORDERS_PATH) {
			throw new SafetyError(`${SOURCE}: link next aponta para ${link.path}, esperado ${ORDERS_PATH}; recusado.`)
		}

		const nextOffset = offsetOf(link.params)

		if (!Number.isInteger(nextOffset) || nextOffset <= offsetOf(request.params)) {
			throw new AppError(`${SOURCE}: o link next não avança o offset (${String(link.params.offset)}).`)
		}

		request = { path: ORDERS_PATH, params: { ...link.params, ...filters, offset: nextOffset, limit: PAGE_LIMIT } }
	}

	throw new AppError(`${SOURCE}: passou de ${MAX_PAGES_PER_WINDOW} páginas numa janela; reduza a janela.`)
}

/** Data com fuso explícito, no formato do exemplo da API (`2021-11-25T14:00:00-03:00`), em UTC. */
const formatApiDate = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, '+00:00')

/**
 * Checagem mínima do token: `GET /orders` numa janela de 1 segundo no ano 2000, que não tem pedido. Prova que o token
 * lê pedidos sem trazer dado da cliente; só o formato do envelope é conferido. Se a API recusar a janela (400/422), a
 * autenticação já passou (401 viria antes): o token vale.
 */
const CHECK_WINDOW = { createdAfter: '2000-01-01T00:00:00+00:00', createdBefore: '2000-01-01T00:00:01+00:00' }
const CHECK_LIMIT = 5

const HTTP_BAD_REQUEST = 400
const HTTP_UNAUTHORIZED = 401
const HTTP_FORBIDDEN = 403
const HTTP_UNPROCESSABLE = 422

const checkOrdersAccess = async (client: iAnymarketClient = createAnymarketClient()) => {
	try {
		const raw = await client.http.get<unknown>(ORDERS_PATH, { ...CHECK_WINDOW, offset: 0, limit: CHECK_LIMIT })
		const page = ordersPageSchema.safeParse(raw)

		if (!page.success) {
			return { ok: false, detail: `GET ${ORDERS_PATH} respondeu, mas fora do formato paginado esperado` }
		}

		return { ok: true, detail: `GET ${ORDERS_PATH} respondeu no formato paginado (janela de teste vazia)` }
	} catch (err) {
		if (err instanceof HttpError && (err.status === HTTP_UNAUTHORIZED || err.status === HTTP_FORBIDDEN)) {
			return {
				ok: false,
				detail: `token recusado (${err.status}): confira ANYMARKET_TOKEN e se ele é do mesmo ambiente do ANYMARKET_BASE_URL`
			}
		}

		if (err instanceof HttpError && (err.status === HTTP_BAD_REQUEST || err.status === HTTP_UNPROCESSABLE)) {
			return {
				ok: true,
				detail: `token aceito (a API respondeu ${err.status} à janela de teste, depois de autenticar)`
			}
		}

		throw err
	}
}

export {
	ORDERS_PATH,
	PAGE_LIMIT,
	checkOrdersAccess,
	createAnymarketClient,
	formatApiDate,
	listOrderPages,
	relativeFromLink
}
export type { iAnymarketClient, iRelativeRequest }
