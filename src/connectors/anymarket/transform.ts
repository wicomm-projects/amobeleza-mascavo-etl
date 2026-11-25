import type { tRow } from '../../core/db/index.js'

import { DATETIME_RANGE, TIMESTAMP_RANGE, parseApiDate, type tDateRange } from './dates.js'
import type { tAnymarketItem, tAnymarketOrder } from './schemas.js'
import { ANYMARKET_TABLES, ORDER_KEY_COLUMN } from './tables.js'

/**
 * Pedido do AnyMarket → linhas das 6 tabelas, com as colunas do dicionário da WPP (grafia original, inclusive
 * `invoce_number`). Função pura: sem banco, sem rede, sem log.
 *
 * Convenções (docs/contrato/convencoes.md):
 * - Valores em REAIS, como a API manda. O Power BI usa o valor bruto do AnyMarket sem dividir por 100 (só a VTEX vem em
 *   centavos).
 * - Datas em UTC: só data com fuso explícito, convertida para `Date` (o mysql2 grava com timezone 'Z'). O Power BI
 *   subtrai 3 h.
 * - Status sem tradução.
 * - Coluna NOT NULL sem valor na API: 0 nos valores, '' no texto. A paridade confirma o que o ETL antigo gravava.
 * - Texto maior que a coluna é cortado no tamanho dela: um título longo não pode derrubar o lote inteiro.
 *
 * O MySQL roda em modo estrito: valor fora da faixa da coluna derruba o lote. Por isso:
 * - data opcional sem fuso, ilegível ou fora da faixa (ex.: 1970-01-01T00:00:00Z como "sem data") vira NULL e o campo
 *   vai em `nulledDates`, para a contagem nas notas;
 * - número fora da faixa (decimal(8,2), decimal(10,2), int) vai em `outOfRange` e o job recusa o pedido.
 *
 * `created_at`/`updated_at` ficam com o writer (horário da carga).
 */

const VARCHAR_MAX = 255
const SKU_KIT_PARTNER_ID_MAX = 100

const DECIMAL_8_2_MAX = 999_999.99
const DECIMAL_10_2_MAX = 99_999_999.99
const INT_MAX = 2_147_483_647

/** Faixa (em módulo) das colunas numéricas, pelo tipo do dicionário. As demais são texto, data ou bigint. */
const NUMERIC_LIMITS: Record<string, Record<string, number>> = {
	[ANYMARKET_TABLES.orders]: {
		discount: DECIMAL_8_2_MAX,
		freight: DECIMAL_8_2_MAX,
		seller_freight: DECIMAL_8_2_MAX,
		interest_value: DECIMAL_8_2_MAX,
		gross: DECIMAL_8_2_MAX,
		total: DECIMAL_8_2_MAX,
		id_account: INT_MAX
	},
	[ANYMARKET_TABLES.items]: {
		amount: INT_MAX,
		unit: DECIMAL_10_2_MAX,
		gross: DECIMAL_10_2_MAX,
		discount: DECIMAL_10_2_MAX,
		total: DECIMAL_10_2_MAX,
		sku_kit_amount: INT_MAX,
		order_item_id: INT_MAX
	},
	[ANYMARKET_TABLES.payments]: { value: DECIMAL_10_2_MAX }
}

interface iOrderRows {
	order: tRow
	items: tRow[]
	payments: tRow[]
	shipping: tRow[]
	tracking: tRow[]
	buyer: tRow[]
	/** Campos de data que vieram preenchidos mas foram gravados NULL (sem fuso, ilegível ou fora da faixa). */
	nulledDates: string[]
	/** `tabela.coluna` com número fora da faixa da coluna: o pedido não pode ser gravado. */
	outOfRange: string[]
}

const text = (value: string | number | null | undefined, max: number = VARCHAR_MAX): string | null => {
	if (value === null || value === undefined) return null

	return String(value).slice(0, max)
}

const requiredText = (value: string | null | undefined): string => text(value) ?? ''

const requiredMoney = (value: number | null | undefined): number => value ?? 0

const toInteger = (value: string | number | null | undefined): number | null => {
	if (value === null || value === undefined || value === '') return null

	const parsed = Number(value)

	return Number.isFinite(parsed) ? Math.trunc(parsed) : null
}

const flag = (value: boolean | null | undefined): number | null => {
	if (value === null || value === undefined) return null

	return value ? 1 : 0
}

