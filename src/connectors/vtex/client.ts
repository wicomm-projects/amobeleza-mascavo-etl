import type { z } from 'zod'

import { getBrandConfig, getEnv, type tBrand } from '../../config/index.js'
import { AppError, NotConfiguredError, SafetyError } from '../../core/errors.js'
import { createGetClient, type iGetClient, type tQueryParams } from '../../core/http/transport.js'

import {
	categoryTreeSchema,
	type iCategoryNode,
	listOrdersPageSchema,
	orderDetailSchema,
	productAndSkuIdsSchema,
	productSchema,
	type tListOrdersPage,
	type tOrderDetail,
	type tProduct,
	type tProductAndSkuIds
} from './schemas.js'

/**
 * Cliente VTEX de uma marca: só GET (src/core/http/transport.ts), base `https://{account}.{environment}.com.br`, chaves
 * nos headers X-VTEX-API-AppKey / X-VTEX-API-AppToken. Toda resposta passa pelo schema zod antes de seguir.
 *
 * Endpoints (todos de leitura):
 * - GET /api/oms/pvt/orders                                    lista de pedidos (filtro f_creationDate, até 30 páginas)
 * - GET /api/oms/pvt/orders/{orderId}                          detalhe do pedido
 * - GET /api/catalog_system/pvt/products/GetProductAndSkuIds   produto → SKUs (_from/_to, no máximo 250 por chamada)
 * - GET /api/catalog/pvt/product/{productId}                   cadastro do produto
 * - GET /api/catalog_system/pub/category/tree/{levels}         árvore de categorias
 */

interface iVtexApi {
	listOrders: (params: tQueryParams) => Promise<tListOrdersPage>
	getOrder: (orderId: string) => Promise<tOrderDetail>
	getProductAndSkuIds: (from: number, to: number) => Promise<tProductAndSkuIds>
	getProduct: (productId: number) => Promise<tProduct>
	getCategoryTree: (levels: number) => Promise<iCategoryNode[]>
}

/** Conta e ambiente viram parte do host: só letras, números e hífen (barra "conta.outro-host.com/" vindo do .env). */
const HOST_LABEL = /^[a-z0-9][a-z0-9-]{0,62}$/i

/** IDs de pedido da VTEX: "1172452900788-01", "v502556llux-01", "GCB-123-01"... Nada de barra, "?" ou "..". */
const ORDER_ID = /^[A-Za-z0-9_-]+$/

const parseWith = <T>(schema: z.ZodType<T>, data: unknown, what: string): T => {
	const parsed = schema.safeParse(data)

	if (parsed.success) return parsed.data

	const issues = parsed.error.issues
		.slice(0, 5)
		.map(issue => `${issue.path.join('.') || '(raiz)'}: ${issue.message}`)
		.join('; ')

	throw new AppError(`VTEX: resposta inesperada em ${what} (${issues})`)
}

const createVtexHttp = (brand: tBrand): iGetClient => {
	const credentials = getBrandConfig(brand).vtex

	if (!credentials) throw new NotConfiguredError(`VTEX ${brand}: aguardando chave`)

	if (!HOST_LABEL.test(credentials.account) || !HOST_LABEL.test(credentials.environment)) {
		throw new SafetyError(`VTEX ${brand}: conta ou ambiente com caractere inválido para host`)
	}

	const env = getEnv()

	return createGetClient({
		source: `vtex:${brand}`,
		baseURL: `https://${credentials.account}.${credentials.environment}.com.br`,
		headers: {
			'X-VTEX-API-AppKey': credentials.appKey,
			'X-VTEX-API-AppToken': credentials.appToken
		},
		timeoutMs: env.HTTP_TIMEOUT_MS,
		maxAttempts: env.HTTP_MAX_ATTEMPTS
	})
}

const createVtexApi = (http: iGetClient): iVtexApi => ({
	listOrders: async params =>
		parseWith(listOrdersPageSchema, await http.get('/api/oms/pvt/orders', params), 'lista de pedidos'),
	getOrder: async orderId => {
		if (!ORDER_ID.test(orderId)) throw new SafetyError(`VTEX: orderId com caractere inesperado (${orderId})`)

		return parseWith(orderDetailSchema, await http.get(`/api/oms/pvt/orders/${orderId}`), `pedido ${orderId}`)
	},
	getProductAndSkuIds: async (from, to) =>
		parseWith(
			productAndSkuIdsSchema,
			await http.get('/api/catalog_system/pvt/products/GetProductAndSkuIds', { _from: from, _to: to }),
			'produtos e SKUs'
		),
	getProduct: async productId => {
		if (!Number.isInteger(productId) || productId <= 0)
			throw new AppError(`VTEX: productId inválido (${productId})`)

		return parseWith(productSchema, await http.get(`/api/catalog/pvt/product/${productId}`), `produto ${productId}`)
	},
	getCategoryTree: async levels =>
		parseWith(
			categoryTreeSchema,
			await http.get(`/api/catalog_system/pub/category/tree/${levels}`),
			'árvore de categorias'
		)
})

const createBrandApi = (brand: tBrand): iVtexApi => createVtexApi(createVtexHttp(brand))

/** Conta VTEX da marca (vira `hostname` quando a lista não traz). undefined sem chave. */
const accountOf = (brand: tBrand | undefined): string | undefined =>
	brand ? getBrandConfig(brand).vtex?.account : undefined

export { accountOf, createBrandApi, createVtexApi, parseWith }
export type { iVtexApi }
