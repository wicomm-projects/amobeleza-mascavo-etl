import { getBrandConfig, getEnv, type tBrand, type tDatabase } from '../../config/index.js'
import { runWithConcurrency } from '../../core/concurrency.js'
import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iJob, iJobContext, iRunSummary } from '../../core/jobs/types.js'

import { accountOf, createBrandApi } from './client.js'
import { isTransportFailure, withoutSqlPayload } from './errors.js'
import { loadOrdersFixture } from './fixtures.js'
import { listOrdersInWindow } from './orders-window.js'
import { maskPersonalData } from './personal-data.js'
import type { tListOrder, tOrderDetail } from './schemas.js'
import { readStoredItemOwners, readStoredLastChange, readStoredSellerNames } from './stored.js'
import { ORDER_CHILD_TABLES, ORDER_TABLES, hasSellerName, type tOrderChildTable } from './tables.js'
import { type iDetailContext, type iDetailRows, sellerNameOf, toDetailRows, toOrderRow } from './transform-orders.js'
import { saoPauloWallClock, toComparableUtc } from './values.js'

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
 *    pedido alterado por último, e a troca aparece nas notas.
 *
 * Isolamento por pedido: detalhe que falha (rede, 5xx, resposta fora do schema) ou que não cabe nas colunas (NOT NULL
 * vazio, inteiro inválido) fica de fora desta carga, com o ID nas notas, e é buscado de novo na próxima (o last_change
 * dele não foi gravado). A carga só falha inteira se todos os detalhes falharem por transporte (credencial, permissão ou
 * API fora do ar).
 *
 * Dado pessoal (nome, documento, e-mail, telefone) é gravado mascarado enquanto o destino é o local: personal-data.ts.
 *
 * Dry-run: não lê o banco, então busca o detalhe de todos os pedidos da janela — use uma janela curta.
 * Fixture: grava a lista e os detalhes do arquivo, sem comparar lastChange (não há API).
 */

const DEFAULT_WINDOW_DAYS = 45
const MS_PER_DAY = 86_400_000
const SCHEDULE_EVERY_30_MIN = '*/30 * * * *'
/** Quantos IDs aparecem no resumo (o log tem todos). */
const MAX_IDS_IN_NOTES = 10

interface iFetchedOrders {
	listed: tListOrder[]
	details: tOrderDetail[]
	hostnameFallback: string | null
	/** seller_name já gravado em vtex_orders (só amobeleza_etl): vale para os pedidos que não mudaram. */
	storedSellerNames: Map<string, string | null>
	notes: string[]
}

const requireBrand = (brand: tBrand | undefined): tBrand => {
	if (!brand) throw new AppError('vtex-orders roda por marca: informe --brand.')

	return brand
}

const databaseOf = (brand?: tBrand): tDatabase => getBrandConfig(requireBrand(brand)).database

const errorMessage = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

const listNote = (label: string, ids: string[]): string => {
	const shown = ids.slice(0, MAX_IDS_IN_NOTES).join(', ')
	const more = ids.length > MAX_IDS_IN_NOTES ? ` e mais ${ids.length - MAX_IDS_IN_NOTES}` : ''

	return `${ids.length} ${label}: ${shown}${more}`
}

/**
 * Pedido mudou se a lista não traz lastChange (ou traz num formato ilegível), se não há detalhe gravado ou se o
 * lastChange é diferente do gravado.
 */
const hasChanged = (order: tListOrder, stored: ReadonlyMap<string, string>): boolean => {
	try {
		const listed = toComparableUtc(order.lastChange)

		return listed === null || stored.get(order.orderId) !== listed
	} catch {
		return true
	}
}

