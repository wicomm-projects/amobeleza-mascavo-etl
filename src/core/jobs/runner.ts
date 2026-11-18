import { getLogger, type tBrand } from '../../config/index.js'
import { createWriter } from '../db/index.js'
import { AppError } from '../errors.js'

import { withJobLock } from './lock.js'
import { sourceOfJob } from './registry.js'
import { type iRunRecord, recordRun, runKey } from './status.js'
import type { iJob, iRunOptions } from './types.js'

/**
 * Executa um job para uma marca (ou global). Cada execução é isolada: falha na Mascavo não trava a Amobeleza.
 * Fonte sem chave → "skipped" (aguardando chave), não erro. Com --fixture, roda mesmo sem chave (dados de exemplo).
 */

interface iRunRequest {
	job: iJob
	brand?: tBrand
	options: iRunOptions
}

const AWAITING_KEY = 'aguardando chave'

const assertScope = (job: iJob, brand?: tBrand) => {
	if (job.scope === 'brand' && !brand) throw new AppError(`O job ${job.name} roda por marca: informe --brand.`)

	if (job.scope === 'global' && brand) throw new AppError(`O job ${job.name} é global: não use --brand.`)
}

const runJob = async ({ job, brand, options }: iRunRequest): Promise<iRunRecord> => {
	assertScope(job, brand)

	const logger = getLogger().child({ job: job.name, brand })
	const startedAt = new Date()
	const base = { job: job.name, brand, startedAt: startedAt.toISOString(), dryRun: options.dryRun }

	if (!options.fixture && !sourceOfJob(job).isConfigured(brand)) {
		const skipped: iRunRecord = { ...base, state: 'skipped', message: AWAITING_KEY }

		recordRun(skipped)
		logger.info('Carga pulada: fonte aguardando chave')

		return skipped
	}

	recordRun({ ...base, state: 'running' })
	logger.info({ dryRun: options.dryRun, fixture: Boolean(options.fixture) }, 'Carga iniciada')

	const database = job.database(brand)
	const writer = createWriter({ database, tables: job.tables, dryRun: options.dryRun })

	try {
		const summary = await withJobLock(runKey(job.name, brand), !options.dryRun, () =>
			job.run({ brand, database, logger, writer, options })
		)
		const rowsByTable: Record<string, number> = {}

		for (const result of summary.results) {
			rowsByTable[result.table] = (rowsByTable[result.table] ?? 0) + result.inserted
		}

		const finishedAt = new Date()
		const record: iRunRecord = {
			...base,
			state: 'success',
			finishedAt: finishedAt.toISOString(),
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			rowsByTable,
			message: summary.notes?.join(' | ')
		}

		recordRun(record)
		logger.info({ rowsByTable, durationMs: record.durationMs }, 'Carga concluída')

		return record
	} catch (err) {
		const finishedAt = new Date()
		const message = err instanceof Error ? err.message : String(err)
		const record: iRunRecord = {
			...base,
			state: 'failed',
			finishedAt: finishedAt.toISOString(),
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			message
		}

		recordRun(record)
		logger.error({ err }, 'Carga falhou')

		return record
	}
}

export { AWAITING_KEY, runJob }
export type { iRunRequest }
