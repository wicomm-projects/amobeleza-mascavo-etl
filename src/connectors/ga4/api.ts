import { readFile } from 'node:fs/promises'

import type { BetaAnalyticsDataClient } from '@google-analytics/data'

import { getEnv } from '../../config/index.js'
import { AppError, NotConfiguredError } from '../../core/errors.js'

import type { tFilterExpression, tOrderBy } from './reports.js'
import {
	type iReportData,
	parseFixture,
	parseIncompatible,
	parseMetadataNames,
	parseReport,
	type tFixture
} from './schemas.js'

/**
 * Acesso ao GA4: a API de dados (só leitura por natureza — não há método que grave) com a conta de serviço de
 * GOOGLE_APPLICATION_CREDENTIALS, ou a fixture no lugar dela (`--fixture`).
 *
 * A biblioteca é carregada sob demanda: o registro das fontes importa este conector em todo comando do CLI, e o gRPC só
 * precisa subir quando há chamada de verdade.
 */

/** Teto por chamada. O runReport de uma janela de 3 dias responde em segundos; uma carga retroativa, em mais. */
const GA4_CALL_TIMEOUT_MS = 120_000
/** Linhas por página do runReport (a API aceita até 250.000; o padrão é 10.000). */
const PAGE_SIZE = 100_000
/** Teto de páginas por relatório: acima disso, peça uma janela menor (--from/--to). */
const MAX_PAGES = 20
const MAX_ROWS = MAX_PAGES * PAGE_SIZE

interface iReportRequest {
	dimensions: readonly string[]
	metrics: readonly string[]
	dimensionFilter?: tFilterExpression
	orderBys?: readonly tOrderBy[]
	keepEmptyRows?: boolean
	startDate: string
	endDate: string
}

