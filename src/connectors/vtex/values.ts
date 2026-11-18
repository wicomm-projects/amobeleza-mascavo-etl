import { AppError } from '../../core/errors.js'

/**
 * Conversões puras do formato da VTEX para o formato das colunas antigas (docs/contrato/convencoes.md).
 *
 * - Datas: a VTEX manda ISO 8601 com 0 a 7 casas decimais e fuso ("2024-02-06T20:46:11.7010747+00:00"). As colunas são
 *   DATETIME sem fração: convertemos para UTC e cortamos os milissegundos (o mysql2 grava em UTC, `timezone: 'Z'`).
 * - Valores em dinheiro: ficam em centavos, como a VTEX manda (o Power BI divide por 100).
 * - Booleano → 1/0 (tinyint).
 * - JSON → texto JSON (o mysql2 transformaria objeto em "chave = valor").
 */

const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/

const MS_PER_MINUTE = 60_000
const MIN_YEAR = 1000

/** Colunas varchar(255) do dicionário. */
const VARCHAR_DEFAULT_LENGTH = 255

const offsetMinutes = (zone: string | undefined): number => {
	if (!zone || zone === 'Z') return 0

	const sign = zone.startsWith('-') ? -1 : 1
	const digits = zone.slice(1).replace(':', '')
	const hours = Number(digits.slice(0, 2))
	const minutes = Number(digits.slice(2, 4))

	return sign * (hours * 60 + minutes)
}

/** ISO 8601 da VTEX → Date em UTC, sem milissegundos. Sem fuso, a data é tratada como UTC. Lança se for ilegível. */
const toUtcDate = (value: string | null | undefined): Date | null => {
	if (value === null || value === undefined || value.trim() === '') return null

	const match = ISO_DATE_TIME.exec(value.trim())

	if (!match) throw new AppError(`Data em formato inesperado: ${value}`)

	const [, year, month, day, hour, minute, second, zone] = match

	// Date.UTC soma 1900 a ano entre 0 e 99: "0001-01-01" viraria 1901 em silêncio.
	if (Number(year) < MIN_YEAR) throw new AppError(`Data fora do intervalo esperado: ${value}`)

	const utcMs =
		Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) -
		offsetMinutes(zone) * MS_PER_MINUTE
	const date = new Date(utcMs)

	if (Number.isNaN(date.getTime())) throw new AppError(`Data inválida: ${value}`)

	return date
}

/**
 * Mesma data em texto UTC "AAAA-MM-DD HH:MM:SS" — para comparar o lastChange da API com o gravado. Aceita Date (mysql2),
 * ISO da VTEX ou o texto do MySQL ("AAAA-MM-DD HH:MM:SS", lido como UTC).
 */
const toComparableUtc = (value: Date | string | null | undefined): string | null => {
	if (value === null || value === undefined) return null

	const date = value instanceof Date ? value : toUtcDate(value.trim().replace(' ', 'T'))

	if (!date) return null

	return date.toISOString().slice(0, 19).replace('T', ' ')
}

const flag = (value: boolean | null | undefined): 0 | 1 | null => {
	if (value === null || value === undefined) return null

	return value ? 1 : 0
}

/** Inteiro vindo como número ou texto ("18", "1"). Lança se não for inteiro: a coluna é int. */
const toInt = (value: number | string | null | undefined, field: string): number | null => {
	if (value === null || value === undefined || value === '') return null

	const parsed = typeof value === 'number' ? value : Number(value.trim())

	if (!Number.isInteger(parsed)) throw new AppError(`${field}: "${value}" não é inteiro (a coluna é int).`)

	return parsed
}

/**
 * Valor de coluna NOT NULL. Vazio lança: a transformação tira só aquele pedido/produto da carga, em vez de o MySQL
 * recusar o INSERT e derrubar a transação inteira (e de novo a cada carga, enquanto o registro estiver na janela).
 */
const required = <T>(value: T | null | undefined, label: string): T => {
	if (value === null || value === undefined) throw new AppError(`${label}: veio vazio, mas a coluna é NOT NULL`)

	return value
}

const toJson = (value: unknown): string | null => (value === null || value === undefined ? null : JSON.stringify(value))

/**
 * Texto para coluna varchar(N). Número e booleano viram texto ("1"/"0" para booleano). Acima de N caracteres é cortado:
 * o MySQL em modo estrito recusaria a linha e derrubaria a carga inteira. Confirmar no schema:pull se a produção é TEXT.
 */
const toText = (value: unknown, maxLength: number = VARCHAR_DEFAULT_LENGTH): string | null => {
	if (value === null || value === undefined) return null

	if (typeof value === 'boolean') return value ? '1' : '0'

	const text = typeof value === 'object' ? JSON.stringify(value) : String(value)

	return text.length > maxLength ? text.slice(0, maxLength) : text
}

export { flag, required, toComparableUtc, toInt, toJson, toText, toUtcDate, VARCHAR_DEFAULT_LENGTH }
