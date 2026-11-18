import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { AppError } from '../../core/errors.js'

import { parseWith } from './client.js'
import {
	categoryTreeSchema,
	listOrdersPageSchema,
	orderDetailSchema,
	productAndSkuIdsSchema,
	productSchema
} from './schemas.js'

/**
 * Fixtures (`--fixture arquivo.json`): respostas de exemplo da documentação pública da VTEX no lugar da chamada real,
 * para provar transformação e gravação no Docker local sem chave. Cada resposta passa pelo mesmo schema da API.
 *
 * - vtex-orders: { account, list: <resposta de List orders>, orders: [<resposta de Get order>, ...] }
 * - vtex-catalog: { productAndSkuIds, products: [<Get product>, ...], categoryTree }
 *
 * Exemplos em src/connectors/vtex/fixtures/. Nunca coloque dado da cliente numa fixture.
 */

const ordersFixtureSchema = z.object({
	/** Conta VTEX do exemplo: vira `hostname` quando a lista não traz (como a conta do .env na carga real). */
	account: z.string().min(1),
	list: listOrdersPageSchema,
	orders: z.array(orderDetailSchema)
})

const catalogFixtureSchema = z.object({
	productAndSkuIds: productAndSkuIdsSchema,
	products: z.array(productSchema),
	categoryTree: categoryTreeSchema
})

type tOrdersFixture = z.infer<typeof ordersFixtureSchema>
type tCatalogFixture = z.infer<typeof catalogFixtureSchema>

const readJson = async (file: string): Promise<unknown> => {
	try {
		return JSON.parse(await readFile(file, 'utf8')) as unknown
	} catch (err) {
		throw new AppError(`Fixture ilegível: ${file}`, { cause: err })
	}
}

const loadOrdersFixture = async (file: string): Promise<tOrdersFixture> =>
	parseWith(ordersFixtureSchema, await readJson(file), `fixture ${file}`)

const loadCatalogFixture = async (file: string): Promise<tCatalogFixture> =>
	parseWith(catalogFixtureSchema, await readJson(file), `fixture ${file}`)

export { loadCatalogFixture, loadOrdersFixture }
export type { tCatalogFixture, tOrdersFixture }