interface iGa4Reader {
	/** Propriedade dos dados (a da marca, ou a de exemplo da fixture). */
	propertyId: string
	/** Lê todas as páginas do relatório. `table` serve às mensagens e à escolha da resposta na fixture. */
	runReport: (table: string, request: iReportRequest) => Promise<iReportData>
	close: () => Promise<void>
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

const openClient = async (): Promise<BetaAnalyticsDataClient> => {
	const keyFilename = getEnv().GOOGLE_APPLICATION_CREDENTIALS

	if (!keyFilename)
		throw new NotConfiguredError('GA4: falta GOOGLE_APPLICATION_CREDENTIALS (JSON da conta de serviço).')

	const { BetaAnalyticsDataClient } = await import('@google-analytics/data')

	return new BetaAnalyticsDataClient({ keyFilename })
}

const tooManyRows = (table: string, request: iReportRequest, rows: number) =>
	new AppError(
		`${table}: ${rows} linhas em ${request.startDate}..${request.endDate} (teto ${MAX_ROWS}). Use uma janela menor (--from/--to).`
	)

const emptyReport = (request: iReportRequest): iReportData => ({
	dimensionHeaders: [...request.dimensions],
	metricHeaders: [...request.metrics],
	rows: [],
	rowCount: 0,
	metadata: { dataLossFromOtherRow: false, subjectToThresholding: false, sampled: false, truncated: false }
})

/** Junta as páginas: linhas em sequência; avisos de perda de dado valem se qualquer página avisou. */
const mergePages = (pages: iReportData[]): iReportData => {
	const [first, ...rest] = pages

	if (!first) throw new AppError('GA4: relatório sem nenhuma página.')

	return rest.reduce<iReportData>(
		(merged, page) => ({
			...merged,
			rows: [...merged.rows, ...page.rows],
			metadata: {
				...merged.metadata,
				dataLossFromOtherRow: merged.metadata.dataLossFromOtherRow || page.metadata.dataLossFromOtherRow,
				subjectToThresholding: merged.metadata.subjectToThresholding || page.metadata.subjectToThresholding,
				sampled: merged.metadata.sampled || page.metadata.sampled,
				truncated: merged.metadata.truncated || page.metadata.truncated
			}
		}),
		first
	)
}

/**
 * Ordem da definição + desempate por todas as dimensões: com offset/limit, só uma ordem total garante que nenhuma linha
 * se repita ou suma entre uma página e outra.
 */
const stableOrder = (request: iReportRequest): tOrderBy[] => [
	...(request.orderBys ?? []),
	...request.dimensions.map(dimensionName => ({ dimension: { dimensionName } }))
]

const createLiveReader = async (propertyId: string): Promise<iGa4Reader> => {
	const client = await openClient()
	const property = `properties/${propertyId}`

	const runReport = async (table: string, request: iReportRequest): Promise<iReportData> => {
		const pages: iReportData[] = []
		let offset = 0

		for (let page = 0; page < MAX_PAGES; page += 1) {
			const [raw] = await client
				.runReport(
					{
						property,
						dimensions: request.dimensions.map(name => ({ name })),
						metrics: request.metrics.map(name => ({ name })),
						dateRanges: [{ startDate: request.startDate, endDate: request.endDate }],
						dimensionFilter: request.dimensionFilter,
						orderBys: stableOrder(request),
						keepEmptyRows: request.keepEmptyRows ?? false,
						limit: PAGE_SIZE,
						offset
					},
					{ timeout: GA4_CALL_TIMEOUT_MS }
				)
				.catch((err: unknown) => {
					throw new AppError(`GA4 runReport (${table}): ${errorMessage(err)}`, { cause: err })
				})
			const data = parseReport(table, raw)

			// O rowCount da primeira página já diz o total: recusa antes de baixar 20 páginas.
			if (data.rowCount > MAX_ROWS) throw tooManyRows(table, request, data.rowCount)

			pages.push(data)
			offset += data.rows.length

			if (data.rows.length === 0 || offset >= data.rowCount) return mergePages(pages)
		}

		throw tooManyRows(table, request, offset)
	}

	return { propertyId, runReport, close: () => client.close() }
}

const loadFixture = async (path: string): Promise<tFixture> => {
	const content = await readFile(path, 'utf8').catch((err: unknown) => {
		throw new AppError(`Fixture ${path} não pôde ser lida: ${errorMessage(err)}`, { cause: err })
	})

	try {
		return parseFixture(path, JSON.parse(content))
	} catch (err) {
		if (err instanceof AppError) throw err

		throw new AppError(`Fixture ${path} não é JSON válido: ${errorMessage(err)}`, { cause: err })
	}
}

/** A fixture responde no lugar da API: uma resposta do runReport por tabela; tabela ausente = relatório vazio. */
const createFixtureReader = (fixture: tFixture): iGa4Reader => ({
	propertyId: fixture.propertyId,
	runReport: async (table, request) => {
		const raw = fixture.reports[table]

		return raw === undefined ? emptyReport(request) : parseReport(table, raw)
	},
	close: async () => undefined
})

interface iPropertyCheck {
	dimensions: number
	metrics: number
	/** Nomes usados pelas definições que a propriedade não conhece. */
	missing: string[]
	/** "tabela: nomes" das combinações que o checkCompatibility recusou. */
	incompatible: string[]
}

/**
 * check-access: lê a metadata da propriedade (lista de dimensões e métricas, sem dado da cliente) e pergunta ao
 * checkCompatibility se cada relatório pode ser montado. Também só metadado.
 */
const checkProperty = async (
	propertyId: string,
	reports: readonly { table: string; request: Omit<iReportRequest, 'startDate' | 'endDate'> }[]
): Promise<iPropertyCheck> => {
	const client = await openClient()
	const property = `properties/${propertyId}`

	try {
		const [rawMetadata] = await client.getMetadata(
			{ name: `${property}/metadata` },
			{ timeout: GA4_CALL_TIMEOUT_MS }
		)
		const known = parseMetadataNames(rawMetadata)
		const missing = new Set<string>()
		const incompatible: string[] = []

		for (const { table, request } of reports) {
			request.dimensions.filter(name => !known.dimensions.has(name)).forEach(name => missing.add(name))
			request.metrics.filter(name => !known.metrics.has(name)).forEach(name => missing.add(name))

			const [rawCompatibility] = await client.checkCompatibility(
				{
					property,
					dimensions: request.dimensions.map(name => ({ name })),
					metrics: request.metrics.map(name => ({ name })),
					dimensionFilter: request.dimensionFilter,
					compatibilityFilter: 'INCOMPATIBLE'
				},
				{ timeout: GA4_CALL_TIMEOUT_MS }
			)
			const names = parseIncompatible(rawCompatibility)

			if (names.length > 0) incompatible.push(`${table}: ${names.join(', ')}`)
		}

		return { dimensions: known.dimensions.size, metrics: known.metrics.size, missing: [...missing], incompatible }
	} catch (err) {
		if (err instanceof AppError) throw err

		throw new AppError(`GA4 (${property}): ${errorMessage(err)}`, { cause: err })
	} finally {
		// Falha ao fechar não pode esconder o resultado (ou o erro) da checagem.
		await client.close().catch(() => undefined)
	}
}

export { checkProperty, createFixtureReader, createLiveReader, loadFixture }
export type { iGa4Reader, iPropertyCheck, iReportRequest }
