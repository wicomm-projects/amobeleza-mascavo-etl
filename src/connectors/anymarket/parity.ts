import type { Logger } from 'pino'

import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iParityContext, iParitySummary } from '../../core/jobs/types.js'
import { compareRows, type iCompareResult, normalize, writeParityReport } from '../../core/parity/compare.js'
import {
	acceptedNotes,
	extraNotes,
	pickSample,
	qualified,
	redactColumns,
	summarize,
	type tAcceptedDifferences
} from '../../core/parity/helpers.js'

import { createAnymarketClient, formatApiDate, listOrderPages } from './client.js'
import { rawOrderId, sliceWindow } from './orders-job.js'
import { MASK, PERSONAL_COLUMNS } from './personal-data.js'
import { orderSchema, type tAnymarketOrder, type tOrdersPage } from './schemas.js'
import { ANYMARKET_TABLES, CHILD_TABLES, ORDER_KEY_COLUMN } from './tables.js'
import { type iOrderRows, toOrderRows } from './transform.js'

/**
 * Paridade de anymarket-orders: monta em memória, com a MESMA função da carga (`toOrderRows`), as linhas de uma amostra
 * de pedidos CRIADOS numa janela antiga e compara com o que o ETL antigo gravou nas 6 tabelas anymarket_* (só SELECT por
 * chave, com LIMIT). Nada é gravado em banco nenhum; a API só recebe GET.
 *
 * Dois grupos, cada um com o seu resultado por tabela:
 * - estáveis: nenhuma coluna de andamento do pedido difere → comparação estrita;
 * - mudou depois: alguma coluna de andamento (status, nota fiscal, pagamento...) difere, porque o pedido andou depois
 *   que o ETL antigo gravou. Entram com as colunas voláteis fora da comparação e o nome da tabela leva o sufixo
 *   " (mudou depois)".
 * O job é global: o banco é sempre amobeleza_etl e não há --brand.
 */

const DEFAULT_LAG_DAYS = 30
/** 2 dias, e não 7 como na VTEX: o AnyMarket tem cerca de 3 mil pedidos por dia somando todas as contas. */
const DEFAULT_WINDOW_DAYS = 2
const MS_PER_DAY = 86_400_000
/** Teto de linhas filhas por pedido nas consultas à produção (itens, parcelas). */
const MAX_ROWS_PER_ORDER = 50
/** Quantos IDs de pedido aparecem por lista nas notas (o relatório completo leva todos). */
const MAX_IDS_IN_NOTES = 20
const JOB_NAME = 'anymarket-orders'
const CHANGED_SUFFIX = ' (mudou depois)'

type tListPages = (filters: Record<string, string>) => AsyncGenerator<tOrdersPage>

interface iParityDeps {
	listPages?: tListPages
	writeReport?: typeof writeParityReport
}

interface iTableSpec {
	table: string
	keyColumns: string[]
	ignoreColumns: string[]
}

interface iGroup {
	ids: ReadonlySet<number>
	suffix: string
	volatile: boolean
}

interface iWindow {
	from: Date
	to: Date
}

const STAMPS = ['created_at', 'updated_at']
const CHILD_IGNORED = ['id', ...STAMPS]

const TABLE_SPECS: iTableSpec[] = [
	{ table: ANYMARKET_TABLES.orders, keyColumns: ['id'], ignoreColumns: STAMPS },
	{
		table: ANYMARKET_TABLES.items,
		keyColumns: [ORDER_KEY_COLUMN, 'sku_id', 'sku_kit_id', 'order_item_id'],
		ignoreColumns: CHILD_IGNORED
	},
	{
		table: ANYMARKET_TABLES.payments,
		keyColumns: [ORDER_KEY_COLUMN, 'method', 'value'],
		ignoreColumns: CHILD_IGNORED
	},
	{ table: ANYMARKET_TABLES.shipping, keyColumns: [ORDER_KEY_COLUMN], ignoreColumns: CHILD_IGNORED },
	{ table: ANYMARKET_TABLES.tracking, keyColumns: [ORDER_KEY_COLUMN, 'number'], ignoreColumns: CHILD_IGNORED },
	{ table: ANYMARKET_TABLES.buyer, keyColumns: [ORDER_KEY_COLUMN], ignoreColumns: CHILD_IGNORED }
]

/** Colunas de anymarket_orders que mudam com o andamento do pedido; também definem o grupo "mudou depois". */
const PROGRESS_COLUMNS = [
	'status',
	'market_place_status',
	'transmission_status',
	'deliver_status',
	'payment_date',
	'invoice_access_key',
	'invoice_series',
	'invoce_number',
	'invoice_date'
]

/** Colunas que mudam com o andamento do pedido: fora da comparação do grupo "mudou depois". */
const VOLATILE_COLUMNS: Readonly<Partial<Record<string, readonly string[]>>> = {
	[ANYMARKET_TABLES.orders]: PROGRESS_COLUMNS,
	[ANYMARKET_TABLES.payments]: ['status'],
	[ANYMARKET_TABLES.tracking]: ['url', 'carrier', 'date', 'estimate_date', 'shipped_date', 'delivered_date']
}

