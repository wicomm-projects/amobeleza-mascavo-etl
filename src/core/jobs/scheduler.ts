import cron, { type ScheduledTask } from 'node-cron'

import { getLogger, type tBrand } from '../../config/index.js'

import { assertTargetJobsKnown, currentAllowance, type iAllowance, runBlockReason } from './allowed.js'
import { allJobs, brandsOf } from './registry.js'
import { runJob } from './runner.js'
import type { iJob } from './types.js'

/**
 * Agendador interno. Só liga com SCHEDULER_ENABLED=true (na VPS, depois da liberação de cada fonte).
 * Horários no fuso de São Paulo. `noOverlap` + o lock do runner evitam duas execuções do mesmo job ao mesmo tempo.
 *
 * Só agenda o que TARGET_DATABASES e TARGET_JOBS liberam (allowed.ts). Na virada só da Mascavo ficam de fora os jobs da
 * Amobeleza; o AnyMarket entra só com TARGET_JOBS (e ANYMARKET_ACCOUNTS=MASCAVO), porque grava em amobeleza_etl.
 */

const TIMEZONE = 'America/Sao_Paulo'

const tasks: ScheduledTask[] = []

interface iPlannedRun {
	job: iJob
	brand: tBrand | undefined
	reason?: string
}

/** Execuções (job × marca) com horário, separadas entre as liberadas e as que ficam de fora (com o motivo). */
const plannedRuns = (
	jobs: readonly iJob[] = allJobs(),
	allowance: iAllowance = currentAllowance()
): { planned: iPlannedRun[]; skipped: iPlannedRun[] } => {
	const planned: iPlannedRun[] = []
	const skipped: iPlannedRun[] = []

	for (const job of jobs) {
		if (!job.schedule) continue

		for (const brand of brandsOf(job)) {
			const reason = runBlockReason(job, brand, allowance)

			if (reason) skipped.push({ job, brand, reason })
			else planned.push({ job, brand })
		}
	}

	return { planned, skipped }
}

const startScheduler = (): number => {
	const logger = getLogger()
	// Item de TARGET_JOBS que não casa com nenhum job tiraria um job do agendador calado: falha na subida.
	assertTargetJobsKnown(currentAllowance().jobs)

	const { planned, skipped } = plannedRuns()

	for (const { job, brand, reason } of skipped) {
		logger.info({ job: job.name, brand, database: job.database(brand), reason }, 'Job não agendado')
	}

	for (const { job, brand } of planned) {
		if (!job.schedule || !cron.validate(job.schedule)) {
			logger.error({ job: job.name, schedule: job.schedule }, 'Expressão cron inválida; job não agendado')
			continue
		}

		const name = brand ? `${job.name}:${brand}` : job.name

		tasks.push(
			cron.schedule(
				job.schedule,
				() => runJob({ job, brand, options: { dryRun: false } }).then(() => undefined),
				{
					timezone: TIMEZONE,
					name,
					noOverlap: true
				}
			)
		)
		logger.info({ job: job.name, brand, schedule: job.schedule }, 'Job agendado')
	}

	return tasks.length
}

const stopScheduler = async (): Promise<void> => {
	await Promise.all(tasks.map(task => task.stop()))
	tasks.length = 0
}

export { plannedRuns, startScheduler, stopScheduler }
export type { iPlannedRun }
