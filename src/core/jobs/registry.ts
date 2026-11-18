import { BRANDS, type tBrand, type tDatabase } from '../../config/index.js'
import { anymarketSource } from '../../connectors/anymarket/index.js'
import { ga4Source } from '../../connectors/ga4/index.js'
import { vtexSource } from '../../connectors/vtex/index.js'

import type { iJob, iSource } from './types.js'

/**
 * Registro das fontes. Cada conector vive em src/connectors/<fonte>/ e exporta um iSource; as sessões das fases 1, 3 e 6
 * só mexem dentro da própria pasta.
 */
const SOURCES: readonly iSource[] = [vtexSource, ga4Source, anymarketSource]

const allJobs = (): iJob[] => SOURCES.flatMap(source => [...source.jobs])

const findJob = (name: string): iJob | undefined => allJobs().find(job => job.name === name)

const findSource = (name: string): iSource | undefined => SOURCES.find(source => source.name === name)

const sourceOfJob = (job: iJob): iSource => {
	const source = findSource(job.source)

	if (!source) throw new Error(`Job ${job.name} aponta para a fonte inexistente ${job.source}`)

	return source
}

/** Marcas em que um job roda: todas, se for por marca; nenhuma (undefined), se for global. */
const brandsOf = (job: iJob): (tBrand | undefined)[] => (job.scope === 'brand' ? [...BRANDS] : [undefined])

/** Tabelas que algum job grava, por banco. É a lista que o schema:pull pode ler na produção. */
const tablesByDatabase = (): Map<tDatabase, Set<string>> => {
	const map = new Map<tDatabase, Set<string>>()

	for (const job of allJobs()) {
		for (const brand of brandsOf(job)) {
			const database = job.database(brand)
			const tables = map.get(database) ?? new Set<string>()

			job.tables.forEach(table => tables.add(table))
			map.set(database, tables)
		}
	}

	return map
}

export { SOURCES, allJobs, brandsOf, findJob, findSource, sourceOfJob, tablesByDatabase }
