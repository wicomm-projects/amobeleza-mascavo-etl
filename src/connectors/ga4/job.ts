import { getBrandConfig, type tBrand } from '../../config/index.js'
import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'
import type { iJob, iJobContext, iRunSummary } from '../../core/jobs/types.js'

import { createFixtureReader, createLiveReader, type iGa4Reader, type iReportRequest, loadFixture } from './api.js'
import { createChannelClassifier, type iChannelClassifier, type tChannelTable } from './de-para.js'
import { type iReportDefinition, reportsOf } from './reports.js'
import type { iReportData, tFixture } from './schemas.js'
import { collapseRows, toRows } from './transform.js'
import { SAO_PAULO_TZ, addDays, dayInTimeZone, type iDateWindow, resolveWindow } from './window.js'

/**
 * Job `ga4`: um runReport por tabela da marca, todos lidos antes de abrir a transação (nenhuma chamada de rede com
 * transação aberta), depois uma transação só para as tabelas da marca.
 *
 * - Tabelas com data: `replaceDateWindow` na janela (padrão: os últimos 3 dias, hoje incluído, fuso de São Paulo).
 * - `category` (Mascavo) e `por_hora` (Amobeleza): `replaceAll`.
 * - Relatório sem linhas não toca na tabela (o writer recusaria o lote vazio; resposta vazia não apaga dado) e vira
 *   aviso nas `notes`.
 */

/** Janela padrão, em dias, contando hoje: o GA4 ainda ajusta os últimos dias (processamento em até 48 h). */
const WINDOW_DAYS = 3
/** A cada 3 h, aos 15 min (fora dos :00/:30 dos jobs da VTEX). Fuso de São Paulo (agendador do núcleo). */
const GA4_SCHEDULE = '15 */3 * * *'
/** Quantas combinações origem/campanha sem De/Para aparecem no resumo; o resto vira "+N". */
const UNMAPPED_IN_NOTES = 10
/** As colunas de receita (purchase_revenue, transaction_revenue, Item_revenue) são em reais. */
const EXPECTED_CURRENCY = 'BRL'

interface iPreparedTable {
	definition: iReportDefinition
	window: iDateWindow
	rows: tRow[]
}

/**
 * Período pedido ao GA4 para cada tipo de tabela. As tabelas de `replaceAll` (category, por_hora) terminam sempre em
 * hoje, nunca no `--to`: numa carga retroativa (`--to` no passado), substituiriam o conteúdo atual por dado velho.
 */
const windowOf = (definition: iReportDefinition, window: iDateWindow, today: string): iDateWindow => {
	switch (definition.scope.kind) {
		case 'window':
			return window
		case 'since':
			return { from: definition.scope.startDate, to: today }
		case 'lastDays':
			return { from: addDays(today, -(definition.scope.days - 1)), to: today }
	}
}

/** O pedido do relatório sem o período (o check-access usa o mesmo pedido no checkCompatibility). */
const requestOf = (definition: iReportDefinition): Omit<iReportRequest, 'startDate' | 'endDate'> => ({
	dimensions: definition.dimensions,
	metrics: definition.metrics,
	dimensionFilter: definition.dimensionFilter,
	orderBys: definition.orderBys,
	keepEmptyRows: definition.keepEmptyRows
})

interface iTableOutcome {
	definition: iReportDefinition
	report: iReportData
	window: iDateWindow
	rows: number
	truncated: number
	merged: number
}

