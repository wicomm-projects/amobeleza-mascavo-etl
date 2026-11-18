import { BRANDS, type tBrand } from '../config/index.js'

import { isRefConfigured } from './db/pools.js'
import { SOURCES } from './jobs/registry.js'
import type { iSource } from './jobs/types.js'

/** Visão "o que está pronto e o que espera chave", usada pelo CLI `sources` e pelo GET /health. Sem segredos. */

interface iSourceStatus {
	source: string
	label: string
	brand?: tBrand
	phase: number
	configured: boolean
	jobs: string[]
}

const brandsOfSource = (source: iSource): (tBrand | undefined)[] =>
	source.scope === 'brand' ? [...BRANDS] : [undefined]

const listSourceStatus = (): iSourceStatus[] =>
	SOURCES.flatMap(source =>
		brandsOfSource(source).map(brand => ({
			source: source.name,
			label: source.label,
			brand,
			phase: source.phase,
			configured: source.isConfigured(brand),
			jobs: source.jobs.map(job => job.name)
		}))
	)

const referenceDbStatus = () => ({ configured: isRefConfigured() })

export { brandsOfSource, listSourceStatus, referenceDbStatus }
export type { iSourceStatus }
