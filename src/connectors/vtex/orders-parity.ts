import { getEnv, type tBrand } from '../../config/index.js'
import { runWithConcurrency } from '../../core/concurrency.js'
import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iParityContext, iParitySummary } from '../../core/jobs/types.js'
import { DEFAULT_IGNORED, compareRows, type iCompareResult, writeParityReport } from '../../core/parity/compare.js'

import { accountOf, createBrandApi, type iVtexApi } from './client.js'
import { listOrdersInWindow } from './orders-window.js'
import {
	acceptedNotes,
	extraNotes,
	pickSample,
	qualified,
	redactPersonal,
	summarize,
	type tAcceptedDifferences
} from './parity-shared.js'
import type { tListOrder, tOrderDetail } from './schemas.js'
import { ORDER_CHILD_TABLES, ORDER_TABLES, hasSellerName } from './tables.js'
import { type iDetailRows, sellerNameOf, toDetailRows, toOrderRow } from './transform-orders.js'
import { saoPauloWallClock, toComparableUtc, toUtcDate } from './values.js'

/**
 * Paridade de vtex-orders: monta em memória, com as MESMAS funções da carga (orders-job.ts), as linhas de uma amostra de
 * pedidos de uma janela antiga e compara com o que o ETL antigo gravou na produção (só SELECT por chave, com LIMIT).
 * Nada é gravado em banco nenhum.
 *
 * Dois grupos, cada um com o seu resultado por tabela:
 * - estáveis: o last_change do detalhe na VTEX é igual ao gravado pelo ETL antigo → comparação estrita;
 * - mudou depois: a VTEX mudou o pedido depois que o ETL antigo gravou. Na Mascavo é a regra: o ETL antigo gravava o
 *   pedido uma vez e não atualizava mais (medido em 24/11/2026: 0 de 200 pedidos de agosto com o status de hoje). Esses
 *   pedidos entram com as colunas que mudam com o andamento (VOLATILE_COLUMNS) fora da comparação, e o nome da tabela
 *   no relatório leva o sufixo " (mudou depois)".
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

/** Colunas que mudam com o andamento do pedido (status, datas, travas): fora da comparação do grupo "mudou depois". */
const VOLATILE_COLUMNS: Readonly<Partial<Record<string, readonly string[]>>> = {
	[ORDER_TABLES.orders]: [
		'status',
		'status_description',
		'last_change',
		'order_is_complete',
		'workflow_in_error_state',
		'workflow_in_retry',
		'authorized_date',
		'is_all_delivered',
		'is_any_delivered',
		'ready_for_handling_date',
		'shipping_estimated_date',
		'shipping_estimated_date_max',
		'shipping_estimated_date_min'
	],
	[ORDER_TABLES.details]: [
		'status',
		'status_description',
		'last_change',
		'authorizeddate',
		'invoiceddate',
		'iscompleted',
		'allowcancellation',
		'allowedition',
		'ischeckedin'
	],
	[ORDER_TABLES.transactions]: ['is_active']
}

const CHANGED_SUFFIX = ' (mudou depois)'

/**
 * Diferenças conhecidas com o ETL antigo, *assumidas, a confirmar* (medidas na paridade de 24/11/2026). Nenhum
 * relatório conhecido lê essas colunas, e o ETL antigo de cada marca gravava de um jeito: o ETL novo grava o que a VTEX
 * manda. Continuam no relatório completo, mas não contam como divergência. Rever quando o Power BI da Amobeleza for
 * conferido (AMO-Q24).
 */
const ACCEPTED_DIFFERENCES: tAcceptedDifferences = {
	[ORDER_TABLES.orders]: {
		total_items: 'o ETL antigo da Mascavo gravava 0 em todo pedido; o novo grava a quantidade da VTEX',
		market_place_order_id:
			'vazio sem marketplace: a Mascavo antiga gravava "", a Amobeleza nulo; o novo grava nulo',
		shipping_estimated_date: 'o ETL antigo não preenchia; o novo grava a data da VTEX',
		shipping_estimated_date_max: 'o ETL antigo não preenchia; o novo grava a data da VTEX',
		shipping_estimated_date_min: 'o ETL antigo não preenchia; o novo grava a data da VTEX'
	},
	[ORDER_TABLES.details]: {
		opentextfield: 'vazio: a Amobeleza antiga gravava "", a Mascavo nulo; o novo grava nulo'
	},
	[ORDER_TABLES.items]: {
		shippingprice: 'a VTEX não manda o frete por item; a Amobeleza antiga calculava a partir da logística',
		taxcode: 'sem código fiscal: a Amobeleza antiga gravou "0" em alguns itens; o novo grava ""'
	},
	[ORDER_TABLES.transactions]: {
		is_active: 'o ETL antigo não preenchia; o novo grava o 1/0 da VTEX'
	},
	[ORDER_TABLES.clientProfile]: {
		email: 'o ETL antigo deixou vazio em cerca de metade dos perfis; o novo grava o e-mail-alias que a VTEX manda',
		first_name: 'o cliente pode atualizar o cadastro na VTEX depois da gravação antiga',
		last_name: 'o cliente pode atualizar o cadastro na VTEX depois da gravação antiga',
		home_phone: 'o cliente pode atualizar o cadastro na VTEX depois da gravação antiga'
	}
}

