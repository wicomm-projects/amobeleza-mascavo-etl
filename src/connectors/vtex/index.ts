import { getBrandConfig } from '../../config/index.js'
import type { iJob, iSource } from '../../core/jobs/types.js'

/**
 * VTEX — pedidos, catálogo e clientes das duas lojas (etapa 1 do roadmap).
 *
 * STUB da fase 0: a fonte já sabe se a chave da marca está no .env, mas ainda não tem jobs. A sessão da fase 1 preenche
 * esta pasta (cliente OMS com divisão de janela, transformações por tabela, jobs vtex-orders / vtex-catalog /
 * vtex-clients) sem mexer no núcleo. Ver docs/planos/2026-11-18-estrutura-inicial-fases-0-1-3-6.md.
 */

const jobs: readonly iJob[] = []

const vtexSource: iSource = {
	name: 'vtex',
	label: 'VTEX',
	scope: 'brand',
	phase: 1,
	isConfigured: brand => (brand ? getBrandConfig(brand).vtex !== undefined : false),
	checkAccess: async () => ({ ok: false, detail: 'conector ainda não implementado (fase 1)' }),
	jobs
}

export { vtexSource }
