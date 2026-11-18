import { getBrandConfig, getEnv } from '../../config/index.js'
import type { iJob, iSource } from '../../core/jobs/types.js'

/**
 * GA4 — relatórios da API de dados do GA4 no formato das antigas tabelas sheets_google_drive_* (etapa 3 do roadmap).
 *
 * STUB da fase 0: a fonte já sabe se a propriedade da marca e a conta de serviço estão no .env, mas ainda não tem jobs.
 * A sessão da fase 3 preenche esta pasta (definições de relatório por tabela, De/Para de canais, job ga4) sem mexer no
 * núcleo. A biblioteca @google-analytics/data já está instalada.
 */

const jobs: readonly iJob[] = []

const ga4Source: iSource = {
	name: 'ga4',
	label: 'Google Analytics 4',
	scope: 'brand',
	phase: 3,
	isConfigured: brand =>
		brand ? getBrandConfig(brand).ga4 !== undefined && Boolean(getEnv().GOOGLE_APPLICATION_CREDENTIALS) : false,
	checkAccess: async () => ({ ok: false, detail: 'conector ainda não implementado (fase 3)' }),
	jobs
}

export { ga4Source }
