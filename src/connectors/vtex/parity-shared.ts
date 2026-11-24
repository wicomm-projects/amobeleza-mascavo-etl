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

/** `divergent` = linhas da produção sem igual no novo (inclui as que não têm par). */
const summarize = (results: iCompareResult[]): iParitySummary['tables'] =>
	results.map(result => ({
		table: result.table,
		compared: result.compared,
		divergent: result.compared - result.matched
	}))

/** Notas de linhas que o novo ETL montou e a produção não tem (só contagem). */
const extraNotes = (results: iCompareResult[]): string[] =>
	results
		.filter(result => result.extraInNew.length > 0)
		.map(result => `${result.table}: ${result.extraInNew.length} linha(s) a mais no novo ETL (sem par na produção)`)

/** `db`.`tabela`. O banco vem de `ctx.database` (tipo fechado) e a tabela das constantes de tables.ts. */
const qualified = (database: string, table: string): string => `\`${database}\`.\`${table}\``

export { extraNotes, pickSample, qualified, redactPersonal, summarize }
