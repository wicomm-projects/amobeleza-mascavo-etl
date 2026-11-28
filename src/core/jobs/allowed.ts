import { BRANDS, getEnv, type tBrand, type tDatabase } from '../../config/index.js'
import { SafetyError } from '../errors.js'

import { allJobs } from './registry.js'
import type { iJob } from './types.js'

/** Item de TARGET_JOBS que libera todos os jobs dos bancos liberados, de forma explícita. */
const ALL_JOBS = '*'

/**
 * O que o ETL pode gravar, nas duas camadas do env:
 * - TARGET_DATABASES: bancos liberados;
 * - TARGET_JOBS (opcional): jobs liberados, "job" (todas as marcas) ou "job:marca".
 *
 * O agendador só agenda o que passa aqui, e o runner recusa gravar o que não passa (dry-run continua livre). Exemplo da
 * VPS em 28/11/2026: os dois bancos, mas só os jobs da Mascavo e o anymarket-orders (com ANYMARKET_ACCOUNTS=MASCAVO).
 */

interface iAllowance {
	databases: readonly tDatabase[]
	jobs?: readonly string[] | undefined
}

const currentAllowance = (): iAllowance => {
	const env = getEnv()

	return { databases: env.TARGET_DATABASES, jobs: env.TARGET_JOBS }
}

/** Motivo de o job (com a marca) não poder gravar, ou null quando pode. */
const runBlockReason = (
	job: iJob,
	brand: tBrand | undefined,
	allowance: iAllowance = currentAllowance()
): string | null => {
	const database = job.database(brand)

	if (!allowance.databases.includes(database)) {
		return `banco ${database} fora de TARGET_DATABASES (${allowance.databases.join(', ')})`
	}

	if (allowance.jobs === undefined || allowance.jobs.includes(ALL_JOBS)) return null

	const allowed =
		allowance.jobs.includes(job.name) || (brand !== undefined && allowance.jobs.includes(`${job.name}:${brand}`))

	return allowed ? null : `job ${brand ? `${job.name}:${brand}` : job.name} fora de TARGET_JOBS`
}

/**
 * Confere cada item de TARGET_JOBS contra os jobs que existem: job desconhecido, marca que não existe ou marca num job
 * global (que roda sem marca) nunca casariam e tirariam um job do agendador sem aviso. Lança listando todos.
 */
const assertTargetJobsKnown = (items: readonly string[] | undefined, jobs: readonly iJob[] = allJobs()): void => {
	if (items === undefined) return

	const problems: string[] = []

	for (const item of items) {
		if (item === ALL_JOBS) continue

		const [name, brand] = item.split(':')
		const job = jobs.find(candidate => candidate.name === name)

		if (!job) {
			problems.push(`${item}: o job ${name} não existe`)
			continue
		}

		if (brand === undefined) continue

		if (job.scope === 'global') problems.push(`${item}: ${name} é global (roda sem marca); use só "${name}"`)
		else if (!(BRANDS as readonly string[]).includes(brand)) problems.push(`${item}: a marca ${brand} não existe`)
	}

	if (problems.length > 0) throw new SafetyError(`TARGET_JOBS inválido: ${problems.join('; ')}`)
}

export { assertTargetJobsKnown, currentAllowance, runBlockReason }
export type { iAllowance }
