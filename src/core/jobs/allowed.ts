import { getEnv, type tBrand, type tDatabase } from '../../config/index.js'

import type { iJob } from './types.js'

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

	if (allowance.jobs === undefined) return null

	const allowed =
		allowance.jobs.includes(job.name) || (brand !== undefined && allowance.jobs.includes(`${job.name}:${brand}`))

	return allowed ? null : `job ${brand ? `${job.name}:${brand}` : job.name} fora de TARGET_JOBS`
}

export { currentAllowance, runBlockReason }
export type { iAllowance }