/**
 * Diferenças conhecidas com o ETL antigo, aceitas. Começa vazio: preenche-se depois da paridade real, cada coluna com o
 * motivo (como em src/connectors/vtex/orders-parity.ts).
 */
const ACCEPTED_DIFFERENCES: tAcceptedDifferences = {}

const endOfDayUtc = (date: Date): Date =>
	new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))

/**
 * Janela da amostra, por data de criação. Com --from e --to, usa. Só um deles: o outro fica 2 dias de distância. Sem
 * nenhum: acha o último pedido gravado pelo ETL antigo (um MAX, com LIMIT 1) e recua 30 dias.
 */
const resolveWindow = async (ctx: iParityContext): Promise<iWindow> => {
	const { from, to } = ctx.options

	if (from && to) return { from, to }

	if (to) return { from: new Date(to.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY), to }

	if (from) return { from, to: new Date(from.getTime() + DEFAULT_WINDOW_DAYS * MS_PER_DAY) }

	const [row] = await ctx.refReader.query<{ ultima: Date | string | null }>(
		`SELECT MAX(order_created_at) AS ultima FROM ${qualified(ctx.database, ANYMARKET_TABLES.orders)} LIMIT 1`
	)
	const lastText = normalize(row?.ultima)
	const last = lastText ? new Date(`${lastText.replace(' ', 'T')}Z`) : null

	if (!last || Number.isNaN(last.getTime())) {
		throw new AppError('Paridade: a produção não tem pedido em anymarket_orders para achar a janela.')
	}

	const end = endOfDayUtc(new Date(last.getTime() - DEFAULT_LAG_DAYS * MS_PER_DAY))

	return { from: new Date(end.getTime() - DEFAULT_WINDOW_DAYS * MS_PER_DAY), to: end }
}

interface iListed {
	orders: tAnymarketOrder[]
	invalid: (number | string)[]
	listed: number
}

/** Pedidos da janela (por criação), uma consulta por fatia de 1 dia; o mesmo pedido em duas páginas fica uma vez só. */
const listWindow = async (window: iWindow, listPages: tListPages, logger: Logger): Promise<iListed> => {
	const orders = new Map<number, tAnymarketOrder>()
	const invalid = new Set<number | string>()
	const listedIds = new Set<number | string>()

	for (const slice of sliceWindow(window)) {
		const filters = { createdAfter: formatApiDate(slice.from), createdBefore: formatApiDate(slice.to) }

		for await (const page of listPages(filters)) {
			for (const raw of page.content) {
				const parsed = orderSchema.safeParse(raw)

				if (!parsed.success) {
					const id = rawOrderId(raw)

					invalid.add(id)
					listedIds.add(id)
					logger.warn({ orderId: id }, 'Pedido fora do formato na paridade')

					continue
				}

				listedIds.add(parsed.data.id)
				orders.set(parsed.data.id, parsed.data)
			}
		}
	}

	return {
		orders: [...orders.values()].sort((left, right) => left.id - right.id),
		invalid: [...invalid],
		listed: listedIds.size
	}
}

const readByColumn = async (
	ctx: iParityContext,
	table: string,
	column: 'id' | typeof ORDER_KEY_COLUMN,
	ids: readonly number[],
	limitPerId: number
): Promise<tRow[]> => {
	if (ids.length === 0) return []

	return ctx.refReader.query<tRow>(`SELECT * FROM ${qualified(ctx.database, table)} WHERE ${column} IN (?) LIMIT ?`, [
		[...ids],
		ids.length * limitPerId
	])
}

const orderIdOf = (table: string, row: tRow): number =>
	Number(table === ANYMARKET_TABLES.orders ? row.id : row[ORDER_KEY_COLUMN])

const rowsOf = (table: string, rows: iOrderRows): tRow[] => {
	switch (table) {
		case ANYMARKET_TABLES.orders:
			return [rows.order]
		case ANYMARKET_TABLES.items:
			return rows.items
		case ANYMARKET_TABLES.payments:
			return rows.payments
		case ANYMARKET_TABLES.shipping:
			return rows.shipping
		case ANYMARKET_TABLES.tracking:
			return rows.tracking
		default:
			return rows.buyer
	}
}

const listNote = (label: string, ids: readonly (number | string)[]): string => {
	if (ids.length === 0) return `${label}: 0`

	const more = ids.length > MAX_IDS_IN_NOTES ? ' …' : ''

	return `${label}: ${ids.length} (ids: ${ids.slice(0, MAX_IDS_IN_NOTES).join(', ')}${more})`
}