const fetchFromApi = async (ctx: iJobContext, brand: tBrand): Promise<iFetchedOrders> => {
	const api = createBrandApi(brand)
	const to = ctx.options.to ?? new Date()
	const from = ctx.options.from ?? new Date(to.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY)
	const { orders: listed, stats } = await listOrdersInWindow(api, { from, to })
	const listedIds = listed.map(order => order.orderId)
	// Dry-run não abre conexão: sem o gravado, tudo conta como mudado.
	const readDatabase = !ctx.options.dryRun
	const stored = readDatabase ? await readStoredLastChange(ctx.database, listedIds) : new Map<string, string>()
	const storedSellerNames =
		readDatabase && hasSellerName(ctx.database)
			? await readStoredSellerNames(ctx.database, listedIds)
			: new Map<string, string | null>()
	const changed = listed.filter(order => hasChanged(order, stored))
	const withoutLastChange = listed.filter(order => !order.lastChange).length

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
	const transportFailures: unknown[] = []

	settled.forEach((result, index) => {
		const orderId = changed[index]?.orderId ?? '?'

		if (result.status === 'fulfilled') {
			details.push(result.value)

			return
		}

		failedIds.push(orderId)

		if (isTransportFailure(result.reason)) transportFailures.push(result.reason)

		ctx.logger.warn({ orderId, reason: errorMessage(result.reason) }, 'Detalhe do pedido falhou')
	})

	// Todos falharam por HTTP/rede: credencial, permissão ou API fora do ar. Pedido ruim sozinho não derruba a carga.
	if (changed.length > 0 && details.length === 0 && transportFailures.length > 0) {
		throw new AppError(
			`Nenhum detalhe de pedido obtido (${failedIds.length} falhas). Primeiro erro: ${errorMessage(transportFailures[0])}`
		)
	}

	const notes = [
		`${listed.length} pedido(s) criados entre ${from.toISOString()} e ${to.toISOString()} ` +
			`(${stats.windows} consulta(s), ${stats.pages} página(s)); ${changed.length} mudaram`
	]

	if (ctx.options.dryRun) notes.push('dry-run: sem leitura do banco, todos os pedidos contam como mudados')

	// Sem lastChange na lista, todo pedido da janela é "mudado" e o detalhe de todos é buscado a cada carga.
	if (withoutLastChange * 2 > listed.length) {
		ctx.logger.warn(
			{ withoutLastChange, listed: listed.length },
			'Lista do OMS sem lastChange na maioria dos pedidos'
		)
		notes.push(
			`${withoutLastChange} de ${listed.length} pedido(s) sem lastChange na lista: detalhe de todos buscado`
		)
	}

	if (failedIds.length > 0) notes.push(listNote('detalhe(s) com falha (de novo na próxima carga)', failedIds))

	return { listed, details, hostnameFallback: accountOf(brand) ?? null, storedSellerNames, notes }
}

