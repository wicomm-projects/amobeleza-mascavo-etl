import { getBrandConfig, getEnv, type tBrand } from '../../config/index.js'
import type { iAccessResult, iJob, iSource } from '../../core/jobs/types.js'

import { checkProperty } from './api.js'
import { ga4Job, requestOf } from './job.js'
import { ga4Parity } from './parity.js'
import { reportsOf } from './reports.js'

/**
 * GA4 — relatórios da API de dados do GA4 no formato das antigas tabelas sheets_google_drive_* (etapa 3 do roadmap).
 * Antes o GA chegava pelo Supermetrics em planilhas; agora o ETL chama `runReport` com a conta de serviço
 * (GOOGLE_APPLICATION_CREDENTIALS, papel Leitor na propriedade) e grava direto nas mesmas tabelas. Detalhes, mapa de
 * colunas e pendências: docs/conectores/ga4.md.
 */

const jobs: readonly iJob[] = [{ ...ga4Job, parity: ga4Parity }]

const checkAccess = async (brand?: tBrand): Promise<iAccessResult> => {
	if (!brand) return { ok: false, detail: 'o GA4 roda por marca: informe --brand' }

	const ga4 = getBrandConfig(brand).ga4

	if (!ga4) return { ok: false, detail: 'sem ID de propriedade no .env' }

	const reports = reportsOf(brand).map(definition => ({ table: definition.table, request: requestOf(definition) }))
	const check = await checkProperty(ga4.propertyId, reports)
	const problems = [
		check.missing.length > 0 ? `a propriedade não tem: ${check.missing.join(', ')}` : '',
		...check.incompatible.map(entry => `incompatível em ${entry}`)
	].filter(Boolean)

	if (problems.length > 0) return { ok: false, detail: problems.join(' | ') }

	return {
		ok: true,
		detail: `metadata lida (${check.dimensions} dimensões, ${check.metrics} métricas); ${reports.length} relatórios compatíveis`
	}
}

const ga4Source: iSource = {
	name: 'ga4',
	label: 'Google Analytics 4',
	scope: 'brand',
	phase: 3,
	isConfigured: brand =>
		brand ? getBrandConfig(brand).ga4 !== undefined && Boolean(getEnv().GOOGLE_APPLICATION_CREDENTIALS) : false,
	checkAccess,
	jobs
}

export { ga4Source }
