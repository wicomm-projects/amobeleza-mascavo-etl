import cron, { type ScheduledTask } from 'node-cron'

import { getEnv, getLogger, type tBrand, type tDatabase } from '../../config/index.js'

import { allJobs, brandsOf } from './registry.js'
import { runJob } from './runner.js'
import type { iJob } from './types.js'

/**
 * Agendador interno. Só liga com SCHEDULER_ENABLED=true (na VPS, depois da liberação de cada fonte).
 * Horários no fuso de São Paulo. `noOverlap` + o lock do runner evitam duas execuções do mesmo job ao mesmo tempo.
 *
 * Só agenda os jobs que gravam num banco de TARGET_DATABASES. Na virada só da Mascavo (TARGET_DATABASES=mascavo_etl),
 * ficam de fora os jobs da Amobeleza e o AnyMarket, que grava em amobeleza_etl.
 */

const TIMEZONE = 'America/Sao_Paulo'

const tasks: ScheduledTask[] = []

interface iPlannedRun {
	job: iJob
	brand: tBrand | undefined
}

/** Execuções (job × marca) com horário, separadas entre as que o banco liberado permite e as que ficam de fora. */
const plannedRuns = (
	jobs: readonly iJob[] = allJobs(),
	allowed: readonly tDatabase[] = getEnv().TARGET_DATABASES
): { planned: iPlannedRun[]; skipped: iPlannedRun[] } => {
	const planned: iPlannedRun[] = []
	const skipped: iPlannedRun[] = []

	for (const job of jobs) {
		if (!job.schedule) continue

		for (const brand of brandsOf(job)) {
			const target = allowed.includes(job.database(brand)) ? planned : skipped

			target.push({ job, brand })
		}
	}

	return { planned, skipped }
}

const startScheduler = (): number => {
	const logger = getLogger()
	const { planned, skipped } = plannedRuns()

	for (const { job, brand } of skipped) {
		logger.info(
			{ job: job.name, brand, database: job.database(brand) },
			'Job não agendado: banco fora de TARGET_DATABASES'
		)
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
