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
 * Desligar SÓ no PR de liberação da produção (revisado, com autorização por escrito da cliente), junto com a máscara da
 * VTEX (src/connectors/vtex/personal-data.ts). Se ficar ligado por engano, o Power BI mostra "[mascarado]" — falha
 * visível, sem vazamento.
 */
const MASK_PERSONAL_DATA = true

const MASK = '[mascarado]'

/** Colunas pessoais por tabela (dicionário da WPP, "Documentação Amobeleza", seção 2.5). */
const PERSONAL_COLUMNS: Readonly<Partial<Record<string, readonly string[]>>> = {
	[ANYMARKET_TABLES.buyer]: ['name', 'email', 'document'],
	[ANYMARKET_TABLES.shipping]: ['address', 'street', 'number', 'receiver_name']
}

/** Linhas prontas para gravar: as colunas pessoais da tabela viram MASK (nulo continua nulo). */
const maskPersonalData = (table: string, rows: tRow[]): tRow[] => {
	const columns = PERSONAL_COLUMNS[table]

	if (!MASK_PERSONAL_DATA || !columns) return rows

	return rows.map(row => {
		const masked: tRow = { ...row }

		for (const column of columns) {
			if (masked[column] !== null && masked[column] !== undefined) masked[column] = MASK
		}

		return masked
	})
}

export { MASK, PERSONAL_COLUMNS, maskPersonalData }