/** metadata.* vem como texto ("true"/"false") ou booleano, conforme o marketplace. */
const metadataFlag = (value: unknown): number | null => {
	if (typeof value === 'boolean') return value ? 1 : 0

	if (typeof value !== 'string') return null

	const normalized = value.trim().toLowerCase()

	if (normalized === 'true') return 1

	if (normalized === 'false') return 0

	return null
}

const metadataText = (value: unknown): string | null => {
	if (typeof value === 'string' || typeof value === 'number') return text(value)

	return null
}

/**
 * Chaves de `metadata` que viram colunas meta_data_*. Só `needInvoiceXML` aparece na especificação pública; as outras três
 * são o nome da coluna em camelCase — assumidas, a confirmar com o token e a paridade.
 */
/**
 * Chaves em `metadata` do pedido, com a grafia que a API manda (paridade real, 25/11/2026):
 * - `system_origin` (com sublinhado): o ETL antigo gravava, ex.: "Amazon Global Api" nos pedidos da Amazon;
 * - `shippingTypeToSend`: a API manda `ShippingTypeToSend` (S maiúsculo) e o ETL antigo lia esta grafia, então a coluna
 *   ficou sempre vazia (0 de 100 pedidos). Mantido igual ao antigo: nenhum relatório conhecido lê; ver
 *   docs/melhorias-propostas.md.
 */
const METADATA_KEYS = {
	needInvoiceXml: 'needInvoiceXML',
	fiscalDocumentFileType: 'fiscalDocumentFileType',
	systemOrigin: 'system_origin',
	shippingTypeToSend: 'shippingTypeToSend'
} as const

/** Conversor de datas de um pedido: anota em `nulled` o campo que veio preenchido e não pôde ser gravado. */
const dateConverter = (nulled: string[]) => {
	const convert = (field: string, value: string | null | undefined, range: tDateRange): Date | null => {
		const time = parseApiDate(value, range)

		if (time === null && value) nulled.push(field)

		return time === null ? null : new Date(time)
	}

	return {
		timestamp: (field: string, value: string | null | undefined) => convert(field, value, TIMESTAMP_RANGE),
		datetime: (field: string, value: string | null | undefined) => convert(field, value, DATETIME_RANGE)
	}
}

type tDates = ReturnType<typeof dateConverter>

const orderRow = (order: tAnymarketOrder, dates: tDates): tRow => {
	const metadata = order.metadata ?? {}

	return {
		id: order.id,
		account_name: requiredText(order.accountName),
		market_place_id: requiredText(order.marketPlaceId),
		market_place_number: requiredText(order.marketPlaceNumber),
		market_place: requiredText(order.marketPlace),
		// createdAt já foi validada no schema (fuso + faixa do TIMESTAMP).
		order_created_at: dates.timestamp('createdAt', order.createdAt),
		payment_date: dates.timestamp('paymentDate', order.paymentDate),
		transmission_status: requiredText(order.transmissionStatus),
		status: requiredText(order.status),
		invoice_access_key: text(order.invoice?.accessKey),
		invoice_series: text(order.invoice?.series),
		invoce_number: text(order.invoice?.number),
		invoice_date: dates.timestamp('invoice.date', order.invoice?.date),
		market_place_status: requiredText(order.marketPlaceStatus),
		discount: requiredMoney(order.discount),
		freight: requiredMoney(order.freight),
		seller_freight: requiredMoney(order.sellerFreight),
		interest_value: requiredMoney(order.interestValue),
		gross: requiredMoney(order.gross),
		total: requiredMoney(order.total),
		deliver_status: requiredText(order.deliveryStatus),
		id_account: toInteger(order.idAccount) ?? 0,
		fulfillment: order.fulfillment ? 1 : 0,
		meta_data_need_invoice_xml: metadataFlag(metadata[METADATA_KEYS.needInvoiceXml]),
		meta_data_fiscal_document_file_type: metadataText(metadata[METADATA_KEYS.fiscalDocumentFileType]),
		meta_data_system_origin: metadataText(metadata[METADATA_KEYS.systemOrigin]),
		meta_data_shipping_type_to_send: metadataText(metadata[METADATA_KEYS.shippingTypeToSend]),
		order_type_name: text(order.orderTypeName)
	}
}

