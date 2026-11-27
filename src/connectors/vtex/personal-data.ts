import { getTargetMode, type tTargetMode } from '../../config/index.js'
import type { tRow } from '../../core/db/index.js'

import { ORDER_TABLES } from './tables.js'

/**
 * Dado pessoal mascarado ao GRAVAR (decisão AMO-Q6, 18/11/2026). Enquanto o destino é o MySQL local (Docker), nome,
 * documento, e-mail e telefone dos clientes não chegam ao banco: viram um texto fixo. As cargas reais com chave rodam
 * só no Docker da VPS, nunca no notebook.
 *
 * A máscara é aplicada só na gravação, não nas transformações: a paridade compara em memória o que o ETL montaria com
 * a produção (só leitura), então continua vendo o dado real e não precisa dele gravado no local.
 *
 * Texto fixo, não hash: CPF tem poucas combinações e um hash seria revertido por força bruta. `vtex_client_profile.id`
 * (userProfileId da VTEX) e `type` (cpf/cnpj) não identificam a pessoa e ficam.
 *
 * Desligada SÓ no modo produção (TARGET_MODE=production, PR de liberação de 27/11/2026): lá o Power BI precisa do dado
 * como o ETL antigo gravava, e o writer só grava depois de conferir o banco da cliente e o wicomm_etl. No modo local
 * continua sempre ligada. Se o modo ficar errado para o lado local, o Power BI mostra "[mascarado]" — falha visível, sem
 * vazamento.
 */
const MASK = '[mascarado]'

/** Colunas pessoais por tabela (dicionário da WPP). Bairro e CEP ficam: o Power BI usa UF e cidade; ver vtex.md. */
const PERSONAL_COLUMNS: Readonly<Partial<Record<string, readonly string[]>>> = {
	[ORDER_TABLES.clientProfile]: ['first_name', 'last_name', 'document', 'home_phone', 'email'],
	[ORDER_TABLES.details]: ['followup_email']
}

/** Linhas prontas para gravar: as colunas pessoais da tabela viram MASK (nulo continua nulo). */
const maskPersonalData = (table: string, rows: tRow[], mode: tTargetMode = getTargetMode()): tRow[] => {
	const columns = PERSONAL_COLUMNS[table]

	if (mode === 'production' || !columns) return rows

	return rows.map(row => {
		const masked: tRow = { ...row }

		for (const column of columns) {
			if (masked[column] !== null && masked[column] !== undefined) masked[column] = MASK
		}

		return masked
	})
}

export { MASK, maskPersonalData, PERSONAL_COLUMNS }
