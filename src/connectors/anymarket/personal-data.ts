import { getTargetMode, type tTargetMode } from '../../config/index.js'
import type { tRow } from '../../core/db/index.js'

import { ANYMARKET_TABLES } from './tables.js'

/**
 * Dado pessoal mascarado ao GRAVAR, como na VTEX (decisão AMO-Q6, estendida ao AnyMarket pelo Matheus em 18/11/2026).
 * Enquanto o destino é o MySQL local (Docker), nome, e-mail e documento do comprador e o endereço de rua e quem recebe
 * a entrega não chegam ao banco: viram um texto fixo. Assim, mesmo uma carga com token rodada sem --dry-run no notebook
 * (contra a regra da AMO-Q4) não grava dado pessoal real.
 *
 * A máscara é aplicada só na gravação, não na transformação: a paridade compara em memória o que o ETL montaria com a
 * produção (só leitura), então continua vendo o dado real e não precisa dele gravado no local.
 *
 * Texto fixo, não hash: CPF tem poucas combinações e um hash seria revertido por força bruta. Cidade, UF, país, bairro e
 * CEP ficam (o Power BI usa região; mesma regra da VTEX). `document_type` (CPF/CNPJ) não identifica a pessoa e fica.
 *
 * Desligada SÓ no modo produção (TARGET_MODE=production), junto com a da VTEX (src/connectors/vtex/personal-data.ts):
 * lá o Power BI precisa do dado como o ETL antigo gravava. No modo local continua sempre ligada. Se o modo ficar errado
 * para o lado local, o Power BI mostra "[mascarado]" — falha visível, sem vazamento.
 */
const MASK = '[mascarado]'

/** Colunas pessoais por tabela (dicionário da WPP, "Documentação Amobeleza", seção 2.5). */
const PERSONAL_COLUMNS: Readonly<Partial<Record<string, readonly string[]>>> = {
	[ANYMARKET_TABLES.buyer]: ['name', 'email', 'document'],
	[ANYMARKET_TABLES.shipping]: ['address', 'street', 'number', 'receiver_name']
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

export { MASK, PERSONAL_COLUMNS, maskPersonalData }
