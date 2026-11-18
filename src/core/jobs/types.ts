import type { Logger } from 'pino'

import type { tBrand, tDatabase } from '../../config/index.js'
import type { iRefReader, iWriteResult, iWriter } from '../db/index.js'

/**
 * Contrato entre o núcleo e os conectores (src/connectors/<fonte>/index.ts).
 *
 * Fonte (iSource): uma integração com credencial própria — VTEX (por marca), GA4 (por marca), AnyMarket (global).
 * Job (iJob): uma carga da fonte que grava um conjunto fixo de tabelas (ex.: vtex-orders, vtex-catalog).
 *
 * Sem chave no .env, a fonte responde `isConfigured() === false` e tudo dela aparece como "aguardando chave".
 */

type tSourceName = 'vtex' | 'ga4' | 'anymarket'

/** 'brand': roda uma vez por marca, cada uma no seu banco. 'global': roda uma vez só (AnyMarket). */
type tScope = 'brand' | 'global'

interface iAccessResult {
	ok: boolean
	/** Resumo legível, sem dado da cliente e sem segredo. Ex.: "OK: 1 pedido listado". */
	detail: string
}

interface iRunOptions {
	/** Início da janela (inclusive). Cada job define o padrão (ex.: 45 dias atrás para pedidos). */
	from?: Date
	/** Fim da janela (inclusive). Padrão: agora. */
	to?: Date
	/** Não grava nada: só conta o que seria gravado. */
	dryRun: boolean
	/** Caminho de um JSON de exemplo (documentação pública da API) no lugar da chamada real. Permite testar sem chave. */
	fixture?: string
}

interface iJobContext {
	/** undefined nos jobs globais. */
	brand?: tBrand
	database: tDatabase
	logger: Logger
	writer: iWriter
	options: iRunOptions
}

interface iRunSummary {
	results: iWriteResult[]
	/** Observações para o operador (ex.: "12 fontes sem De/Para"). */
	notes?: string[]
}

interface iParityOptions {
	sample: number
	from?: Date
	to?: Date
}

interface iParityContext {
	brand?: tBrand
	database: tDatabase
	logger: Logger
	refReader: iRefReader
	options: iParityOptions
}

interface iParitySummary {
	reportPath: string
	tables: { table: string; compared: number; divergent: number }[]
}

interface iJob {
	/** Identificador usado no CLI e no agendador. Ex.: "vtex-orders". */
	name: string
	source: tSourceName
	scope: tScope
	description: string
	/** Tabelas que o job grava. O writer recusa qualquer outra; o schema:pull só lê estas. */
	tables: readonly string[]
	/** Banco de destino (por marca, ou fixo no global). */
	database: (brand?: tBrand) => tDatabase
	/** Expressão cron (fuso de São Paulo). Sem ela, o job só roda manualmente. */
	schedule?: string
	run: (ctx: iJobContext) => Promise<iRunSummary>
	/** Paridade com o histórico da produção (só leitura). Opcional até o conector implementar. */
	parity?: (ctx: iParityContext) => Promise<iParitySummary>
}

interface iSource {
	name: tSourceName
	label: string
	scope: tScope
	/** Etapa do roadmap em que o conector é construído. */
	phase: number
	isConfigured: (brand?: tBrand) => boolean
	/** Uma chamada mínima de leitura para provar que a credencial funciona. Não traz dado da cliente. */
	checkAccess: (brand?: tBrand) => Promise<iAccessResult>
	jobs: readonly iJob[]
}

export type {
	iAccessResult,
	iJob,
	iJobContext,
	iParityContext,
	iParityOptions,
	iParitySummary,
	iRunOptions,
	iRunSummary,
	iSource,
	tScope,
	tSourceName
}
