import { AppError } from '../../core/errors.js'

import type { iVtexApi } from './client.js'
import type { tListOrder } from './schemas.js'

/**
 * Lista todos os pedidos criados numa janela, respeitando o teto da API de lista do OMS: no máximo 100 por página e 30
 * páginas por consulta (3.000 pedidos). Se a janela tem mais que isso, ela é dividida ao meio, recursivamente, até cada
 * pedaço caber. O filtro é `f_creationDate=creationDate:[início TO fim]` (formato da doc da VTEX), com ordenação por
 * data de criação para a paginação ficar estável.
 *
 * Pedido repetido entre páginas ou pedaços (a lista muda enquanto é lida) entra uma vez só.
 */

const PER_PAGE = 100
const MAX_PAGES = 30
const MAX_ORDERS_PER_QUERY = PER_PAGE * MAX_PAGES
/** Abaixo disso não divide mais: 3.000 pedidos no mesmo minuto é sinal de filtro quebrado, não de volume real. */
const MIN_WINDOW_MS = 60_000

interface iWindow {
	from: Date
	to: Date
}

interface iListStats {
	/** Consultas (janelas) feitas, contando as divididas. */
	windows: number
	pages: number
}

const creationDateFilter = ({ from, to }: iWindow): string =>
	`creationDate:[${from.toISOString()} TO ${to.toISOString()}]`

/**
 * Duas metades que se tocam no meio: [from, meio] e [meio, to]. A VTEX guarda creationDate com até 7 casas decimais;
 * com [meio + 1 ms, to], um pedido entre meio e meio + 1 ms não cairia em nenhuma. O pedido exatamente no meio vem nas
 * duas e o mapa por orderId tira a repetição.
 */
const splitWindow = ({ from, to }: iWindow): [iWindow, iWindow] => {
	const middle = new Date(from.getTime() + Math.floor((to.getTime() - from.getTime()) / 2))

	return [
		{ from, to: middle },
		{ from: middle, to }
	]
}

const listOrdersInWindow = async (
	api: Pick<iVtexApi, 'listOrders'>,
	window: iWindow
): Promise<{ orders: tListOrder[]; stats: iListStats }> => {
	if (window.from.getTime() > window.to.getTime()) {
		throw new AppError(`Janela inválida: ${window.from.toISOString()} depois de ${window.to.toISOString()}`)
	}

	const byId = new Map<string, tListOrder>()
	const stats: iListStats = { windows: 0, pages: 0 }

	const fetchPage = async (current: iWindow, page: number) => {
		stats.pages += 1

		return api.listOrders({
			f_creationDate: creationDateFilter(current),
			orderBy: 'creationDate,asc',
			per_page: PER_PAGE,
			page
		})
	}

	const visit = async (current: iWindow): Promise<void> => {
		stats.windows += 1
		const first = await fetchPage(current, 1)

		if (first.paging.total > MAX_ORDERS_PER_QUERY) {
			if (current.to.getTime() - current.from.getTime() < MIN_WINDOW_MS) {
				throw new AppError(
					`Mais de ${MAX_ORDERS_PER_QUERY} pedidos em menos de 1 minuto (${current.from.toISOString()}); confira o filtro.`
				)
			}

			const [left, right] = splitWindow(current)

			await visit(left)
			await visit(right)

			return
		}

		first.list.forEach(order => byId.set(order.orderId, order))

		const pages = Math.min(first.paging.pages, MAX_PAGES)

		for (let page = 2; page <= pages; page += 1) {
			const next = await fetchPage(current, page)

			next.list.forEach(order => byId.set(order.orderId, order))

			if (next.list.length === 0) break
		}
	}

	await visit(window)

	return { orders: [...byId.values()], stats }
}

export { creationDateFilter, listOrdersInWindow, MAX_ORDERS_PER_QUERY, splitWindow }
export type { iListStats, iWindow }
