/**
 * Datas do AnyMarket → instante UTC que cabe na coluna do MySQL.
 *
 * - Só data com fuso explícito (`Z` ou `±hh:mm`). Sem fuso, `Date.parse` usaria o fuso da máquina (São Paulo no
 *   computador do dev, UTC na VPS) e a mesma carga gravaria horas diferentes: data sem fuso conta como ilegível.
 * - Faixa da coluna: o MySQL em modo estrito recusa o INSERT fora dela e derrubaria o lote inteiro. Data "sentinela"
 *   (ex.: 1970-01-01T00:00:00Z, 0001-01-01) quer dizer "sem data".
 */

const HAS_TIMEZONE = /(?:Z|[+-]\d{2}:?\d{2})$/i

/** TIMESTAMP do MySQL: 1970-01-01 00:00:01 a 2038-01-19 03:14:07 (UTC). */
const TIMESTAMP_RANGE = { min: Date.parse('1970-01-01T00:00:01Z'), max: Date.parse('2038-01-19T03:14:07Z') }

/** DATETIME do MySQL: 1000-01-01 a 9999-12-31. */
const DATETIME_RANGE = { min: Date.parse('1000-01-01T00:00:00Z'), max: Date.parse('9999-12-31T23:59:59Z') }

type tDateRange = typeof TIMESTAMP_RANGE

/** Instante em ms, ou null se vazio, sem fuso, ilegível ou fora da faixa. */
const parseApiDate = (value: string | null | undefined, range: tDateRange): number | null => {
	if (!value) return null

	const trimmed = value.trim()

	if (!HAS_TIMEZONE.test(trimmed)) return null

	const time = Date.parse(trimmed)

	if (Number.isNaN(time) || time < range.min || time > range.max) return null

	return time
}

const isValidTimestamp = (value: string): boolean => parseApiDate(value, TIMESTAMP_RANGE) !== null

export { DATETIME_RANGE, TIMESTAMP_RANGE, isValidTimestamp, parseApiDate }
export type { tDateRange }
