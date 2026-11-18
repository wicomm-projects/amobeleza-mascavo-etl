import type { tBrand } from '../../config/index.js'

/**
 * Última execução de cada job, em memória, para o GET /status. Não grava nada no banco da cliente: o histórico
 * completo fica no log (journald na VPS).
 */

type tRunState = 'running' | 'success' | 'failed' | 'skipped'

interface iRunRecord {
	job: string
	brand?: tBrand
	state: tRunState
	startedAt: string
	finishedAt?: string
	durationMs?: number
	rowsByTable?: Record<string, number>
	/** Mensagem curta, sem segredo nem dado da cliente. */
	message?: string
	dryRun: boolean
}

const lastRuns = new Map<string, iRunRecord>()

const runKey = (job: string, brand?: tBrand) => (brand ? `${job}:${brand}` : job)

const recordRun = (record: iRunRecord) => {
	lastRuns.set(runKey(record.job, record.brand), record)
}

const listRuns = (): iRunRecord[] => [...lastRuns.values()].sort((a, b) => a.job.localeCompare(b.job))

export { listRuns, recordRun, runKey }
export type { iRunRecord, tRunState }
