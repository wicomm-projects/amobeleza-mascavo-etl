import { getBrandConfig, getEnv, type tBrand, type tDatabase } from '../../config/index.js'
import { runWithConcurrency } from '../../core/concurrency.js'
import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iJob, iJobContext, iRunSummary } from '../../core/jobs/types.js'

import { accountOf, createBrandApi } from './client.js'
import { loadOrdersFixture } from './fixtures.js'
import { listOrdersInWindow } from './orders-window.js'
import type { tListOrder, tOrderDetail } from './schemas.js'
import { readStoredLastChange } from './stored.js'
import { ORDER_CHILD_TABLES, ORDER_TABLES, type tOrderChildTable } from './tables.js'
import { type iDetailRows, toDetailRows, toOrderRow } from './transform-orders.js'
import { toComparableUtc } from './values.js'

/**
 * vtex-orders — pedidos da loja da marca, a cada 30 minutos.
 *
 * 1. Lista os pedidos criados na janela (padrão: últimos 45 dias; carga retroativa com --from 2026-10-05), dividindo a
 *    janela quando passa de 3.000 pedidos.
 * 2. Compara o lastChange de cada um com o gravado em vtex_order_details e busca o detalhe só do que mudou.
 * 3. Grava tudo numa transação: vtex_orders (todos os listados, replaceByKeys), vtex_order_details (upsert), as filhas
 *    (replaceByKeys por order_id dos detalhes obtidos) e vtex_client_profile (upsert). vtex_order_items tem PK uniqueid:
 *    apaga os itens dos pedidos regravados e faz upsert por uniqueid, porque o mesmo uniqueId pode reaparecer em outro
 *    pedido (ex.: pedido incompleto refeito do mesmo carrinho) e um INSERT puro derrubaria a carga; fica com o item o
 *    pedido alterado por último.
 *
 * Detalhe que falha (rede, 5xx, campo fora do tipo) fica de fora desta carga e é buscado de novo na próxima, porque o
 * last_change dele não foi gravado. Se TODOS os detalhes falharem, a carga falha (credencial ou API fora do ar).
 *
 * Dry-run: não lê o banco, então busca o detalhe de todos os pedidos da janela — use uma janela curta.
 * Fixture: grava a lista e os detalhes do arquivo, sem comparar lastChange (não há API).
 */

const DEFAULT_WINDOW_DAYS = 45
const MS_PER_DAY = 86_400_000
const SCHEDULE_EVERY_30_MIN = '*/30 * * * *'
/** Quantos IDs de pedido com falha aparecem no resumo (o log tem todos). */
const MAX_FAILED_IDS_IN_NOTES = 10

interface iFetchedOrders {
	listed: tListOrder[]
	details: tOrderDetail[]
	hostnameFallback: string | null
	notes: string[]
}

const requireBrand = (brand: tBrand | undefined): tBrand => {
	if (!brand) throw new AppError('vtex-orders roda por marca: informe --brand.')

	return brand
}

const databaseOf = (brand?: tBrand): tDatabase => getBrandConfig(requireBrand(brand)).database

const errorMessage = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

const failedIdsNote = (label: string, ids: string[]): string => {
	const shown = ids.slice(0, MAX_FAILED_IDS_IN_NOTES).join(', ')
	const more = ids.length > MAX_FAILED_IDS_IN_NOTES ? ` e mais ${ids.length - MAX_FAILED_IDS_IN_NOTES}` : ''

	return `${ids.length} ${label} (de novo na próxima carga): ${shown}${more}`
}

/** Pedido mudou se a lista não traz lastChange, se não há detalhe gravado ou se o lastChange é diferente. */
const hasChanged = (order: tListOrder, stored: ReadonlyMap<string, string>): boolean => {
	const listed = toComparableUtc(order.lastChange)

	return listed === null || stored.get(order.orderId) !== listed
}

const fetchFromApi = async (ctx: iJobContext, brand: tBrand): Promise<iFetchedOrders> => {
	const api = createBrandApi(brand)
	const to = ctx.options.to ?? new Date()
	const from = ctx.options.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY)
	const { orders: listed, stats } = await listOrdersInWindow(api, { from, to })

	// Dry-run não abre conexão: sem o gravado, tudo conta como mudado.
	const stored = ctx.options.dryRun
		? new Map<string, string>()
		: await readStoredLastChange(
				ctx.database,
				listed.map(order => order.orderId)
			)
	const changed = listed.filter(order => hasChanged(order, stored))

	ctx.logger.info(
		{ listed: listed.length, changed: changed.length, windows: stats.windows, pages: stats.pages },
		'Pedidos listados'
	)

	const settled = await runWithConcurrency(
		changed.map(order => () => api.getOrder(order.orderId)),
		getEnv().HTTP_CONCURRENCY
	)
	const details: tOrderDetail[] = []
	const failedIds: string[] = []

	settled.forEach((result, index) => {
		const orderId = changed[index]?.orderId ?? '?'

		if (result.status === 'fulfilled') {
			details.push(result.value)

			return
		}

		failedIds.push(orderId)
		ctx.logger.warn({ orderId, reason: errorMessage(result.reason) }, 'Detalhe do pedido falhou')
	})

	if (changed.length > 0 && details.length === 0) {
		const first = settled.find(result => result.status === 'rejected')

		throw new AppError(
			`Nenhum detalhe de pedido obtido (${failedIds.length} falhas). Primeiro erro: ${errorMessage(first?.status === 'rejected' ? first.reason : undefined)}`
		)
	}

	const notes = [
		`${listed.length} pedido(s) criados entre ${from.toISOString()} e ${to.toISOString()} ` +
			`(${stats.windows} consulta(s), ${stats.pages} página(s)); ${changed.length} mudaram`
	]

	if (ctx.options.dryRun) notes.push('dry-run: sem leitura do banco, todos os pedidos contam como mudados')

	if (failedIds.length > 0) notes.push(failedIdsNote('detalhe(s) com falha na API', failedIds))

	return { listed, details, hostnameFallback: accountOf(brand) ?? null, notes }
}

