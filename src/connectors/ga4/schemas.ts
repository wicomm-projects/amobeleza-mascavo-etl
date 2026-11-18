import { z } from 'zod'

import { AppError } from '../../core/errors.js'

import { ISO_DAY } from './window.js'

/**
 * Validação na borda do que vem do GA4 (runReport, getMetadata, checkCompatibility) e do arquivo de fixture.
 *
 * A biblioteca devolve objetos do protobuf: campo opcional pode vir `null`, enum como texto e int64 como texto. Por isso
 * o que só serve para aviso fica frouxo (nullish), e o que vira coluna é conferido.
 */

const headerSchema = z.object({ name: z.string().min(1) })

const cellSchema = z.object({ value: z.string() })

const rowSchema = z.object({
	dimensionValues: z.array(cellSchema).nullish(),
	metricValues: z.array(cellSchema).nullish()
})

const metadataSchema = z.object({
	dataLossFromOtherRow: z.boolean().nullish(),
	subjectToThresholding: z.boolean().nullish(),
	samplingMetadatas: z.array(z.unknown()).nullish(),
	dataTruncationReasons: z.array(z.unknown()).nullish(),
	timeZone: z.string().nullish(),
	currencyCode: z.string().nullish()
})

const reportResponseSchema = z.object({
	dimensionHeaders: z.array(headerSchema).nullish(),
	metricHeaders: z.array(headerSchema).nullish(),
	rows: z.array(rowSchema).nullish(),
	rowCount: z.coerce.number().int().nonnegative().nullish(),
	metadata: metadataSchema.nullish()
})

const metadataResponseSchema = z.object({
	dimensions: z.array(z.object({ apiName: z.string() })).nullish(),
	metrics: z.array(z.object({ apiName: z.string() })).nullish()
})

const compatibilityEntrySchema = z.object({
	compatibility: z.union([z.string(), z.number()]).nullish()
})

const compatibilityResponseSchema = z.object({
	dimensionCompatibilities: z
		.array(compatibilityEntrySchema.extend({ dimensionMetadata: z.object({ apiName: z.string() }).nullish() }))
		.nullish(),
	metricCompatibilities: z
		.array(compatibilityEntrySchema.extend({ metricMetadata: z.object({ apiName: z.string() }).nullish() }))
		.nullish()
})

/**
 * Fixture (`--fixture`): respostas do runReport no formato da API REST, uma por tabela, montadas a partir da
 * documentação pública. Nada de dado da cliente.
 */
const fixtureSchema = z.object({
	leiame: z.string().optional(),
	/** Propriedade de exemplo (gravada em ga4_property_id). */
	propertyId: z.string().regex(/^\d+$/),
	/** Janela usada quando o CLI não passa --from/--to. */
	dateRange: z
		.object({ startDate: z.string().regex(ISO_DAY), endDate: z.string().regex(ISO_DAY) })
		.refine(range => range.startDate <= range.endDate, 'startDate depois de endDate')
		.optional(),
	reports: z.record(z.string(), z.unknown())
})

type tFixture = z.infer<typeof fixtureSchema>

interface iReportMetadata {
	dataLossFromOtherRow: boolean
	subjectToThresholding: boolean
	sampled: boolean
	truncated: boolean
	timeZone?: string
	currencyCode?: string
}

/** Resposta do runReport já validada e achatada: valores na ordem dos cabeçalhos. */
interface iReportData {
	dimensionHeaders: string[]
	metricHeaders: string[]
	rows: { dimensions: string[]; metrics: string[] }[]
	/** Total de linhas da consulta, independente da página. */
	rowCount: number
	metadata: iReportMetadata
}

const describeIssues = (error: z.ZodError): string =>
	error.issues
		.slice(0, 3)
		.map(issue => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
		.join('; ')

const parseReport = (table: string, raw: unknown): iReportData => {
	const parsed = reportResponseSchema.safeParse(raw)

	if (!parsed.success) {
		throw new AppError(`${table}: resposta do GA4 fora do formato esperado (${describeIssues(parsed.error)})`)
	}

	const dimensionHeaders = (parsed.data.dimensionHeaders ?? []).map(header => header.name)
	const metricHeaders = (parsed.data.metricHeaders ?? []).map(header => header.name)
	const rows = (parsed.data.rows ?? []).map((row, index) => {
		const dimensions = (row.dimensionValues ?? []).map(cell => cell.value)
		const metrics = (row.metricValues ?? []).map(cell => cell.value)

		if (dimensions.length !== dimensionHeaders.length || metrics.length !== metricHeaders.length) {
			throw new AppError(`${table}: a linha ${index} da resposta do GA4 não bate com os cabeçalhos.`)
		}

		return { dimensions, metrics }
	})
	const metadata = parsed.data.metadata

	return {
		dimensionHeaders,
		metricHeaders,
		rows,
		rowCount: parsed.data.rowCount ?? rows.length,
		metadata: {
			dataLossFromOtherRow: metadata?.dataLossFromOtherRow === true,
			subjectToThresholding: metadata?.subjectToThresholding === true,
			sampled: (metadata?.samplingMetadatas?.length ?? 0) > 0,
			truncated: (metadata?.dataTruncationReasons?.length ?? 0) > 0,
			timeZone: metadata?.timeZone ?? undefined,
			currencyCode: metadata?.currencyCode ?? undefined
		}
	}
}

const parseFixture = (path: string, raw: unknown): tFixture => {
	const parsed = fixtureSchema.safeParse(raw)

	if (!parsed.success) throw new AppError(`Fixture ${path} inválida (${describeIssues(parsed.error)})`)

	return parsed.data
}

const parseMetadataNames = (raw: unknown): { dimensions: Set<string>; metrics: Set<string> } => {
	const parsed = metadataResponseSchema.safeParse(raw)

	if (!parsed.success)
		throw new AppError(`Metadata do GA4 fora do formato esperado (${describeIssues(parsed.error)})`)

	return {
		dimensions: new Set((parsed.data.dimensions ?? []).map(item => item.apiName)),
		metrics: new Set((parsed.data.metrics ?? []).map(item => item.apiName))
	}
}

/** Nomes que o checkCompatibility marcou como incompatíveis no mesmo relatório. */
const parseIncompatible = (raw: unknown): string[] => {
	const parsed = compatibilityResponseSchema.safeParse(raw)

	if (!parsed.success) {
		throw new AppError(`checkCompatibility do GA4 fora do formato esperado (${describeIssues(parsed.error)})`)
	}

	const isIncompatible = (value: string | number | null | undefined) => value === 'INCOMPATIBLE' || value === 2
	const dimensions = (parsed.data.dimensionCompatibilities ?? [])
		.filter(entry => isIncompatible(entry.compatibility))
		.map(entry => entry.dimensionMetadata?.apiName ?? '(dimensão sem nome)')
	const metrics = (parsed.data.metricCompatibilities ?? [])
		.filter(entry => isIncompatible(entry.compatibility))
		.map(entry => entry.metricMetadata?.apiName ?? '(métrica sem nome)')

	return [...dimensions, ...metrics]
}

export { parseFixture, parseIncompatible, parseMetadataNames, parseReport }
export type { iReportData, iReportMetadata, tFixture }