interface iGroup {
	ids: ReadonlySet<string>
	suffix: string
	volatile: boolean
}

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

	// 7. Transformação (estáveis e mudou depois), como orders-job.ts.
	const listedById = new Map<string, tListOrder>(sample.map(order => [order.orderId, order]))
	const processedAtLocal = saoPauloWallClock(now)
	const withSellerName = hasSellerName(ctx.database)
	const transformedIds: string[] = []
	const invalid: string[] = []
	const orderRows: tRow[] = []
	const transformed = new Map<string, iDetailRows>()
	let neutralizedDates = 0

	for (const orderId of [...stable, ...changedAfter]) {
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
	const stableSet = new Set(stable)
	const groups: iGroup[] = [
		{ ids: new Set(transformedIds.filter(id => stableSet.has(id))), suffix: '', volatile: false },
		{ ids: new Set(transformedIds.filter(id => !stableSet.has(id))), suffix: CHANGED_SUFFIX, volatile: true }
	].filter(group => group.ids.size > 0)

	// vtex_client_profile: só os perfis dos pedidos comparados (o perfil não depende do andamento do pedido).
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

	// 8. Comparação por tabela, por grupo; o perfil de cliente uma vez só, com todos os pedidos comparados.
	const newRowsOf = (table: string, ids: ReadonlySet<string>): tRow[] => {
		if (table === ORDER_TABLES.orders) return onlyOrders(orderRows, ids)

		return [...ids].flatMap(orderId => {
			const rows = transformed.get(orderId)

			if (!rows) return []

			return table === ORDER_TABLES.details
				? [rows.details]
				: (rows.children[table as keyof iDetailRows['children']] ?? [])
		})
	}

	const compareGroup = (spec: iTableSpec, group: iGroup): iCompareResult => {
		const baseIgnored = spec.ignoreColumns ?? DEFAULT_IGNORED
		const volatile = group.volatile ? (VOLATILE_COLUMNS[spec.table] ?? []) : []

		return redactPersonal(
			spec.table,
			compareRows({
				table: `${spec.table}${group.suffix}`,
				keyColumns: spec.keyColumns,
				expected: onlyOrders(productionByTable.get(spec.table) ?? [], group.ids),
				actual: newRowsOf(spec.table, group.ids),
				ignoreColumns: [...baseIgnored, ...volatile]
			})
		)
	}

	const orderSpecs = TABLE_SPECS.filter(spec => spec.table !== ORDER_TABLES.clientProfile)
	const profileSpec = TABLE_SPECS.find(spec => spec.table === ORDER_TABLES.clientProfile)
	const results: iCompareResult[] = groups.flatMap(group => orderSpecs.map(spec => compareGroup(spec, group)))

	if (profileSpec) {
		results.push(
			redactPersonal(
				profileSpec.table,
				compareRows({
					table: profileSpec.table,
					keyColumns: profileSpec.keyColumns,
					expected: productionProfiles.filter(row => profileIds.has(String(row.id))),
					actual: [...newProfiles.values()],
					ignoreColumns: profileSpec.ignoreColumns ?? DEFAULT_IGNORED
				})
			)
		)
	}

	// 9-10. Relatório e notas.
	const meta = {
		brand,
		database: ctx.database,
		window: { from: window.from.toISOString(), to: window.to.toISOString() },
		sample: sampleIds.length,
		listed: listed.length,
		stable: groups.find(group => !group.volatile)?.ids.size ?? 0,
		changedAfter: changedAfter,
		volatileColumns: VOLATILE_COLUMNS,
		acceptedDifferences: ACCEPTED_DIFFERENCES,
		withoutProductionDetail: withoutProductionDetail,
		failedDetails: failedDetails,
		invalid: invalid,
		neutralizedDates
	}
	const reportPath = await writeReport(`vtex-orders-${brand}`, results, meta)

	notes.push(
		`Janela: ${window.from.toISOString()} a ${window.to.toISOString()}; ${listed.length} pedido(s) listado(s), amostra de ${sampleIds.length}`,
		`${comparedIds.size} pedido(s) comparado(s): ${changedAfter.length} mudaram depois do ETL antigo (sem as colunas de ` +
			`andamento), o resto estrito; ` +
			`${withoutProductionDetail.length} sem detalhe na produção, ${failedDetails.length} falha(s) de detalhe, ` +
			`${invalid.length} fora do formato`,
		`${neutralizedDates} data(s) de autorização/faturamento neutralizada(s) (a VTEX não mandou)`,
		...extraNotes(results),
		...acceptedNotes(results, ACCEPTED_DIFFERENCES)
	)

	return { reportPath, tables: summarize(results, ACCEPTED_DIFFERENCES), notes }
}

export { MAX_ROWS_PER_ORDER, orderParity }