const itemRow = (orderId: number, item: tAnymarketItem): tRow => ({
	[ORDER_KEY_COLUMN]: orderId,
	product_id: text(item.product?.id),
	product_name: text(item.product?.title),
	sku_id: text(item.sku?.id),
	sku_name: text(item.sku?.title),
	sku_partner_id: text(item.sku?.partnerId),
	sku_partner_ean: text(item.sku?.ean),
	sku_kit_id: toInteger(item.skuKit?.id),
	sku_kit_title: text(item.skuKit?.title),
	sku_kit_partner_id: text(item.skuKit?.partnerId, SKU_KIT_PARTNER_ID_MAX),
	sku_kit_amount: toInteger(item.skuKit?.amount),
	amount: item.amount ?? null,
	unit: item.unit ?? null,
	gross: item.gross ?? null,
	discount: item.discount ?? null,
	total: item.total ?? null,
	id_in_marketplace: text(item.idInMarketPlace),
	marketplace_id: text(item.marketPlaceId),
	order_item_id: toInteger(item.orderItemId),
	free_shipping: flag(item.freeShipping)
})

const paymentRows = (order: tAnymarketOrder): tRow[] =>
	order.payments.map(payment => ({
		[ORDER_KEY_COLUMN]: order.id,
		method: text(payment.method),
		status: text(payment.status),
		value: payment.value ?? null,
		market_place_id: text(payment.marketplaceId)
	}))

/** Uma linha por pedido, quando a API traz o endereço de entrega. */
const shippingRows = (order: tAnymarketOrder, dates: tDates): tRow[] => {
	const shipping = order.shipping

	if (!shipping) return []

	return [
		{
			[ORDER_KEY_COLUMN]: order.id,
			city: text(shipping.city),
			state: text(shipping.state),
			country: text(shipping.country),
			country_acronym_normalized: text(shipping.countryAcronymNormalized),
			country_normalized: text(shipping.countryNameNormalized),
			address: text(shipping.address),
			number: text(shipping.number),
			neighborhood: text(shipping.neighborhood),
			street: text(shipping.street),
			zip_code: text(shipping.zipCode),
			receiver_name: text(shipping.receiverName),
			promised_shipping_time: dates.datetime('shipping.promisedShippingTime', shipping.promisedShippingTime)
		}
	]
}

/** Uma linha por pedido, quando a API traz rastreio. */
const trackingRows = (order: tAnymarketOrder, dates: tDates): tRow[] => {
	const tracking = order.tracking

	if (!tracking) return []

	return [
		{
			[ORDER_KEY_COLUMN]: order.id,
			url: text(tracking.url),
			number: text(tracking.number),
			carrier: text(tracking.carrier),
			date: dates.datetime('tracking.date', tracking.date),
			estimate_date: dates.datetime('tracking.estimateDate', tracking.estimateDate),
			shipped_date: dates.datetime('tracking.shippedDate', tracking.shippedDate),
			delivered_date: dates.datetime('tracking.deliveredDate', tracking.deliveredDate)
		}
	]
}

/** Uma linha por pedido, quando a API traz o comprador. Dado pessoal: nunca vai para log. */
const buyerRows = (order: tAnymarketOrder): tRow[] => {
	const buyer = order.buyer

	if (!buyer) return []

	return [
		{
			[ORDER_KEY_COLUMN]: order.id,
			name: text(buyer.name),
			email: text(buyer.email),
			document: text(buyer.document),
			document_type: text(buyer.documentType)
		}
	]
}

/** `tabela.coluna` de cada número que não cabe na coluna (em módulo). Só nomes, nunca valores. */
const outOfRangeColumns = (table: string, rows: tRow[]): string[] => {
	const limits = NUMERIC_LIMITS[table] ?? {}
	const problems = new Set<string>()

	for (const row of rows) {
		for (const [column, max] of Object.entries(limits)) {
			const value = row[column]

			if (typeof value === 'number' && Math.abs(value) > max) problems.add(`${table}.${column}`)
		}
	}

	return [...problems]
}

const toOrderRows = (order: tAnymarketOrder): iOrderRows => {
	const nulledDates: string[] = []
	const dates = dateConverter(nulledDates)
	const row = orderRow(order, dates)
	const items = order.items.map(item => itemRow(order.id, item))
	const payments = paymentRows(order)

	return {
		order: row,
		items,
		payments,
		shipping: shippingRows(order, dates),
		tracking: trackingRows(order, dates),
		buyer: buyerRows(order),
		nulledDates,
		outOfRange: [
			...outOfRangeColumns(ANYMARKET_TABLES.orders, [row]),
			...outOfRangeColumns(ANYMARKET_TABLES.items, items),
			...outOfRangeColumns(ANYMARKET_TABLES.payments, payments)
		]
	}
}

export { toOrderRows }
export type { iOrderRows }
