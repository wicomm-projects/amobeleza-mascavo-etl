import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { tRow } from '../db/index.js'

/**
 * Teste de paridade: compara, coluna a coluna, as linhas que o novo ETL montaria (em memória) com as que o ETL antigo
 * gravou na produção (lidas só com SELECT). Liberar a gravação de uma tabela só quando bater, ou quando cada diferença
 * tiver explicação (ex.: pedido que mudou de status depois).
 *
 * O relatório vai para reports/ (fora do Git): pode conter IDs de pedido. Nenhum valor de coluna pessoal deve ser
 * impresso no terminal — o resumo mostra só contagens e nomes de coluna.
 */

interface iCompareInput {
	table: string
	/** Colunas que identificam a linha (ex.: ['order_id'], ['Date', 'Session_source']). */
	keyColumns: string[]
	/** Linhas da produção (ETL antigo). */
	expected: tRow[]
	/** Linhas montadas pelo novo ETL. */
	actual: tRow[]
	/** Colunas fora da comparação. Padrão: id técnico e carimbos do ETL. */
	ignoreColumns?: string[]
}

interface iColumnDiff {
	key: string
	column: string
	expected: string | null
	actual: string | null
}

interface iCompareResult {
	table: string
	compared: number
	matched: number
	missingInNew: string[]
	extraInNew: string[]
	diffs: iColumnDiff[]
	/** Quantas linhas divergem por coluna — o que mais importa para achar a regra errada. */
	divergentByColumn: Record<string, number>
}

const DEFAULT_IGNORED = ['id', 'created_at', 'updated_at']

/** Normaliza para comparar o que o MySQL devolve (string, Date, Buffer) com o que o ETL monta (number, Date, objeto). */
const normalize = (value: unknown): string | null => {
	if (value === null || value === undefined) return null

	if (value instanceof Date)
		return value
			.toISOString()
			.replace('T', ' ')
			.replace(/\.\d{3}Z$/, '')

	if (typeof value === 'boolean') return value ? '1' : '0'

	if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))

	if (typeof value === 'object') return JSON.stringify(value)

	const text = String(value)

	// "12.50" e "12.5" são o mesmo decimal.
	if (/^-?\d+(\.\d+)?$/.test(text)) return String(Number(text))

	return text
}

const keyOf = (row: tRow, keyColumns: string[]) => keyColumns.map(column => normalize(row[column]) ?? '∅').join('|')

const compareRows = (input: iCompareInput): iCompareResult => {
	const ignored = new Set(input.ignoreColumns ?? DEFAULT_IGNORED)
	const expectedByKey = new Map(input.expected.map(row => [keyOf(row, input.keyColumns), row]))
	const actualByKey = new Map(input.actual.map(row => [keyOf(row, input.keyColumns), row]))
	const diffs: iColumnDiff[] = []
	const divergentByColumn: Record<string, number> = {}
	let matched = 0

	for (const [key, expectedRow] of expectedByKey) {
		const actualRow = actualByKey.get(key)

		if (!actualRow) continue

		let rowMatches = true
		const columns = new Set([...Object.keys(expectedRow), ...Object.keys(actualRow)])

		for (const column of columns) {
			if (ignored.has(column)) continue

			const expected = normalize(expectedRow[column])
			const actual = normalize(actualRow[column])

			if (expected === actual) continue

			rowMatches = false
			diffs.push({ key, column, expected, actual })
			divergentByColumn[column] = (divergentByColumn[column] ?? 0) + 1
		}

		if (rowMatches) matched += 1
	}

	return {
		table: input.table,
		compared: expectedByKey.size,
		matched,
		missingInNew: [...expectedByKey.keys()].filter(key => !actualByKey.has(key)),
		extraInNew: [...actualByKey.keys()].filter(key => !expectedByKey.has(key)),
		diffs,
		divergentByColumn
	}
}

const REPORTS_DIR = 'reports'

/** Grava o relatório completo ({ meta, results }) em reports/paridade-<job>-<data>.json e devolve o caminho. */
const writeParityReport = async (
	job: string,
	results: iCompareResult[],
	meta: Record<string, unknown> = {}
): Promise<string> => {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-')
	const file = path.join(REPORTS_DIR, `paridade-${job}-${stamp}.json`)

	await mkdir(REPORTS_DIR, { recursive: true })
	await writeFile(file, JSON.stringify({ meta, results }, null, '\t'), 'utf8')

	return file
}

export { compareRows, DEFAULT_IGNORED, normalize, writeParityReport }
export type { iColumnDiff, iCompareInput, iCompareResult }