/** Avisos do GA4 sobre a resposta (linha "(other)", limiares de privacidade, amostragem) e do que o ETL ajustou. */
const reportNotes = ({ definition, report, window, rows, truncated, merged }: iTableOutcome): string[] => {
	const table = definition.table
	const notes: string[] = []

	if (rows === 0) notes.push(`${table}: o GA4 não devolveu linhas em ${window.from}..${window.to}; tabela não tocada`)

	if (report.metadata.timeZone && report.metadata.timeZone !== SAO_PAULO_TZ) {
		notes.push(`${table}: propriedade no fuso ${report.metadata.timeZone}; a janela padrão usa o dia de São Paulo`)
	}

	if (report.metadata.currencyCode && report.metadata.currencyCode !== EXPECTED_CURRENCY) {
		notes.push(`${table}: propriedade em ${report.metadata.currencyCode}; as colunas de receita esperam reais`)
	}

	if (report.metadata.dataLossFromOtherRow) notes.push(`${table}: o GA4 agrupou parte das linhas em "(other)"`)

	if (report.metadata.subjectToThresholding) notes.push(`${table}: resposta sujeita a limiares de privacidade do GA4`)

	if (report.metadata.sampled) notes.push(`${table}: resposta amostrada pelo GA4`)

	if (report.metadata.truncated) notes.push(`${table}: o GA4 avisou truncamento de dados`)

	if (truncated > 0) notes.push(`${table}: ${truncated} texto(s) cortado(s) em 255 caracteres`)

	if (merged > 0) {
		const how =
			definition.collapse && 'keep' in definition.collapse
				? 'com a mesma chave descartada(s) (fica a primeira na ordem do relatório)'
				: 'somada(s) por cair na mesma chave da tabela na produção'

		notes.push(`${table}: ${merged} linha(s) ${how}`)
	}

	return notes
}

const channelNotes = (table: tChannelTable, unmapped: string[], ruleCount: number): string[] => {
	if (unmapped.length === 0) return []

	const shown = unmapped.slice(0, UNMAPPED_IN_NOTES).join('; ')
	const extra = unmapped.length > UNMAPPED_IN_NOTES ? ` (+${unmapped.length - UNMAPPED_IN_NOTES})` : ''
	const prefix = ruleCount === 0 ? 'De/Para vazio' : 'De/Para incompleto'

	return [
		`${prefix} (${table}): ${unmapped.length} origem/campanha sem regra (vehicle_channel_no_pay e type nulos): ${shown}${extra}`
	]
}

/** Fixture da marca: só aceita tabela que a marca grava (pega erro de digitação no nome). */
const loadBrandFixture = async (brand: tBrand, path: string): Promise<tFixture> => {
	const fixture = await loadFixture(path)
	const tables = new Set<string>(reportsOf(brand).map(definition => definition.table))
	const unknown = Object.keys(fixture.reports).filter(table => !tables.has(table))

	if (unknown.length > 0)
		throw new AppError(`Fixture com tabela que a marca ${brand} não grava: ${unknown.join(', ')}`)

	return fixture
}

/** Abre o leitor por último: tudo o que pode falhar antes (fixture, janela, De/Para) não deixa cliente gRPC aberto. */
const openReader = async (brand: tBrand, fixture?: tFixture): Promise<iGa4Reader> => {
	if (fixture) return createFixtureReader(fixture)

	const ga4 = getBrandConfig(brand).ga4

	if (!ga4) throw new AppError(`GA4 (${brand}): sem ID de propriedade no .env.`)

	return createLiveReader(ga4.propertyId)
}

/** Classificador das tabelas sem De/Para: devolve sempre nulo e não conta como pendência. */
const NO_CHANNEL: iChannelClassifier = {
	classify: () => ({ vehicle_channel_no_pay: null, type: null }),
	unmapped: () => [],
	ruleCount: 0
}

/** O que a leitura dos relatórios precisa do contexto (a paridade monta isto sem writer). */
type tReadContext = Pick<iJobContext, 'options' | 'logger'>

