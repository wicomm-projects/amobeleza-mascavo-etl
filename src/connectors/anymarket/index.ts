import { getEnv } from '../../config/index.js'
import type { iJob, iSource } from '../../core/jobs/types.js'

/**
 * AnyMarket — pedidos de marketplace de TODAS as contas (inclui MASCAVO), gravados em amobeleza_etl.anymarket_*
 * (etapa 6 do roadmap). Fonte global: roda uma vez, não por marca.
 *
 * STUB da fase 0: a fonte já sabe se o token está no .env, mas ainda não tem jobs. A sessão da fase 6 preenche esta pasta
 * (cliente v2 com gumgaToken e paginação por offset, transformações das 6 tabelas, job anymarket-orders) sem mexer no
 * núcleo.
 */

const jobs: readonly iJob[] = []

const anymarketSource: iSource = {
	name: 'anymarket',
	label: 'AnyMarket',
	scope: 'global',
	phase: 6,
	isConfigured: () => Boolean(getEnv().ANYMARKET_TOKEN),
	checkAccess: async () => ({ ok: false, detail: 'conector ainda não implementado (fase 6)' }),
	jobs
}

export { anymarketSource }
