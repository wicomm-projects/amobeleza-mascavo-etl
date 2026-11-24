import { getEnv, type tBrand } from '../../config/index.js'
import { runWithConcurrency } from '../../core/concurrency.js'
import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iParityContext, iParitySummary } from '../../core/jobs/types.js'
import { DEFAULT_IGNORED, compareRows, type iCompareResult, writeParityReport } from '../../core/parity/compare.js'

import { accountOf, createBrandApi, type iVtexApi } from './client.js'
import { listOrdersInWindow } from './orders-window.js'
import { extraNotes, pickSample, qualified, redactPersonal, summarize } from './parity-shared.js'
import type { tListOrder, tOrderDetail } from './schemas.js'
import { ORDER_CHILD_TABLES, ORDER_TABLES, hasSellerName } from './tables.js'
import { type iDetailRows, sellerNameOf, toDetailRows, toOrderRow } from './transform-orders.js'
import { saoPauloWallClock, toComparableUtc, toUtcDate } from './values.js'

/**
 * Paridade de vtex-orders: monta em memória, com as MESMAS funções da carga (orders-job.ts), as linhas de uma amostra de
 * pedidos de uma janela antiga e compara com o que o ETL antigo gravou na produção (só SELECT por chave, com LIMIT).
 * Nada é gravado em banco nenhum.
 *
 * Só entram na comparação estrita os pedidos "estáveis": o last_change do detalhe na VTEX é igual ao gravado pelo ETL
 * antigo. Pedido que mudou depois disso só é contado (o ETL antigo parou antes da mudança).
 */

const DEFAULT_LAG_DAYS = 30
const DEFAULT_WINDOW_DAYS = 7
const MS_PER_DAY = 86_400_000
/** Teto de linhas filhas por pedido nas consultas à produção (itens, parcelas, promoções). */
const MAX_ROWS_PER_ORDER = 50

interface iOrderParityDeps {
	api?: Pick<iVtexApi, 'listOrders' | 'getOrder'>
	writeReport?: typeof writeParityReport
	now?: Date
}

interface iTableSpec {
	table: string
	keyColumns: string[]
	/** Padrão: id técnico e carimbos. Onde `id` é dado de negócio (SKU, promoção, perfil), só os carimbos. */
	ignoreColumns?: string[]
}

const STAMPS = ['created_at', 'updated_at']

const TABLE_SPECS: iTableSpec[] = [
	{ table: ORDER_TABLES.orders, keyColumns: ['order_id'] },
	{ table: ORDER_TABLES.details, keyColumns: ['order_id'] },
	{ table: ORDER_TABLES.items, keyColumns: ['uniqueid'], ignoreColumns: STAMPS },
	{ table: ORDER_TABLES.logisticsInfo, keyColumns: ['order_id', 'item_index'] },
	{
		table: ORDER_TABLES.deliveryIds,
		keyColumns: ['order_id', 'item_index', 'courier_id', 'warehouse_id', 'dock_id']
	},
	{ table: ORDER_TABLES.shippingData, keyColumns: ['order_id', 'address_id'] },
	{ table: ORDER_TABLES.transactions, keyColumns: ['order_id', 'transaction_id'] },
	{ table: ORDER_TABLES.payments, keyColumns: ['order_id', 'payment_id'] },
	{ table: ORDER_TABLES.giftCards, keyColumns: ['order_id', 'gift_card_id'] },
	{ table: ORDER_TABLES.rates, keyColumns: ['order_id', 'id'], ignoreColumns: STAMPS },
	{ table: ORDER_TABLES.clientProfile, keyColumns: ['id'], ignoreColumns: STAMPS }
]

interface iWindow {
	from: Date
	to: Date
}

const errorMessage = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason))

const endOfDayUtc = (date: Date): Date =>
	new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))

/** last_change em texto UTC comparável; valor ilegível vira null (o pedido conta como mudado). */
const safeComparable = (value: Date | string | null | undefined): string | null => {
	try {
		return toComparableUtc(value)
	} catch {
		return null
	}
}

/**
 * Janela da amostra. Com --from e --to, usa. Só um deles: o outro fica 7 dias de distância. Sem nenhum: acha o último
 * pedido gravado pelo ETL antigo (um MAX, com LIMIT 1) e recua 30 dias — pedido com mais de 30 dias antes da parada
 * do ETL antigo já estava no estado final quando ele gravou.
 */
