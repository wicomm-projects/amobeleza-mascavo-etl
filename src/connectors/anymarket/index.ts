import { getEnv } from '../../config/index.js'
import type { iJob, iSource } from '../../core/jobs/types.js'

import { checkOrdersAccess } from './client.js'
import { anymarketOrdersJob } from './orders-job.js'

/**
 * AnyMarket — pedidos de marketplace de TODAS as contas (inclui MASCAVO), gravados em amobeleza_etl.anymarket_*
 * (etapa 6 do roadmap). Fonte global: roda uma vez, não por marca. Ver docs/conectores/anymarket.md.
 */

const jobs: readonly iJob[] = [anymarketOrdersJob]

const anymarketSource: iSource = {
	name: 'anymarket',
	label: 'AnyMarket',
	scope: 'global',
	phase: 6,
	isConfigured: () => Boolean(getEnv().ANYMARKET_TOKEN),
	checkAccess: () => checkOrdersAccess(),
	jobs
}

export { anymarketSource }
