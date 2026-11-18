import type { tRow } from '../../core/db/index.js'
import { AppError } from '../../core/errors.js'

import type { iReportData } from './schemas.js'
import { collationKey, fitVarchar } from './text.js'

/**
 * Resposta do GA4 → linhas da tabela. Cada definição de relatório (reports.ts) lê os valores pelo nome da API e devolve
 * as colunas com a grafia exata do contrato; aqui ficam a conversão de tipo e a checagem de cada valor.
 */

interface iTransformStats {
	/** Textos cortados no limite do varchar(255). */
	truncated: number
}

/** Uma linha da resposta, lida pelo nome da dimensão/métrica da API. Valor fora do formato esperado é erro. */
interface iGa4Row {
	/** Dimensão de texto, cortada no limite da coluna. */
	text: (dimension: string) => string
	/** Dimensão `date` do GA4 (AAAAMMDD) → AAAA-MM-DD. */
	date: (dimension: string) => string
	/** Dimensão `hour` do GA4 ("00".."23") → 0..23. */
	hour: (dimension: string) => number
	/** Métrica inteira (sessões, eventos, usuários). */
	count: (metric: string) => number
	/** Métrica de valor em reais, com 2 casas (colunas decimal(10,2)). */
	money: (metric: string) => number
	/** Métrica sem arredondar (colunas double). */
	number: (metric: string) => number
}

type tCollapse =
	/** Soma as métricas das linhas com a mesma chave (pela collation do MySQL). */
	| { keyColumns: readonly string[]; sumColumns: readonly string[] }
	/** Fica com a primeira linha de cada chave (a resposta já vem ordenada pela relevância). */
	| { keyColumns: readonly string[]; keep: 'first' }

const GA4_DATE = /^(\d{4})(\d{2})(\d{2})$/
const LAST_HOUR = 23
const CENTS = 100
/** Dígitos significativos que um double guarda sem erro. */
const SAFE_DIGITS = 15

const indexOf = (headers: string[]) => new Map(headers.map((name, index) => [name, index]))

const createRowReader = (table: string, report: iReportData, stats: iTransformStats) => {
	const dimensionIndex = indexOf(report.dimensionHeaders)
	const metricIndex = indexOf(report.metricHeaders)

	return (row: iReportData['rows'][number], rowNumber: number): iGa4Row => {
		const fail = (message: string): never => {
			throw new AppError(`${table}: linha ${rowNumber} do GA4 — ${message}`)
		}

		const dimension = (name: string): string => {
			const index = dimensionIndex.get(name)

			if (index === undefined) return fail(`a resposta não tem a dimensão ${name}`)

			return row.dimensions[index] ?? fail(`sem valor para a dimensão ${name}`)
		}

		const metric = (name: string): number => {
			const index = metricIndex.get(name)

			if (index === undefined) return fail(`a resposta não tem a métrica ${name}`)

			const raw = row.metrics[index] ?? fail(`sem valor para a métrica ${name}`)
			const value = Number(raw)

			if (raw.trim() === '' || !Number.isFinite(value)) return fail(`${name}=${raw} não é número`)

			return value
		}

		return {
			text: name => {
				const fitted = fitVarchar(dimension(name))

				if (fitted.truncated) stats.truncated += 1

				return fitted.value
			},
			date: name => {
				const value = dimension(name)
				const match = GA4_DATE.exec(value)

				if (!match) return fail(`${name}=${value} não é uma data AAAAMMDD`)

				return `${match[1]}-${match[2]}-${match[3]}`
			},
			hour: name => {
				const value = dimension(name)
				const hour = Number(value)

				if (!/^\d{1,2}$/.test(value) || hour > LAST_HOUR) return fail(`${name}=${value} não é hora 0–23`)

				return hour
			},
			count: name => Math.round(metric(name)),
			money: name => Math.round((metric(name) + Number.EPSILON) * CENTS) / CENTS,
			number: name => metric(name)
		}
	}
}

const toRows = <TContext>(
	table: string,
	report: iReportData,
	toRow: (row: iGa4Row, context: TContext) => tRow,
	context: TContext,
	stats: iTransformStats
): tRow[] => {
	const read = createRowReader(table, report, stats)

	return report.rows.map((row, index) => toRow(read(row, index), context))
}

/**
 * Junta as linhas que o MySQL veria como a mesma chave (maiúscula/acento). Sem isso, "Google" e "google" no mesmo dia
 * derrubariam a carga inteira por chave primária duplicada. Na soma, os totais do Power BI ficam iguais.
 */
const collapseRows = (rows: tRow[], rule: tCollapse): { rows: tRow[]; merged: number } => {
	const byKey = new Map<string, tRow>()
	let merged = 0

	for (const row of rows) {
		const key = rule.keyColumns.map(column => collationKey(String(row[column]))).join('\u0000')
		const existing = byKey.get(key)

		if (!existing) {
			byKey.set(key, { ...row })
			continue
		}

		merged += 1

		if ('keep' in rule) continue

		// toPrecision(15) tira o ruído da soma em ponto flutuante (159.8 + 79.9 = 239.70000000000002).
		for (const column of rule.sumColumns) {
			existing[column] = Number((Number(existing[column]) + Number(row[column])).toPrecision(SAFE_DIGITS))
		}
	}

	return { rows: [...byKey.values()], merged }
}

export { collapseRows, toRows }
export type { iGa4Row, iTransformStats, tCollapse }