/** Lê e prepara os relatórios da marca. A carga e a paridade usam este mesmo caminho. */
/** `definitions`: padrão, todas as da marca; a paridade passa uma lista própria (ex.: a por_hora numa janela fixa). */
const readReports = async (
	brand: tBrand,
	{ options, logger }: tReadContext,
	definitions: readonly iReportDefinition[] = reportsOf(brand)
): Promise<{ prepared: iPreparedTable[]; notes: string[] }> => {
	const fixture = options.fixture ? await loadBrandFixture(brand, options.fixture) : undefined
	const fallback = fixture?.dateRange
		? { from: fixture.dateRange.startDate, to: fixture.dateRange.endDate }
		: undefined
	const window = resolveWindow({ from: options.from, to: options.to, fallback, days: WINDOW_DAYS })
	const today = dayInTimeZone(new Date())
	const channels: Readonly<Record<tChannelTable, iChannelClassifier>> = {
		trafego: createChannelClassifier('trafego'),
		vendas: createChannelClassifier('vendas')
	}
	const reader = await openReader(brand, fixture)
	const prepared: iPreparedTable[] = []
	const notes: string[] = []

	try {
		for (const definition of definitions) {
			const tableWindow = windowOf(definition, window, today)
			const report = await reader.runReport(definition.table, {
				...requestOf(definition),
				startDate: tableWindow.from,
				endDate: tableWindow.to
			})
			const stats = { truncated: 0 }
			const rows = toRows(
				definition.table,
				report,
				definition.toRow,
				{
					propertyId: reader.propertyId,
					channel: definition.channelRules ? channels[definition.channelRules] : NO_CHANNEL
				},
				stats
			)
			const collapsed = definition.collapse ? collapseRows(rows, definition.collapse) : { rows, merged: 0 }

			logger.info(
				{ table: definition.table, from: tableWindow.from, to: tableWindow.to, rows: collapsed.rows.length },
				'Relatório GA4 lido'
			)
			notes.push(
				...reportNotes({
					definition,
					report,
					window: tableWindow,
					rows: collapsed.rows.length,
					truncated: stats.truncated,
					merged: collapsed.merged
				})
			)
			prepared.push({ definition, window: tableWindow, rows: collapsed.rows })
		}
	} finally {
		// Falha ao fechar não pode esconder o erro do relatório.
		await reader.close().catch((err: unknown) => logger.warn({ err }, 'GA4: falha ao fechar o cliente'))
	}

	const pending = (Object.keys(channels) as tChannelTable[]).flatMap(table =>
		channelNotes(table, channels[table].unmapped(), channels[table].ruleCount)
	)

	return { prepared, notes: [...notes, ...pending] }
}

const runGa4 = async (ctx: iJobContext): Promise<iRunSummary> => {
	const brand = ctx.brand

	if (!brand) throw new AppError('O job ga4 roda por marca: informe --brand.')

	const { prepared, notes } = await readReports(brand, ctx)

	const { results } = await ctx.writer.transaction(async tx => {
		for (const { definition, window, rows } of prepared) {
			if (rows.length === 0) continue

			if (definition.scope.kind === 'window') {
				await tx.replaceDateWindow(definition.table, definition.scope.dateColumn, window.from, window.to, rows)
				continue
			}

			await tx.replaceAll(definition.table, rows)
		}
	})

	if (ctx.options.fixture) notes.unshift('fixture: dados de exemplo, sem chamada ao GA4')

	return { results, notes }
}

const ga4Job: iJob = {
	name: 'ga4',
	source: 'ga4',
	scope: 'brand',
	description: 'Relatórios do GA4 nas tabelas sheets_google_drive_* (janela de 3 dias; category e por_hora inteiras)',
	// Tabelas por marca (os bancos diferem): o writer de cada marca e o schema:pull só veem as tabelas dela —
	// 5 na Mascavo, 4 na Amobeleza.
	tables: brand => {
		if (!brand) throw new AppError('O job ga4 roda por marca.')

		return reportsOf(brand).map(definition => definition.table)
	},
	database: brand => {
		if (!brand) throw new AppError('O job ga4 roda por marca.')

		return getBrandConfig(brand).database
	},
	schedule: GA4_SCHEDULE,
	run: runGa4
}

export { GA4_SCHEDULE, WINDOW_DAYS, ga4Job, readReports, requestOf }
export type { iPreparedTable }
