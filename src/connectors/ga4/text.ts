/**
 * Texto do GA4 → colunas varchar do contrato.
 */

/** Tamanho das colunas varchar(255) das tabelas sheets_google_drive_*. O MySQL conta caracteres, não bytes. */
const VARCHAR_MAX = 255

/** Letras que o UCA trata como variante de outra, mas que o Unicode não decompõe (o NFKD não resolve). */
const UCA_FOLDS: Readonly<Record<string, string>> = {
	ß: 'ss',
	ø: 'o',
	đ: 'd',
	ð: 'd',
	ł: 'l',
	ı: 'i',
	æ: 'ae',
	œ: 'oe',
	þ: 'th'
}

const UCA_FOLD_PATTERN = new RegExp(`[${Object.keys(UCA_FOLDS).join('')}]`, 'g')

/**
 * Chave de comparação como a collation `utf8mb4_unicode_ci` do MySQL enxerga: sem diferença de maiúscula, de acento, de
 * largura (ＧＯＯＧＬＥ), de caractere invisível (zero-width) e de espaço no fim; todo caractere fora do plano básico
 * (emoji) pesa igual. O GA4 separa "Google" e "google"; numa chave primária do MySQL, as duas linhas colidem.
 *
 * Na dúvida, junta mais do que o MySQL: juntar a mais só soma linhas (os totais ficam iguais); juntar a menos derruba a
 * carga inteira por chave duplicada.
 */
const collationKey = (value: string): string =>
	value
		.normalize('NFKD')
		.replace(/[\p{M}\p{Cf}\p{Cc}]/gu, '')
		.toLowerCase()
		.replace(UCA_FOLD_PATTERN, letter => UCA_FOLDS[letter] ?? letter)
		.replace(/[\u{10000}-\u{10FFFF}]/gu, '�')
		.trimEnd()

/** Corta no limite da coluna (por caractere, sem partir emoji). Devolve se cortou, para o resumo contar. */
const fitVarchar = (value: string, max: number = VARCHAR_MAX): { value: string; truncated: boolean } => {
	if (value.length <= max) return { value, truncated: false }

	const characters = [...value]

	if (characters.length <= max) return { value, truncated: false }

	return { value: characters.slice(0, max).join(''), truncated: true }
}

export { VARCHAR_MAX, collationKey, fitVarchar }