const fetchFromFixture = async (file: string): Promise<iFetchedOrders> => {
	const fixture = await loadOrdersFixture(file)

	return {
		listed: fixture.list.list,
		details: fixture.orders,
		hostnameFallback: fixture.account,
		storedSellerNames: new Map(),
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

/**
 * Itens cujo uniqueid já está gravado em OUTRO pedido, fora desta carga: o upsert vai mudá-los de pedido. Só conta e
 * lista "uniqueid: pedido antigo → novo" para as notas (paridade); a regra de quem fica com o item está no topo.
 */
const movedItems = async (ctx: iJobContext, itemRows: tRow[], detailIds: ReadonlySet<string>): Promise<string[]> => {
	if (ctx.options.dryRun || itemRows.length === 0) return []

	const owners = await readStoredItemOwners(
		ctx.database,
		itemRows.map(row => String(row.uniqueid))
	)

	return itemRows.flatMap(row => {
		const owner = owners.get(String(row.uniqueid))

		if (!owner || detailIds.has(owner) || owner === row.order_id) return []

		return [`${String(row.uniqueid)}: ${owner} → ${String(row.order_id)}`]
	})
}

const run = async (ctx: iJobContext): Promise<iRunSummary> => {
	const brand = requireBrand(ctx.brand)
	const fetched = ctx.options.fixture ? await fetchFromFixture(ctx.options.fixture) : await fetchFromApi(ctx, brand)
	// Transformação por pedido: um campo fora do tipo da coluna tira só aquele pedido desta carga (a linha antiga fica).
	const orderRows: tRow[] = []
	const orderIds: string[] = []
	const transformed: { detail: tOrderDetail; rows: iDetailRows }[] = []
	const invalidIds: string[] = []
	const withSellerName = hasSellerName(ctx.database)
	// seller_name: o do detalhe, quando veio nesta carga; senão, o já gravado.
	const sellerNames = new Map(fetched.storedSellerNames)
	// Substitutos do ETL antigo para datas que a VTEX não manda: o "agora" da carga no relógio de SP (transform-orders.ts).
	const detailContext: iDetailContext = {
		account: fetched.hostnameFallback ?? brand,
		processedAtLocal: saoPauloWallClock(new Date())
	}

	for (const detail of fetched.details) {
		try {
			transformed.push({ detail, rows: toDetailRows(detail, detailContext) })
			sellerNames.set(detail.orderId, sellerNameOf(detail))
		} catch (err) {
			invalidIds.push(detail.orderId)
			ctx.logger.warn(
				{ orderId: detail.orderId, reason: errorMessage(err) },
				'Pedido fora do formato das colunas'
			)
		}
	}

	for (const order of fetched.listed) {
		try {
			const row = toOrderRow(order, fetched.hostnameFallback)

			orderRows.push(withSellerName ? { ...row, seller_name: sellerNames.get(order.orderId) ?? null } : row)
			orderIds.push(order.orderId)
		} catch (err) {
			invalidIds.push(order.orderId)
			ctx.logger.warn({ orderId: order.orderId, reason: errorMessage(err) }, 'Pedido da lista fora do formato')
		}
	}

	// Do pedido alterado há mais tempo para o mais recente: no upsert (itens, perfis), a última linha vence.
	transformed.sort((left, right) =>
		(toComparableUtc(left.detail.lastChange) ?? '').localeCompare(toComparableUtc(right.detail.lastChange) ?? '')
	)

	const detailIds = transformed.map(({ detail }) => detail.orderId)
	const profiles = latestProfiles(transformed.map(({ rows }) => rows.clientProfile))
	const rowsOf = (table: tOrderChildTable) => transformed.flatMap(({ rows }) => rows.children[table])
	const itemRows = rowsOf(ORDER_TABLES.items)
	const moved = await movedItems(ctx, itemRows, new Set(detailIds))

	// O mysql2 põe o SQL com os valores (dado pessoal) no erro; o runner loga o erro inteiro. Sai só a mensagem.
	const { results } = await ctx.writer
		.transaction(async tx => {
			await tx.replaceByKeys(ORDER_TABLES.orders, 'order_id', orderIds, orderRows)
			await tx.upsert(
				ORDER_TABLES.details,
				maskPersonalData(
					ORDER_TABLES.details,
					transformed.map(({ rows }) => rows.details)
				),
				{ keyColumns: ['order_id'] }
			)

			for (const table of ORDER_CHILD_TABLES) {
				if (table === ORDER_TABLES.items) continue

				await tx.replaceByKeys(table, 'order_id', detailIds, rowsOf(table))
			}

			await tx.replaceByKeys(ORDER_TABLES.items, 'order_id', detailIds, [])
			await tx.upsert(ORDER_TABLES.items, itemRows, { keyColumns: ['uniqueid'] })
			await tx.upsert(ORDER_TABLES.clientProfile, maskPersonalData(ORDER_TABLES.clientProfile, profiles), {
				keyColumns: ['id']
			})
		})
		.catch(err => {
			throw withoutSqlPayload(err)
		})

	const notes = [
		...fetched.notes,
		`${detailIds.length} detalhe(s) gravado(s), ${profiles.length} perfil(is) de cliente`
	]

	if (invalidIds.length > 0) {
		notes.push(
			listNote('pedido(s) fora do formato das colunas (de novo na próxima carga)', [...new Set(invalidIds)])
		)
	}

	if (moved.length > 0) notes.push(listNote('item(ns) que mudaram de pedido (uniqueId repetido)', moved))

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