const resolveWindow = async (ctx: iParityContext): Promise<iWindow> => {
	const { from, to } = ctx.options

	if (from && to) return { from, to }

	if (to) return { from: new Date(to.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY), to }

	if (from) return { from, to: new Date(from.getTime() + DEFAULT_WINDOW_DAYS * MS_PER_DAY) }

	const [row] = await ctx.refReader.query<{ ultima: Date | string | null }>(
		`SELECT MAX(creation_date) AS ultima FROM ${qualified(ctx.database, ORDER_TABLES.details)} LIMIT 1`
	)
	const lastText = safeComparable(row?.ultima)

	if (!lastText) throw new AppError('Paridade: a produção não tem pedido em vtex_order_details para achar a janela.')

	const last = new Date(`${lastText.replace(' ', 'T')}Z`)
	const end = endOfDayUtc(new Date(last.getTime() - DEFAULT_LAG_DAYS * MS_PER_DAY))

	return { from: new Date(end.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY), to: end }
}

const readByColumn = async (
	ctx: iParityContext,
	table: string,
	column: 'order_id' | 'id',
	ids: readonly string[],
	limitPerId: number
): Promise<tRow[]> => {
	if (ids.length === 0) return []

	return ctx.refReader.query<tRow>(`SELECT * FROM ${qualified(ctx.database, table)} WHERE ${column} IN (?) LIMIT ?`, [
		[...ids],
		ids.length * limitPerId
	])
}

const onlyOrders = (rows: tRow[], ids: ReadonlySet<string>): tRow[] => rows.filter(row => ids.has(String(row.order_id)))

