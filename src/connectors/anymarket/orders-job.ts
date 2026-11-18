import { readFile } from 'node:fs/promises'

import type { Logger } from 'pino'

import { ANYMARKET_DATABASE } from '../../config/index.js'
import type { iWriteResult, iWriter, tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iJob, iJobContext, iRunOptions, iRunSummary } from '../../core/jobs/types.js'

import { createAnymarketClient, formatApiDate, listOrderPages } from './client.js'
import { maskPersonalData } from './personal-data.js'
import { orderSchema, ordersPageSchema, type tAnymarketOrder, type tOrdersPage } from './schemas.js'
import { ALL_TABLES, ANYMARKET_TABLES, ORDER_KEY_COLUMN } from './tables.js'
import { type iOrderRows, toOrderRows } from './transform.js'

/**
 * Job anymarket-orders: pedidos de marketplace de TODAS as contas do token (inclui MASCAVO), gravados em amobeleza_etl.
 *
 * Janela pela data de ATUALIZAÇÃO (`updatedAfter`/`updatedBefore`): pega pedido novo e mudança de status de pedido antigo.
 * A API aceita no máximo 7 dias por consulta nesse filtro; a janela é dividida em fatias de 1 dia (menos páginas por
 * consulta, menos deslocamento de offset enquanto os pedidos mudam). Sem --from/--to: as últimas 24 h, a cada 30 min —
 * a sobreposição cobre o pedido que mudou durante a paginação e uma parada curta do agendador.
 * Carga retroativa: `run anymarket-orders --from 2026-10-05 --to AAAA-MM-DD`.
 *
 * Gravação (docs/contrato/convencoes.md), em lotes de WRITE_BATCH_ORDERS pedidos, cada lote numa transação:
 * - anymarket_orders: upsert pela PK `id` (id do pedido no AnyMarket);
 * - filhas: replaceByKeys por anymarket_order_id (apaga as linhas dos pedidos do lote e insere de novo).
 * O mesmo pedido em duas páginas (offset que andou) fica só com a última versão dentro do lote.
 *
 * Pedido fora do formato, ou com número que não cabe na coluna, é pulado e contado nas notas (só o ID vai para o log):
 * um pedido ruim não pode derrubar o lote nem travar as cargas seguintes.
 */

const JOB_NAME = 'anymarket-orders'

/** A cada 30 minutos (fuso de São Paulo). */
const SCHEDULE_EVERY_30_MIN = '*/30 * * * *'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const DEFAULT_LOOKBACK_MS = 24 * HOUR_MS
const WINDOW_SLICE_MS = DAY_MS
const WRITE_BATCH_ORDERS = 500

/** Quantos IDs de pedido recusado aparecem nas notas (o resto só na contagem). */
const MAX_REJECTED_IDS_IN_NOTES = 20

/**
 * Versão (`lastUpdate`) já gravada de cada pedido, só na memória deste processo. Com a janela de 24 h a cada 30 min, o
 * mesmo pedido volta ~48 vezes por dia; no processo do agendador, pedido sem mudança não é regravado. Cada `npm run etl`
 * é um processo novo (cache vazio): carga manual sempre grava tudo. Depois de um `db:apply`, reinicie o agendador.
 */
const writtenVersions = new Map<number, string>()
const MAX_CACHED_VERSIONS = 200_000

interface iWindow {
	from: Date
	to: Date
}

interface iParsedOrder {
	order: tAnymarketOrder
	rows: iOrderRows
}

interface iRunStats {
	pages: number
	received: number
	unchanged: number
	rejected: number
	rejectedIds: (number | string)[]
	nulledDates: Map<string, number>
}

/** Janela pedida, presa a "agora": --to no futuro (fim do dia) vira o instante atual. */
const resolveWindow = (options: iRunOptions, now: Date = new Date()): iWindow => {
	const to = options.to && options.to < now ? options.to : now
	const from = options.from ?? new Date(to.getTime() - DEFAULT_LOOKBACK_MS)

	if (from >= to) throw new AppError(`${JOB_NAME}: janela vazia (início ${from.toISOString()} >= fim).`)

	return { from, to }
}

const sliceWindow = (window: iWindow, sliceMs: number = WINDOW_SLICE_MS): iWindow[] => {
	const slices: iWindow[] = []

	for (let start = window.from.getTime(); start < window.to.getTime(); start += sliceMs) {
		slices.push({ from: new Date(start), to: new Date(Math.min(start + sliceMs, window.to.getTime())) })
	}

	return slices
}