const fetchFromFixture = async (file: string): Promise<iFetchedOrders> => {
	const fixture = await loadOrdersFixture(file)

	return {
		listed: fixture.list.list,
		details: fixture.orders,
		hostnameFallback: fixture.account,
		notes: [`fixture ${file}: ${fixture.list.list.length} pedido(s) na lista, ${fixture.orders.length} detalhe(s)`]
	}
}

/**
 * Um perfil por cliente. Recebe os perfis na ordem dos pedidos (do alterado há mais tempo ao mais recente): entre
 * pedidos do mesmo cliente, vale o do pedido alterado por último.
 */
const latestProfiles = (profiles: (tRow | null)[]): tRow[] => {
	const byId = new Map<string, tRow>()

	for (const profile of profiles) {
		if (profile) byId.set(String(profile.id), profile)
	}

	return [...byId.values()]
}

const run = async (ctx: iJobContext): Promise<iRunSummary> => {
	const brand = requireBrand(ctx.brand)
	const fetched = ctx.options.fixture ? await fetchFromFixture(ctx.options.fixture) : await fetchFromApi(ctx, brand)
	// Transformação por pedido: um campo fora do tipo da coluna tira só aquele pedido desta carga (a linha antiga fica).
	const orderRows: tRow[] = []
	const orderIds: string[] = []
	const transformed: { detail: tOrderDetail; rows: iDetailRows }[] = []
	const invalidIds: string[] = []

	for (const order of fetched.listed) {
		try {
			orderRows.push(toOrderRow(order, fetched.hostnameFallback))
			orderIds.push(order.orderId)
		} catch (err) {
			invalidIds.push(order.orderId)
			ctx.logger.warn({ orderId: order.orderId, reason: errorMessage(err) }, 'Pedido da lista fora do formato')
		}
	}

	for (const detail of fetched.details) {
		try {
			transformed.push({ detail, rows: toDetailRows(detail) })
		} catch (err) {
			invalidIds.push(detail.orderId)
			ctx.logger.warn(
				{ orderId: detail.orderId, reason: errorMessage(err) },
				'Pedido fora do formato das colunas'
			)
		}
	}

	// Do pedido alterado há mais tempo para o mais recente: no upsert (itens, perfis), a última linha vence.
	transformed.sort((left, right) =>
		(toComparableUtc(left.detail.lastChange) ?? '').localeCompare(toComparableUtc(right.detail.lastChange) ?? '')
	)

	const detailIds = transformed.map(({ detail }) => detail.orderId)
	const profiles = latestProfiles(transformed.map(({ rows }) => rows.clientProfile))
	const rowsOf = (table: tOrderChildTable) => transformed.flatMap(({ rows }) => rows.children[table])

	const { results } = await ctx.writer.transaction(async tx => {
		await tx.replaceByKeys(ORDER_TABLES.orders, 'order_id', orderIds, orderRows)
		await tx.upsert(
			ORDER_TABLES.details,
			transformed.map(({ rows }) => rows.details),
			{ keyColumns: ['order_id'] }
		)

		for (const table of ORDER_CHILD_TABLES) {
			if (table === ORDER_TABLES.items) continue

			await tx.replaceByKeys(table, 'order_id', detailIds, rowsOf(table))
		}

		await tx.replaceByKeys(ORDER_TABLES.items, 'order_id', detailIds, [])
		await tx.upsert(ORDER_TABLES.items, rowsOf(ORDER_TABLES.items), { keyColumns: ['uniqueid'] })
		await tx.upsert(ORDER_TABLES.clientProfile, profiles, { keyColumns: ['id'] })
	})

	const notes = [
		...fetched.notes,
		`${detailIds.length} detalhe(s) gravado(s), ${profiles.length} perfil(is) de cliente`
	]

	if (invalidIds.length > 0)
		notes.push(failedIdsNote('pedido(s) fora do formato das colunas', [...new Set(invalidIds)]))

	return { results, notes }
}

const ordersJob: iJob = {
	name: 'vtex-orders',
	source: 'vtex',
	scope: 'brand',
	description: 'Pedidos VTEX (lista + detalhe do que mudou), perfis de cliente dos pedidos',
	tables: [ORDER_TABLES.orders, ORDER_TABLES.details, ...ORDER_CHILD_TABLES, ORDER_TABLES.clientProfile],
	database: databaseOf,
	schedule: SCHEDULE_EVERY_30_MIN,
	run
}

export { DEFAULT_WINDOW_DAYS, hasChanged, ordersJob }