const orderParity = async (ctx: iParityContext, deps: iOrderParityDeps = {}): Promise<iParitySummary> => {
	const brand: tBrand | undefined = ctx.brand

	if (!brand) throw new AppError('Paridade de vtex-orders roda por marca: informe --brand.')

	const api = deps.api ?? createBrandApi(brand)
	const writeReport = deps.writeReport ?? writeParityReport
	const now = deps.now ?? new Date()
	const account = accountOf(brand)
	const window = await resolveWindow(ctx)

	// 1-3. Lista da VTEX na janela e amostra determinística.
	const { orders: listedOrders } = await listOrdersInWindow(api, window)
	const listed = [...listedOrders].sort((left, right) => left.orderId.localeCompare(right.orderId))
	const sample = pickSample(listed, ctx.options.sample)
	const sampleIds = sample.map(order => order.orderId)

	// 4. Produção, só dos IDs da amostra.
	const productionByTable = new Map<string, tRow[]>()

	for (const table of [ORDER_TABLES.orders, ORDER_TABLES.details, ...ORDER_CHILD_TABLES]) {
		productionByTable.set(table, await readByColumn(ctx, table, 'order_id', sampleIds, MAX_ROWS_PER_ORDER))
	}

	const productionDetails = new Map(
		(productionByTable.get(ORDER_TABLES.details) ?? []).map(row => [String(row.order_id), row])
	)

	// 5. Detalhe na VTEX; falha tira só o pedido.
	const settled = await runWithConcurrency(
		sampleIds.map(orderId => () => api.getOrder(orderId)),
		getEnv().HTTP_CONCURRENCY
	)
	const details = new Map<string, tOrderDetail>()
	const failedDetails: string[] = []
	const notes: string[] = []

	settled.forEach((result, index) => {
		const orderId = sampleIds[index] ?? '?'

		if (result.status === 'fulfilled') {
			details.set(orderId, result.value)

			return
		}

		failedDetails.push(orderId)
		ctx.logger.warn({ orderId, reason: errorMessage(result.reason) }, 'Detalhe do pedido falhou na paridade')
	})

	// 6. Classificação por last_change.
	const stable: string[] = []
	const changedAfter: string[] = []
	const withoutProductionDetail: string[] = []

	for (const orderId of sampleIds) {
		const detail = details.get(orderId)

		if (!detail) continue

		const production = productionDetails.get(orderId)

		if (!production) {
			withoutProductionDetail.push(orderId)

			continue
		}

		const stored = safeComparable(production.last_change as Date | string | null)
		const current = safeComparable(detail.lastChange)

		if (stored !== null && stored === current) stable.push(orderId)
		else changedAfter.push(orderId)
	}

	// 7. Transformação (só estáveis), como orders-job.ts.
	const listedById = new Map<string, tListOrder>(sample.map(order => [order.orderId, order]))
	const processedAtLocal = saoPauloWallClock(now)
	const withSellerName = hasSellerName(ctx.database)
	const transformedIds: string[] = []
	const invalid: string[] = []
	const orderRows: tRow[] = []
	const transformed = new Map<string, iDetailRows>()
	let neutralizedDates = 0

	for (const orderId of stable) {
		const detail = details.get(orderId)
		const listedOrder = listedById.get(orderId)
		const production = productionDetails.get(orderId)

		if (!detail || !listedOrder || !production) continue

		try {
			const row = toOrderRow(listedOrder, account ?? null)
			const rows = toDetailRows(detail, { account: account ?? brand, processedAtLocal })

			// Datas que a VTEX não manda viram o horário da carga: nunca bateriam. Usa o valor da produção.
			if (toUtcDate(detail.authorizedDate) === null) {
				rows.details.authorizeddate = production.authorizeddate
				neutralizedDates += 1
			}

			if (toUtcDate(detail.invoicedDate) === null) {
				rows.details.invoiceddate = production.invoiceddate
				neutralizedDates += 1
			}

			orderRows.push(withSellerName ? { ...row, seller_name: sellerNameOf(detail) } : row)
			transformed.set(orderId, rows)
			transformedIds.push(orderId)
		} catch (err) {
			invalid.push(orderId)
			ctx.logger.warn({ orderId, reason: errorMessage(err) }, 'Pedido fora do formato na paridade')
		}
	}

	const comparedIds = new Set(transformedIds)

	// vtex_client_profile: só os perfis dos pedidos comparados.
	const profileIds = new Set<string>()
	const newProfiles = new Map<string, tRow>()

	for (const orderId of transformedIds) {
		const production = productionDetails.get(orderId)
		const profile = transformed.get(orderId)?.clientProfile

		if (production?.client_profile_id) profileIds.add(String(production.client_profile_id))

		if (profile) {
			profileIds.add(String(profile.id))
			newProfiles.set(String(profile.id), profile)
		}
	}

	const productionProfiles = await readByColumn(ctx, ORDER_TABLES.clientProfile, 'id', [...profileIds], 1)

	// 8. Comparação por tabela.
	const newRowsOf = (table: string): tRow[] => {
		if (table === ORDER_TABLES.orders) return orderRows

		if (table === ORDER_TABLES.clientProfile) return [...newProfiles.values()]

		return transformedIds.flatMap(orderId => {
			const rows = transformed.get(orderId)

			if (!rows) return []

			return table === ORDER_TABLES.details
				? [rows.details]
				: (rows.children[table as keyof iDetailRows['children']] ?? [])
		})
	}

	const results: iCompareResult[] = TABLE_SPECS.map(spec => {
		const expected =
			spec.table === ORDER_TABLES.clientProfile
				? productionProfiles.filter(row => profileIds.has(String(row.id)))
				: onlyOrders(productionByTable.get(spec.table) ?? [], comparedIds)

		return redactPersonal(
			spec.table,
			compareRows({
				table: spec.table,
				keyColumns: spec.keyColumns,
				expected,
				actual: newRowsOf(spec.table),
				ignoreColumns: spec.ignoreColumns ?? DEFAULT_IGNORED
			})
		)
	})

	// 9-10. Relatório e notas.
	const meta = {
		brand,
		database: ctx.database,
		window: { from: window.from.toISOString(), to: window.to.toISOString() },
		sample: sampleIds.length,
		listed: listed.length,
		stable: comparedIds.size,
		changedAfter: changedAfter,
		withoutProductionDetail: withoutProductionDetail,
		failedDetails: failedDetails,
		invalid: invalid,
		neutralizedDates
	}
	const reportPath = await writeReport(`vtex-orders-${brand}`, results, meta)

	notes.push(
		`Janela: ${window.from.toISOString()} a ${window.to.toISOString()}; ${listed.length} pedido(s) listado(s), amostra de ${sampleIds.length}`,
		`${comparedIds.size} estável(is) comparado(s), ${changedAfter.length} mudou(aram) depois do ETL antigo, ` +
			`${withoutProductionDetail.length} sem detalhe na produção, ${failedDetails.length} falha(s) de detalhe, ` +
			`${invalid.length} fora do formato`,
		`${neutralizedDates} data(s) de autorização/faturamento neutralizada(s) (a VTEX não mandou)`,
		...extraNotes(results)
	)

	return { reportPath, tables: summarize(results), notes }
}

export { MAX_ROWS_PER_ORDER, orderParity }
