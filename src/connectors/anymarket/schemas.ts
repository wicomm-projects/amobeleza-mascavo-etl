import { z } from 'zod'

import { isValidTimestamp } from './dates.js'

/**
 * Validação na borda da resposta do AnyMarket (API v2 Backoffice, `GET /orders`). Fonte: especificação pública em
 * https://developers.anymarket.com.br/specs/backoffice.pt-BR.json (schemas Page_Order e Order).
 *
 * Só os campos que alguma tabela usa entram aqui; o resto é descartado pelo zod. O envelope é estrito (sem ele não há
 * como paginar); cada pedido é validado sozinho, para um pedido fora do formato não derrubar a página inteira.
 *
 * Tolerância de propósito:
 * - Enum (status, marketPlace, deliveryStatus) é texto livre: marketplace novo ou status novo não pode parar a carga.
 * - Campos opcionais aceitam null. O exemplo oficial já vem sem `sellerFreight` (marcado como obrigatório) e com
 *   `orderItemId` em texto (o schema diz int64).
 * - Data opcional ilegível vira null na transformação (e entra na contagem das notas); só `createdAt` é obrigatória:
 *   precisa ter fuso e caber no TIMESTAMP do MySQL (dates.ts).
 * - Obrigatórios: só o que identifica e classifica o pedido no painel (id, conta, marketplace, criação, status).
 */

const optionalText = z.string().nullish()
const optionalNumber = z.number().nullish()
const optionalBoolean = z.boolean().nullish()

/** Data com fuso (ISO 8601), como a API devolve, dentro da faixa do TIMESTAMP. */
const requiredDateTime = z.string().refine(isValidTimestamp, { message: 'data sem fuso, ilegível ou fora da faixa' })

/** int64 que às vezes vem em texto (exemplo oficial de `orderItemId`). */
const looseInteger = z.union([z.number(), z.string()]).nullish()

const pageLinkSchema = z.object({
	rel: z.string(),
	href: z.string()
})

const pageMetadataSchema = z.object({
	size: optionalNumber,
	totalElements: optionalNumber,
	totalPages: optionalNumber,
	number: optionalNumber
})

/** Envelope paginado: `{ links, content, page }`. `content` fica cru: cada pedido passa por `orderSchema` sozinho. */
const ordersPageSchema = z.object({
	links: z
		.array(pageLinkSchema)
		.nullish()
		.transform(links => links ?? []),
	content: z
		.array(z.unknown())
		.nullish()
		.transform(content => content ?? []),
	page: pageMetadataSchema.nullish()
})

const invoiceSchema = z.object({
	accessKey: optionalText,
	series: optionalText,
	number: optionalText,
	date: optionalText
})

const shippingAddressSchema = z.object({
	city: optionalText,
	state: optionalText,
	country: optionalText,
	countryAcronymNormalized: optionalText,
	countryNameNormalized: optionalText,
	address: optionalText,
	number: optionalText,
	neighborhood: optionalText,
	street: optionalText,
	zipCode: optionalText,
	receiverName: optionalText,
	promisedShippingTime: optionalText
})

const buyerSchema = z.object({
	name: optionalText,
	email: optionalText,
	document: optionalText,
	documentType: optionalText
})

const paymentSchema = z.object({
	method: optionalText,
	status: optionalText,
	value: optionalNumber,
	marketplaceId: optionalText
})

const simpleProductSchema = z.object({
	id: looseInteger,
	title: optionalText
})

const simpleSkuSchema = z.object({
	id: looseInteger,
	title: optionalText,
	partnerId: optionalText,
	ean: optionalText
})

/**
 * Componente de kit. Não está na especificação pública; o dicionário diz que anymarket_order_items "inclui decomposição
 * de kits" (sku_kit_id, _title, _partner_id, _amount). Formato assumido, a confirmar com o token e a paridade.
 */
const skuKitSchema = z.object({
	id: looseInteger,
	title: optionalText,
	partnerId: optionalText,
	amount: optionalNumber
})

const itemSchema = z.object({
	product: simpleProductSchema.nullish(),
	sku: simpleSkuSchema.nullish(),
	skuKit: skuKitSchema.nullish(),
	amount: optionalNumber,
	unit: optionalNumber,
	gross: optionalNumber,
	total: optionalNumber,
	discount: optionalNumber,
	marketPlaceId: optionalText,
	orderItemId: looseInteger,
	idInMarketPlace: optionalText,
	freeShipping: optionalBoolean
})

const trackingSchema = z.object({
	url: optionalText,
	number: optionalText,
	carrier: optionalText,
	date: optionalText,
	estimateDate: optionalText,
	shippedDate: optionalText,
	deliveredDate: optionalText
})

const orderSchema = z.object({
	id: z.number().int().nonnegative(),
	accountName: z.string(),
	marketPlaceId: optionalText,
	marketPlaceNumber: optionalText,
	marketPlace: z.string(),
	createdAt: requiredDateTime,
	paymentDate: optionalText,
	transmissionStatus: optionalText,
	status: z.string(),
	marketPlaceStatus: optionalText,
	discount: optionalNumber,
	freight: optionalNumber,
	sellerFreight: optionalNumber,
	interestValue: optionalNumber,
	gross: optionalNumber,
	total: optionalNumber,
	deliveryStatus: optionalText,
	idAccount: optionalNumber,
	fulfillment: optionalBoolean,
	orderTypeName: optionalText,
	/** Mapa livre de chaves do marketplace (ex.: needInvoiceXML = "true"). */
	metadata: z.record(z.string(), z.unknown()).nullish(),
	invoice: invoiceSchema.nullish(),
	shipping: shippingAddressSchema.nullish(),
	buyer: buyerSchema.nullish(),
	payments: z
		.array(paymentSchema)
		.nullish()
		.transform(payments => payments ?? []),
	items: z
		.array(itemSchema)
		.nullish()
		.transform(items => items ?? []),
	tracking: trackingSchema.nullish(),
	lastUpdate: optionalText
})

type tOrdersPage = z.infer<typeof ordersPageSchema>
type tAnymarketOrder = z.infer<typeof orderSchema>
type tAnymarketItem = z.infer<typeof itemSchema>

export { orderSchema, ordersPageSchema }
export type { tAnymarketItem, tAnymarketOrder, tOrdersPage }