/** --fixture: um JSON no formato da página de `GET /orders` (exemplo público da documentação). Links são ignorados. */
async function* fixturePages(file: string): AsyncGenerator<tOrdersPage> {
	const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
	const parsed = ordersPageSchema.safeParse(raw)

	if (!parsed.success) throw new AppError(`${JOB_NAME}: a fixture ${file} não está no formato da página de /orders.`)

	yield parsed.data
}

async function* apiPages(window: iWindow, logger: Logger): AsyncGenerator<tOrdersPage> {
	const client = createAnymarketClient()

	for (const slice of sliceWindow(window)) {
		const filters = { updatedAfter: formatApiDate(slice.from), updatedBefore: formatApiDate(slice.to) }

		logger.debug({ from: slice.from.toISOString(), to: slice.to.toISOString() }, 'AnyMarket: fatia da janela')
		yield* listOrderPages(client, filters, logger)
	}
}

/** De onde vêm as páginas: a fixture (sem rede) ou a API, na janela pedida. */
const openPages = (options: iRunOptions, logger: Logger): { window?: iWindow; pages: AsyncGenerator<tOrdersPage> } => {
	if (options.fixture) return { pages: fixturePages(options.fixture) }

	const window = resolveWindow(options)

	return { window, pages: apiPages(window, logger) }
}

/** ID do pedido cru (para log de recusa), sem levar nenhum outro campo. */
const rawOrderId = (raw: unknown): number | string => {
	if (typeof raw !== 'object' || raw === null || !('id' in raw)) return '(sem id)'

	const id = (raw as { id: unknown }).id

	return typeof id === 'number' || typeof id === 'string' ? id : '(id inválido)'
}

/**
 * Erro do banco sem o SQL: o mysql2 guarda em `err.sql` o INSERT montado, com nome, e-mail e documento do comprador, e o
 * runner loga o erro inteiro. Sobe só o código e, se houver, o nome da coluna.
 */
const describeDbError = (err: unknown): string => {
	const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : 'erro sem código'
	const column = /column '([A-Za-z0-9_]+)'/.exec(err instanceof Error ? err.message : '')?.[1]

	return column ? `${code}, coluna ${column}` : code
}

const writeBatch = async (writer: iWriter, batch: iParsedOrder[]): Promise<iWriteResult[]> => {
	const ids = batch.map(({ order }) => order.id)
	const collect = (pick: (rows: iOrderRows) => tRow[]) => batch.flatMap(({ rows }) => pick(rows))

	try {
		const { results } = await writer.transaction(async tx => {
			await tx.upsert(
				ANYMARKET_TABLES.orders,
				batch.map(({ rows }) => rows.order),
				{ keyColumns: ['id'] }
			)
			await tx.replaceByKeys(
				ANYMARKET_TABLES.items,
				ORDER_KEY_COLUMN,
				ids,
				collect(rows => rows.items)
			)
			await tx.replaceByKeys(
				ANYMARKET_TABLES.payments,
				ORDER_KEY_COLUMN,
				ids,
				collect(rows => rows.payments)
			)
			await tx.replaceByKeys(
				ANYMARKET_TABLES.shipping,
				ORDER_KEY_COLUMN,
				ids,
				// Endereço de rua e quem recebe: mascarados enquanto o destino é o local (personal-data.ts).
				maskPersonalData(
					ANYMARKET_TABLES.shipping,
					collect(rows => rows.shipping)
				)
			)
			await tx.replaceByKeys(
				ANYMARKET_TABLES.tracking,
				ORDER_KEY_COLUMN,
				ids,
				collect(rows => rows.tracking)
			)
			await tx.replaceByKeys(
				ANYMARKET_TABLES.buyer,
				ORDER_KEY_COLUMN,
				ids,
				// Nome, e-mail e documento do comprador: mascarados enquanto o destino é o local (personal-data.ts).
				maskPersonalData(
					ANYMARKET_TABLES.buyer,
					collect(rows => rows.buyer)
				)
			)
		})

		return results
	} catch (err) {
		// Erros do próprio ETL (travas, contrato das linhas) já vêm sem dado pessoal.
		if (err instanceof AppError) throw err

		throw new AppError(
			`${JOB_NAME}: lote de ${batch.length} pedido(s) não gravado (${describeDbError(err)}), ids ${ids[0]}…${ids.at(-1)}. ` +
				'Detalhe do banco omitido: o SQL pode conter dado pessoal.'
		)
	}
}

