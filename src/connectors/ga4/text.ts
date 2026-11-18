/**
 * Texto do GA4 → colunas varchar do contrato.
 */

/** Tamanho das colunas varchar(255) das tabelas sheets_google_drive_*. O MySQL conta caracteres, não bytes. */
const VARCHAR_MAX = 255

/**
 * Chave de comparação como a collation `utf8mb4_unicode_ci` do MySQL enxerga: sem diferença de maiúscula, de acento e
 * de espaço no fim. O GA4 separa "Google" e "google"; numa chave primária do MySQL, as duas linhas colidem.
 */
const collationKey = (value: string): string => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trimEnd()

/** Corta no limite da coluna (por caractere, sem partir emoji). Devolve se cortou, para o resumo contar. */
const fitVarchar = (value: string, max: number = VARCHAR_MAX): { value: string; truncated: boolean } => {
	if (value.length <= max) return { value, truncated: false }

	const characters = [...value]

	if (characters.length <= max) return { value, truncated: false }

	return { value: characters.slice(0, max).join(''), truncated: true }
}

export { VARCHAR_MAX, collationKey, fitVarchar }
