import type { tBrand } from '../../config/index.js'
import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iParityContext, iParitySummary } from '../../core/jobs/types.js'
import { compareRows, type iCompareResult, normalize, writeParityReport } from '../../core/parity/compare.js'
import {
	acceptedNotes,
	extraNotes,
	qualified,
	summarize,
	type tAcceptedDifferences
} from '../../core/parity/helpers.js'

import { type iPreparedTable, readReports } from './job.js'
import type { tGa4Table } from './reports.js'
import { ISO_DAY, addDays } from './window.js'

/**
 * Paridade do ga4: monta em memória, com o MESMO caminho da carga (`readReports`: mesmas definições, mesma
 * transformação, mesmo `collapse`), as linhas de uma janela antiga e compara com o que o pipeline antigo (Supermetrics →
 * planilhas) gravou nas 5 tabelas da Mascavo (só SELECT com LIMIT na produção). Nada é gravado em banco nenhum; o GA4
 * só recebe leitura.
 *
 * O GA4 pode diferir um pouco do Supermetrics (processamento, limiares de privacidade): por isso o relatório leva o
 * total de cada coluna numérica nos dois lados e a diferença em %, para separar ruído de erro de regra.
 *
 * Amobeleza: fica fora da comparação, por enquanto. A propriedade ainda não tem permissão, as definições dela não têm
 * chave de junção (`collapse`) e a `por_hora` não tem janela de data. Entra quando a chave for definida.
 */

const JOB_NAME = 'ga4'
/** Janela padrão: 7 dias, contando o último. */
const DEFAULT_WINDOW_DAYS = 7
/** Os últimos dias do histórico podem ter sido gravados antes de o GA4 fechar os números. */
const DEFAULT_LAG_DAYS = 7
/** Piso do MAX(date): faz a consulta usar o índice que começa por `date`. */
const MAX_DATE_FLOOR = '2025-01-01'
const MAX_ROWS_WINDOW = 200_000
const MAX_ROWS_FULL_TABLE = 50_000
const ISO_DAY_LENGTH = 10
const PERCENT = 100
const PERCENT_DECIMALS = 2
const LAST_WINDOW_TABLE: tGa4Table = 'sheets_google_drive_trafego'
const IGNORED_COLUMNS = ['id', 'created_at', 'updated_at']

/** O mesmo retorno de `readReports`: as tabelas prontas e as notas (inclui as pendências do De/Para). */
type tReadReports = (
	brand: tBrand,
	from: string,
	to: string
) => Promise<{ prepared: iPreparedTable[]; notes: string[] }>

interface iParityDeps {
	read?: tReadReports
	writeReport?: typeof writeParityReport
}

interface iDay {
	from: string
	to: string
}

/** Chave de comparação e colunas numéricas (para os totais) de cada tabela da Mascavo. */
const TABLE_SPECS: Readonly<Partial<Record<tGa4Table, { keyColumns: string[]; metrics: string[] }>>> = {
	sheets_google_drive_trafego: {
		keyColumns: ['date', 'session_source', 'session_campaign_name', 'platform_device_category'],
		metrics: ['event_count']
	},
	sheets_google_drive_vendas: {
		keyColumns: ['date', 'source', 'event_campaign_name', 'platform_device_category'],
		metrics: ['purchase_revenue', 'conversions']
	},
	sheets_google_drive_users: {
		keyColumns: ['Date', 'Session_source'],
		metrics: ['First_time_purchasers', 'New_users']
	},
	sheets_google_drive_items: {
		keyColumns: ['Date', 'Session_source', 'Item_name'],
		metrics: ['Item_revenue', 'Item_purchase_quantity']
	},
	sheets_google_drive_category: {
		keyColumns: ['Item_category', 'Item_category_2', 'Item_name'],
		metrics: []
	}
}

/** Diferenças conhecidas com o pipeline antigo: preencher depois da paridade real. */
const ACCEPTED_DIFFERENCES: tAcceptedDifferences = {}

/**
 * Janela por dia (AAAA-MM-DD). Com --from e --to, usa. Só um deles: o outro fica 6 dias de distância. Sem nenhum: acha o
 * último dia gravado pelo pipeline antigo (um MAX, com LIMIT 1), recua 7 dias e pega 7 dias ao todo.
 */
const resolveDays = async (ctx: iParityContext): Promise<iDay> => {
	const { from, to } = ctx.options
	const lastDay = DEFAULT_WINDOW_DAYS - 1

	// O --from vem como 00:00Z do dia digitado; o --to, como 23:59Z (o dia é o mesmo, em UTC).
	const fromDay = from?.toISOString().slice(0, ISO_DAY_LENGTH)
	const toDay = to?.toISOString().slice(0, ISO_DAY_LENGTH)

	if (fromDay && toDay) return { from: fromDay, to: toDay }

	if (toDay) return { from: addDays(toDay, -lastDay), to: toDay }

	if (fromDay) return { from: fromDay, to: addDays(fromDay, lastDay) }

	const [row] = await ctx.refReader.query<{ ultima: Date | string | null }>(
		`SELECT MAX(date) AS ultima FROM ${qualified(ctx.database, LAST_WINDOW_TABLE)} WHERE date >= ? LIMIT 1`,
		[MAX_DATE_FLOOR]
	)
	const last = normalize(row?.ultima)?.slice(0, ISO_DAY_LENGTH)

	if (!last || !ISO_DAY.test(last)) {
		throw new AppError(`Paridade: a produção não tem dado em ${LAST_WINDOW_TABLE} para achar a janela.`)
	}

	const end = addDays(last, -DEFAULT_LAG_DAYS)

	return { from: addDays(end, -lastDay), to: end }
}