const anymarketParity = async (ctx: iParityContext, deps: iParityDeps = {}): Promise<iParitySummary> => {
	const listPages: tListPages =
		deps.listPages ??
		((filters: Record<string, string>) => listOrderPages(createAnymarketClient(), filters, ctx.logger))
	const writeReport = deps.writeReport ?? writeParityReport
	const window = await resolveWindow(ctx)

	// 1-3. Lista da API na janela (por criação) e amostra determinística.
	const { orders: listedOrders, invalid, listed } = await listWindow(window, listPages, ctx.logger)
	const sample = pickSample(listedOrders, ctx.options.sample)
	const sampleIds = sample.map(order => order.id)

	// 4. Produção, só dos IDs da amostra.
	const productionByTable = new Map<string, tRow[]>()

	productionByTable.set(ANYMARKET_TABLES.orders, await readByColumn(ctx, ANYMARKET_TABLES.orders, 'id', sampleIds, 1))

	for (const table of CHILD_TABLES) {
		productionByTable.set(table, await readByColumn(ctx, table, ORDER_KEY_COLUMN, sampleIds, MAX_ROWS_PER_ORDER))
	}

	const productionOrders = new Map(
		(productionByTable.get(ANYMARKET_TABLES.orders) ?? []).map(row => [Number(row.id), row])
	)

	// 5. Transformação, como orders-job.ts; número fora da faixa é recusado também na carga.
	const outOfRange: number[] = []
	const withoutProduction: number[] = []
	const transformed = new Map<number, iOrderRows>()

	for (const order of sample) {
		const rows = toOrderRows(order)

		if (rows.outOfRange.length > 0) {
			outOfRange.push(order.id)

			continue
		}

		if (!productionOrders.has(order.id)) {
			withoutProduction.push(order.id)

			continue
		}

		transformed.set(order.id, rows)
	}

	// 6. Classificação pelas colunas de andamento.
	const stable: number[] = []
	const changedAfter: number[] = []

	for (const [orderId, rows] of transformed) {
		const production = productionOrders.get(orderId)
		const moved = PROGRESS_COLUMNS.some(column => normalize(production?.[column]) !== normalize(rows.order[column]))

		if (moved) changedAfter.push(orderId)
		else stable.push(orderId)
	}

	const groups: iGroup[] = [
		{ ids: new Set(stable), suffix: '', volatile: false },
		{ ids: new Set(changedAfter), suffix: CHANGED_SUFFIX, volatile: true }
	].filter(group => group.ids.size > 0)

	// 7. Comparação por tabela, por grupo.
	const compareGroup = (spec: iTableSpec, group: iGroup): iCompareResult => {
		const volatile = group.volatile ? (VOLATILE_COLUMNS[spec.table] ?? []) : []
		const actual = [...group.ids].flatMap(orderId => {
			const rows = transformed.get(orderId)

			return rows ? rowsOf(spec.table, rows) : []
		})

		return redactColumns(
			spec.table,
			compareRows({
				table: `${spec.table}${group.suffix}`,
				keyColumns: spec.keyColumns,
				expected: (productionByTable.get(spec.table) ?? []).filter(row =>
					group.ids.has(orderIdOf(spec.table, row))
				),
				actual,
				ignoreColumns: [...spec.ignoreColumns, ...volatile]
			}),
			PERSONAL_COLUMNS,
			MASK
		)
	}

	const results = groups.flatMap(group => TABLE_SPECS.map(spec => compareGroup(spec, group)))

	// 8-9. Relatório e notas.
	const byAccount: Record<string, number> = {}

	for (const order of sample) byAccount[order.accountName] = (byAccount[order.accountName] ?? 0) + 1

	const meta = {
		database: ctx.database,
		window: { from: window.from.toISOString(), to: window.to.toISOString() },
		sample: sampleIds.length,
		listed,
		byAccount,
		stable: stable.length,
		changedAfter,
		withoutProduction,
		invalid,
		outOfRange,
		volatileColumns: VOLATILE_COLUMNS,
		acceptedDifferences: ACCEPTED_DIFFERENCES
	}
	const reportPath = await writeReport(JOB_NAME, results, meta)
	const accounts = Object.entries(byAccount)
		.map(([account, count]) => `${account} ${count}`)
		.join(', ')
	const notes = [
		`Janela por criação: ${window.from.toISOString()} a ${window.to.toISOString()}; ${listed} pedido(s) listado(s), ` +
			`amostra de ${sampleIds.length}`,
		`Amostra por conta: ${accounts || '(vazia)'}`,
		`${stable.length} estável(is) (comparação estrita), ${changedAfter.length} mudaram depois do ETL antigo ` +
			`(sem as colunas de andamento), ${withoutProduction.length} sem produção`,
		listNote('Fora do formato', invalid),
		listNote('Número fora da faixa (fora da comparação)', outOfRange),
		...extraNotes(results),
		...acceptedNotes(results, ACCEPTED_DIFFERENCES)
	]

	return { reportPath, tables: summarize(results, ACCEPTED_DIFFERENCES), notes }
}

export { MAX_ROWS_PER_ORDER, anymarketParity }
