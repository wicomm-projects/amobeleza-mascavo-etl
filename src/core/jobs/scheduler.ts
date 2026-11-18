import cron, { type ScheduledTask } from 'node-cron'

import { getLogger } from '../../config/index.js'

import { allJobs, brandsOf } from './registry.js'
import { runJob } from './runner.js'

/**
 * Agendador interno. Só liga com SCHEDULER_ENABLED=true (na VPS, depois da liberação de cada fonte).
 * Horários no fuso de São Paulo. `noOverlap` + o lock do runner evitam duas execuções do mesmo job ao mesmo tempo.
 */

const TIMEZONE = 'America/Sao_Paulo'

const tasks: ScheduledTask[] = []

const startScheduler = (): number => {
	const logger = getLogger()

	for (const job of allJobs()) {
		if (!job.schedule) continue

		if (!cron.validate(job.schedule)) {
			logger.error({ job: job.name, schedule: job.schedule }, 'Expressão cron inválida; job não agendado')
			continue
		}

		for (const brand of brandsOf(job)) {
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
	}

	return tasks.length
}

const stopScheduler = async (): Promise<void> => {
	await Promise.all(tasks.map(task => task.stop()))
	tasks.length = 0
}

export { startScheduler, stopScheduler }
