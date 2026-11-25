import type { iParitySummary } from '../../core/jobs/types.js'
import type { iCompareResult } from '../../core/parity/compare.js'

import { MASK, PERSONAL_COLUMNS } from './personal-data.js'

/**
 * Peças comuns às paridades da VTEX (pedidos e catálogo). Sem I/O.
 */

/** Amostra determinística, espaçada de modo uniforme, na ordem de entrada. `size >= total` devolve tudo. */
const pickSample = <T>(items: readonly T[], size: number): T[] => {
	if (size <= 0) return []

	if (size >= items.length) return [...items]

	const picked: T[] = []

	for (let index = 0; index < size; index += 1) {
		const item = items[Math.floor((index * items.length) / size)]

		if (item !== undefined) picked.push(item)
	}

	return picked
}

/** Diferença em coluna pessoal sai com `expected` e `actual` mascarados: o relatório não carrega dado de cliente. */
const redactPersonal = (table: string, results: iCompareResult): iCompareResult => {
	const personal = new Set(PERSONAL_COLUMNS[table] ?? [])

	if (personal.size === 0) return results

	return {
		...results,
		diffs: results.diffs.map(diff => (personal.has(diff.column) ? { ...diff, expected: MASK, actual: MASK } : diff))
	}
}

/** Colunas com diferença conhecida e aceita, por tabela (sem o sufixo de grupo), com o motivo. */
type tAcceptedDifferences = Readonly<Partial<Record<string, Readonly<Record<string, string>>>>>

/** Nome da tabela sem o sufixo de grupo (" (mudou depois)"). */
const baseTable = (table: string): string => table.replace(/ \(.*\)$/, '')

/**
 * `divergent` = linhas da produção sem par no novo, mais as que têm diferença em alguma coluna que NÃO está em
 * `accepted`. As diferenças aceitas continuam no relatório (diffs) e entram nas notas (`acceptedNotes`).
 */
const summarize = (results: iCompareResult[], accepted: tAcceptedDifferences = {}): iParitySummary['tables'] =>
	results.map(result => {
		const acceptedColumns = accepted[baseTable(result.table)] ?? {}
		const unexpectedKeys = new Set(
			result.diffs.filter(diff => !(diff.column in acceptedColumns)).map(diff => diff.key)
		)

		return {
			table: result.table,
			compared: result.compared,
			divergent: result.missingInNew.length + unexpectedKeys.size
		}
	})

/** Uma nota por coluna aceita que divergiu: quantas linhas e o motivo. */
const acceptedNotes = (results: iCompareResult[], accepted: tAcceptedDifferences): string[] =>
	results.flatMap(result => {
		const acceptedColumns = accepted[baseTable(result.table)] ?? {}

		return Object.entries(result.divergentByColumn)
			.filter(([column]) => column in acceptedColumns)
			.map(
				([column, rows]) => `aceita: ${result.table}.${column} em ${rows} linha(s) — ${acceptedColumns[column]}`
			)
	})

/** Notas de linhas que o novo ETL montou e a produção não tem (só contagem). */
const extraNotes = (results: iCompareResult[]): string[] =>
	results
		.filter(result => result.extraInNew.length > 0)
		.map(result => `${result.table}: ${result.extraInNew.length} linha(s) a mais no novo ETL (sem par na produção)`)

/** `db`.`tabela`. O banco vem de `ctx.database` (tipo fechado) e a tabela das constantes de tables.ts. */
const qualified = (database: string, table: string): string => `\`${database}\`.\`${table}\``

export { acceptedNotes, extraNotes, pickSample, qualified, redactPersonal, summarize }
export type { tAcceptedDifferences }