const rememberVersions = (batch: iParsedOrder[]) => {
	if (writtenVersions.size + batch.length > MAX_CACHED_VERSIONS) writtenVersions.clear()

	for (const { order } of batch) {
		if (order.lastUpdate) writtenVersions.set(order.id, order.lastUpdate)
	}
}

const buildNotes = (window: iWindow | undefined, stats: iRunStats, written: number): string[] => {
	const notes = [
		window
			? `janela por atualização ${window.from.toISOString()} → ${window.to.toISOString()}`
			: 'fixture (sem chamada à API)',
		`${stats.pages} página(s), ${stats.received} pedido(s) recebidos, ${written} gravado(s), ${stats.unchanged} sem mudança`
	]

	if (stats.rejected > 0) {
		const more = stats.rejected > stats.rejectedIds.length ? ' …' : ''

		notes.push(`${stats.rejected} pedido(s) recusados, não gravados (ids: ${stats.rejectedIds.join(', ')}${more})`)
	}

	if (stats.nulledDates.size > 0) {
		const fields = [...stats.nulledDates].map(([field, count]) => `${field} ${count}`).join(', ')

		notes.push(`datas sem fuso, ilegíveis ou fora da faixa gravadas como NULL: ${fields}`)
	}

	return notes
}

const run = async (ctx: iJobContext): Promise<iRunSummary> => {
	const { logger, writer, options } = ctx
	const { window, pages } = openPages(options, logger)
	const useVersionCache = !options.dryRun && !options.fixture
	const stats: iRunStats = {
		pages: 0,
		received: 0,
		unchanged: 0,
		rejected: 0,
		rejectedIds: [],
		nulledDates: new Map()
	}
	const results: iWriteResult[] = []
	/** Lote atual, por id: o mesmo pedido em duas páginas fica com a versão mais recente. */
	let batch = new Map<number, iParsedOrder>()
	let written = 0

	const reject = (id: number | string, reason: string, fields: string[]) => {
		stats.rejected += 1

		if (stats.rejectedIds.length < MAX_REJECTED_IDS_IN_NOTES) stats.rejectedIds.push(id)

		logger.warn({ orderId: id, reason, fields }, 'AnyMarket: pedido recusado, não gravado')
	}

	const flush = async () => {
		if (batch.size === 0) return

		const pending = [...batch.values()]

		batch = new Map()
		results.push(...(await writeBatch(writer, pending)))
		written += pending.length

		if (useVersionCache) rememberVersions(pending)

		logger.info({ orders: pending.length, written }, 'AnyMarket: lote gravado')
	}

	for await (const page of pages) {
		stats.pages += 1
		stats.received += page.content.length

		for (const raw of page.content) {
			const parsed = orderSchema.safeParse(raw)

			if (!parsed.success) {
				reject(
					rawOrderId(raw),
					'fora do formato',
					parsed.error.issues.map(issue => issue.path.join('.'))
				)
				continue
			}

			const order = parsed.data

			if (useVersionCache && order.lastUpdate && writtenVersions.get(order.id) === order.lastUpdate) {
				stats.unchanged += 1
				continue
			}

			const rows = toOrderRows(order)

			if (rows.outOfRange.length > 0) {
				reject(order.id, 'número fora da faixa da coluna', rows.outOfRange)
				continue
			}

			rows.nulledDates.forEach(field => stats.nulledDates.set(field, (stats.nulledDates.get(field) ?? 0) + 1))
			batch.set(order.id, { order, rows })
		}

		if (batch.size >= WRITE_BATCH_ORDERS) await flush()
	}

	await flush()

	return { results, notes: buildNotes(window, stats, written) }
}

const anymarketOrdersJob: iJob = {
	name: JOB_NAME,
	source: 'anymarket',
	scope: 'global',
	description: 'Pedidos de marketplace (todas as contas do AnyMarket) → amobeleza_etl.anymarket_*',
	tables: ALL_TABLES,
	database: () => ANYMARKET_DATABASE,
	schedule: SCHEDULE_EVERY_30_MIN,
	run
}

export { anymarketOrdersJob, resolveWindow, sliceWindow }