/** Padrão: o mesmo caminho da carga, só leitura (dryRun), com a janela do dia inteiro em UTC como o CLI monta. */
const defaultRead =
	(ctx: iParityContext): tReadReports =>
	(brand, from, to) =>
		readReports(brand, {
			logger: ctx.logger,
			options: {
				dryRun: true,
				from: new Date(`${from}T00:00:00.000Z`),
				to: new Date(`${to}T23:59:59.999Z`)
			}
		})

/** Linhas da produção: tabelas por janela, na coluna de data; as de `since` (category), a tabela inteira. */
const readProduction = async (ctx: iParityContext, table: iPreparedTable, day: iDay): Promise<tRow[]> => {
	const { definition } = table
	const target = qualified(ctx.database, definition.table)

	if (definition.scope.kind !== 'window') {
		return ctx.refReader.query<tRow>(`SELECT * FROM ${target} LIMIT ${MAX_ROWS_FULL_TABLE}`)
	}

	return ctx.refReader.query<tRow>(
		`SELECT * FROM ${target} WHERE ${definition.scope.dateColumn} BETWEEN ? AND ? LIMIT ${MAX_ROWS_WINDOW}`,
		[day.from, day.to]
	)
}

const sumOf = (rows: readonly tRow[], column: string): number =>
	rows.reduce((total, row) => total + (Number(row[column]) || 0), 0)

interface iTotal {
	column: string
	production: number
	novo: number
	/** Diferença do novo sobre a produção, em %. Nulo quando a produção soma zero. */
	differencePercent: number | null
}

const totalsOf = (columns: readonly string[], production: readonly tRow[], novo: readonly tRow[]): iTotal[] =>
	columns.map(column => {
		const before = sumOf(production, column)
		const after = sumOf(novo, column)
		const percent = before === 0 ? null : ((after - before) / Math.abs(before)) * PERCENT

		return {
			column,
			production: Number(before.toFixed(PERCENT_DECIMALS)),
			novo: Number(after.toFixed(PERCENT_DECIMALS)),
			differencePercent: percent === null ? null : Number(percent.toFixed(PERCENT_DECIMALS))
		}
	})

const totalNote = (table: string, total: iTotal): string => {
	const difference = total.differencePercent === null ? 'sem base' : `${total.differencePercent}%`

	return `Total ${table}.${total.column}: produção ${total.production}, novo ${total.novo} (${difference})`
}

const ga4Parity = async (ctx: iParityContext, deps: iParityDeps = {}): Promise<iParitySummary> => {
	const brand = ctx.brand

	if (!brand) throw new AppError('A paridade do ga4 roda por marca: informe --brand.')

	const writeReport = deps.writeReport ?? writeParityReport
	const day = await resolveDays(ctx)

	if (brand === 'amobeleza') {
		const note =
			'Amobeleza fora da paridade do GA4 por enquanto: sem permissão na propriedade e sem chave de junção.'
		const reportPath = await writeReport(`${JOB_NAME}-${brand}`, [], { brand, window: day, notes: [note] })

		return { reportPath, tables: [], notes: [note] }
	}

	const read = deps.read ?? defaultRead(ctx)
	const { prepared, notes: readNotes } = await read(brand, day.from, day.to)
	const results: iCompareResult[] = []
	const rowsByTable: Record<string, { production: number; novo: number }> = {}
	const totalsByTable: Record<string, iTotal[]> = {}

	for (const table of prepared) {
		const name = table.definition.table
		const spec = TABLE_SPECS[name]

		if (!spec) throw new AppError(`Paridade do ga4: sem chave de comparação para ${name}.`)

		const production = await readProduction(ctx, table, day)

		results.push(
			compareRows({
				table: name,
				keyColumns: spec.keyColumns,
				expected: production,
				actual: table.rows,
				ignoreColumns: IGNORED_COLUMNS
			})
		)
		rowsByTable[name] = { production: production.length, novo: table.rows.length }
		totalsByTable[name] = totalsOf(spec.metrics, production, table.rows)
	}

	const meta = {
		brand,
		database: ctx.database,
		window: day,
		rows: rowsByTable,
		totals: totalsByTable,
		readNotes,
		acceptedDifferences: ACCEPTED_DIFFERENCES
	}
	const reportPath = await writeReport(`${JOB_NAME}-${brand}`, results, meta)
	const notes = [
		`Janela: ${day.from} a ${day.to}`,
		...Object.entries(totalsByTable).flatMap(([name, totals]) => totals.map(total => totalNote(name, total))),
		...extraNotes(results),
		...acceptedNotes(results, ACCEPTED_DIFFERENCES),
		...readNotes
	]

	return { reportPath, tables: summarize(results, ACCEPTED_DIFFERENCES), notes }
}

export { ga4Parity }
