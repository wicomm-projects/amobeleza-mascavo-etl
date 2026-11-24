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

/**
 * Como a chave da tabela na produção compara texto (estrutura real, schema:pull de 24/11/2026):
 * - 'collation': utf8mb4_unicode_ci — sem diferença de maiúscula/acento (índices únicos de trafego e vendas);
 * - 'exact': utf8mb4_bin — "Google" e "google" são chaves diferentes; só o espaço no fim é ignorado (PAD SPACE).
 */
type tKeyMatch = 'collation' | 'exact'

interface iCollapseKey {
	keyColumns: readonly string[]
	/** Padrão: 'collation'. */
	match?: tKeyMatch
	/** Índice com prefixo (ex.: session_source(100)): só os primeiros N caracteres entram na comparação. */
	prefix?: Readonly<Record<string, number>>
}

type tCollapse =
	/** Soma as métricas das linhas com a mesma chave (pela regra da chave na produção). */
	| (iCollapseKey & { sumColumns: readonly string[] })
	/** Fica com a primeira linha de cada chave (a resposta já vem ordenada pela relevância). */
	| (iCollapseKey & { keep: 'first' })

const GA4_DATE = /^(\d{4})(\d{2})(\d{2})$/
const LAST_HOUR = 23
const CENTS = 100
/** Dígitos significativos que um double guarda sem erro. */
const SAFE_DIGITS = 15

const PLAIN_DECIMAL = /^(-?)(\d+)(?:\.(\d*))?$/
const ROUND_UP_DIGIT = '5'

/**
 * Centavos como o MySQL arredonda ao gravar em decimal(10,2): meia unidade para longe do zero, sobre o texto decimal do
 * GA4 — sem o erro de ponto flutuante do Math.round (2.135 → 2,14 e -2.345 → -2,35, como no banco).
 */
const roundCents = (raw: string, value: number): number => {
	const match = PLAIN_DECIMAL.exec(raw.trim())

	// Notação científica (não esperada do GA4): aproximação em ponto flutuante.
	if (!match) return (Math.sign(value) * Math.round(Math.abs(value) * CENTS)) / CENTS

	const [, sign, integer = '0', fraction = ''] = match
	const digits = fraction.padEnd(3, '0')
	const cents = BigInt(`${integer}${digits.slice(0, 2)}`) + (digits.charAt(2) >= ROUND_UP_DIGIT ? 1n : 0n)
	const result = Number(cents) / CENTS

	return sign === '-' && result !== 0 ? -result : result
}

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

		const metric = (name: string): { raw: string; value: number } => {
			const index = metricIndex.get(name)

			if (index === undefined) return fail(`a resposta não tem a métrica ${name}`)

			const raw = row.metrics[index] ?? fail(`sem valor para a métrica ${name}`)
			const value = Number(raw)

			if (raw.trim() === '' || !Number.isFinite(value)) return fail(`${name}=${raw} não é número`)

			return { raw, value }
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
			count: name => Math.round(metric(name).value),
			money: name => {
				const { raw, value } = metric(name)

				return roundCents(raw, value)
			},
			number: name => metric(name).value
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

/** Parte da chave de uma coluna, como o índice da produção enxerga: prefixo, depois a regra de comparação. Nulo é só nulo. */
const keyPart = (value: unknown, rule: iCollapseKey, column: string): string => {
	if (value === null || value === undefined) return '\u0001NULL'

	const limit = rule.prefix?.[column]
	const text = limit === undefined ? String(value) : [...String(value)].slice(0, limit).join('')

	return rule.match === 'exact' ? text.trimEnd() : collationKey(text)
}

/**
 * Junta as linhas que a chave da tabela na produção veria como a mesma (PK ou índice único). Sem isso, a carga inteira
 * cairia por chave duplicada. Na soma, os totais do Power BI ficam iguais.
 */
const collapseRows = (rows: tRow[], rule: tCollapse): { rows: tRow[]; merged: number } => {
	const byKey = new Map<string, tRow>()
	let merged = 0

	for (const row of rows) {
		const key = rule.keyColumns.map(column => keyPart(row[column], rule, column)).join('\u0000')
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
