import type { tRow } from '../../core/db/index.js'

import type { tListOrder, tOrderDetail } from './schemas.js'
import { ORDER_TABLES, type tOrderChildTable } from './tables.js'
import { flag, required, toInt, toJson, toReais, toText, toUtcDate } from './values.js'

/**
 * Transformações puras: resposta da VTEX → linhas das tabelas antigas, com a grafia exata do dicionário
 * (docs/contrato/mascavo_etl.md). Sem I/O, sem relógio: a mesma entrada dá sempre a mesma saída.
 *
 * Convenções (docs/contrato/convencoes.md): dinheiro em centavos só em `vtex_orders.total_value` e em reais nas colunas
 * decimal das outras tabelas (`toReais`, como o ETL antigo); colunas int de valor ficam como a VTEX manda; datas em UTC
 * sem fração; status em inglês e descrição em português, sem traduzir; booleano em 1/0. Valor ausente fica nulo. Em
 * coluna NOT NULL, valor
 * ausente lança (`required`): só aquele pedido fica fora da carga, em vez de o MySQL derrubar a transação inteira. A
 * exceção são 8 colunas NOT NULL em que o ETL antigo gravava um substituto (OLD_ETL_FALLBACK), medido na produção.
 *
 * Toda linha de uma tabela sai com as mesmas colunas (o writer exige).
 */

const TOTAL_IDS = { items: 'Items', discounts: 'Discounts', shipping: 'Shipping', taxes: 'Tax' } as const

const SALES_CHANNEL_LENGTH = 3
const TYPE_LENGTH = 10

/** Rótulo de erro "pedido coluna", para `required` (só ID e nome de coluna, nunca valor). */
const columnOf = (orderId: string) => (column: string) => `${orderId} ${column}`

/**
 * vtex_orders — uma linha por pedido da LISTA do OMS. `hostnameFallback`: conta VTEX, quando a lista não traz.
 * Coluna NOT NULL sem valor lança (`required`): o pedido fica fora desta carga e a linha antiga continua.
 */
const toOrderRow = (order: tListOrder, hostnameFallback: string | null): tRow => {
	const column = columnOf(order.orderId)

	return {
		order_id: order.orderId,
		order_date: required(toUtcDate(order.creationDate), column('order_date')),
		total_value: order.totalValue,
		status: order.status ?? null,
		status_description: required(order.statusDescription, column('status_description')),
		market_place_order_id: order.marketPlaceOrderId ?? null,
		sequence: required(order.sequence, column('sequence')),
		sales_channel: required(order.salesChannel, column('sales_channel')),
		affiliate_id: order.affiliateId ?? null,
		origin: required(order.origin, column('origin')),
		workflow_in_error_state: required(flag(order.workflowInErrorState), column('workflow_in_error_state')),
		workflow_in_retry: required(flag(order.workflowInRetry), column('workflow_in_retry')),
		shipping_estimated_date: toUtcDate(order.ShippingEstimatedDate),
		shipping_estimated_date_max: toUtcDate(order.ShippingEstimatedDateMax),
		shipping_estimated_date_min: toUtcDate(order.ShippingEstimatedDateMin),
		order_is_complete: required(flag(order.orderIsComplete), column('order_is_complete')),
		authorized_date: toUtcDate(order.authorizedDate),
		total_items: required(order.totalItems, column('total_items')),
		currency_code: required(order.currencyCode, column('currency_code')),
		hostname: required(order.hostname ?? hostnameFallback, column('hostname')),
		last_change: toUtcDate(order.lastChange),
		is_all_delivered: flag(order.isAllDelivered),
		is_any_delivered: flag(order.isAnyDelivered),
		ready_for_handling_date: toUtcDate(order.readyForHandlingDate)
	}
}

/** Seller "1" é a própria loja na VTEX. */
const MAIN_SELLER_ID = '1'

/**
 * `seller_name` (só amobeleza_etl.vtex_orders): nome do seller do pedido, inclusive da própria loja. Medido na paridade
 * (só leitura, 24/11/2026): o ETL antigo gravou "Amobeleza" em 45 de 45 pedidos da loja, não nulo. Na VTEX cada pedido
 * (depois do split) tem um seller só; se vier mais de um, vale o primeiro terceiro, senão a própria loja.
 */
const sellerNameOf = (detail: tOrderDetail): string | null => {
	const sellers = detail.sellers ?? []
	const seller = sellers.find(candidate => String(candidate.id) !== MAIN_SELLER_ID) ?? sellers[0]

	return seller ? toText(seller.name) : null
}

const totalOf = (detail: tOrderDetail, id: string): number => detail.totals?.find(total => total.id === id)?.value ?? 0

/** openTextField vem como { value: "..." } ou texto, ou nulo. */
const openText = (value: unknown): string | null => {
	if (value === null || value === undefined) return null

	if (typeof value === 'object' && 'value' in value) return toText((value as { value: unknown }).value)

	return toText(value)
}

/**
 * O que o ETL antigo gravava nas colunas NOT NULL quando a VTEX não mandava valor. Medido na produção (só leitura,
 * AMO-Q15, 24/11/2026) em pedidos cancelados, aguardando pagamento e em preparação das duas lojas; servidor em modo
 * estrito (vazio numa coluna NOT NULL é erro). Nenhum painel do Power BI lê essas colunas.
 */
const OLD_ETL_FALLBACK = {
	/** lockid: sempre "00-" + número do pedido. */
	lockId: (orderId: string) => `00-${orderId}`,
	/** refid sem referência no SKU. */
	refId: '-',
	/** taxcode sem código fiscal. */
	taxCode: '',
	/** costprice: preenchido em todas as amostras da produção (em reais); 0 só se a VTEX não mandar. *Assumido.* */
	costPrice: 0,
	/** Endpoint de serviços do marketplace: o padrão do OMS com a conta. */
	marketplaceServicesEndpoint: (account: string) => `http://oms.vtexinternal.com.br/api/oms?an=${account}`,
	/**
	 * payment_id de pedido de marketplace (ex.: Panvel, "PVL-"): a VTEX manda o pagamento sem id e o ETL antigo gravou
	 * "0" (paridade, 24/11/2026). Sem o substituto, o pedido inteiro ficava fora da carga.
	 */
	paymentId: '0'
} as const

/**
 * Contexto da carga para os substitutos do ETL antigo. Mantém a transformação pura (sem relógio): quem chama informa.
 * - `account`: conta VTEX (o `an=` do endpoint), quando o detalhe não traz `hostname`.
 * - `processedAtLocal`: o "agora" da carga no relógio de São Paulo. O ETL antigo (Laravel, fuso de SP, servidor MySQL
 *   em UTC) gravava esse horário em `authorizeddate`/`invoiceddate` quando a VTEX não mandava a data — é igual ao
 *   `created_at` da linha na produção. Não é data de negócio: a paridade ignora essas duas colunas quando a VTEX vem
 *   sem data.
 */
interface iDetailContext {
	account: string
	processedAtLocal: Date
}

/** vtex_order_details — PK order_id, 1:1 com vtex_orders. */
const toDetailRow = (detail: tOrderDetail, context: iDetailContext): tRow => {
	const column = columnOf(detail.orderId)

	return {
		order_id: detail.orderId,
		sequence: detail.sequence,
		client_profile_id: detail.clientProfileData?.userProfileId ?? null,
		marketplace_order_id: detail.marketplaceOrderId ?? null,
		marketplace_services_endpoint:
			toText(detail.marketplaceServicesEndpoint) ??
			OLD_ETL_FALLBACK.marketplaceServicesEndpoint(detail.hostname ?? context.account),
		seller_order_id: detail.sellerOrderId ?? null,
		origin: detail.origin,
		affiliate_id: detail.affiliateId ?? null,
		sales_channel: toText(detail.salesChannel, SALES_CHANNEL_LENGTH),
		merchant_name: detail.merchantName ?? null,
		status: detail.status,
		status_description: required(detail.statusDescription, column('status_description')),
		value: toReais(detail.value),
		creation_date: required(toUtcDate(detail.creationDate), column('creation_date')),
		last_change: required(toUtcDate(detail.lastChange), column('last_change')),
		// Pedido de marketplace (ex.: PVL-, PGM-) vem sem orderGroup: nulo, como o ETL antigo; o Power BI faz
		// IFNULL(order_group, order_id).
		order_group: detail.orderGroup ?? null,
		totals_items: toReais(totalOf(detail, TOTAL_IDS.items)),
		totals_discounts: toReais(totalOf(detail, TOTAL_IDS.discounts)),
		totals_shipping: toReais(totalOf(detail, TOTAL_IDS.shipping)),
		totals_taxes: toReais(totalOf(detail, TOTAL_IDS.taxes)),
		followup_email: required(detail.followUpEmail, column('followup_email')),
		hostname: detail.hostname,
		opentextfield: openText(detail.openTextField),
		roundingerror: required(detail.roundingError, column('roundingerror')),
		orderformid: detail.orderFormId ?? null,
		commercialconditiondata: toJson(detail.commercialConditionData),
		iscompleted: flag(detail.isCompleted),
		allowcancellation: flag(detail.allowCancellation),
		allowedition: flag(detail.allowEdition),
		ischeckedin: flag(detail.isCheckedIn),
		utm_source: detail.marketingData?.utmSource ?? null,
		coupon: detail.marketingData?.coupon ?? null,
		authorizeddate: toUtcDate(detail.authorizedDate) ?? context.processedAtLocal,
		invoiceddate: toUtcDate(detail.invoicedDate) ?? context.processedAtLocal
	}
}

const toItemRows = (detail: tOrderDetail): tRow[] =>
	(detail.items ?? []).map((item, index) => {
		const field = (name: string) => `${detail.orderId} item ${index} ${name}`

		return {
			order_id: detail.orderId,
			uniqueid: item.uniqueId,
			id: required(toInt(item.id, field('id')), field('id')),
			productid: required(toInt(item.productId, field('productid')), field('productid')),
			ean: item.ean ?? null,
			lockid: item.lockId ?? OLD_ETL_FALLBACK.lockId(detail.orderId),
			quantity: item.quantity,
			seller: required(toInt(item.seller, field('seller')), field('seller')),
			name: toText(item.name),
			refid: item.refId ?? OLD_ETL_FALLBACK.refId,
			price: toReais(item.price),
			listprice: toReais(item.listPrice),
			manualprice: item.manualPrice ?? null,
			imageurl: toText(item.imageUrl),
			detailurl: toText(item.detailUrl),
			sellersku: required(item.sellerSku, field('sellersku')),
			commission: required(item.commission, field('commission')),
			tax: required(item.tax, field('tax')),
			presaledate: toUtcDate(item.preSaleDate),
			additionalinfo: JSON.stringify(item.additionalInfo ?? null),
			measurementunit: required(item.measurementUnit, field('measurementunit')),
			unitmultiplier: required(item.unitMultiplier, field('unitmultiplier')),
			sellingprice: toReais(required(item.sellingPrice, field('sellingprice'))),
			isgift: required(flag(item.isGift), field('isgift')),
			shippingprice: toReais(item.shippingPrice),
			rewardvalue: required(item.rewardValue, field('rewardvalue')),
			freightcommission: required(item.freightCommission, field('freightcommission')),
			taxcode: item.taxCode ?? OLD_ETL_FALLBACK.taxCode,
			costprice: toReais(item.costPrice ?? OLD_ETL_FALLBACK.costPrice)
		}
	})

const logisticsOf = (detail: tOrderDetail) => detail.shippingData?.logisticsInfo ?? []

/** sku_id: itemId da logística; sem ele, o SKU do item na mesma posição (itemIndex liga logística e item). */
const toLogisticsInfoRows = (detail: tOrderDetail): tRow[] =>
	logisticsOf(detail).map(info => ({
		order_id: detail.orderId,
		sku_id: toInt(
			info.itemId ?? detail.items?.[info.itemIndex]?.id,
			`${detail.orderId} logisticsInfo ${info.itemIndex} itemId`
		),
		item_index: info.itemIndex,
		selected_sla: info.selectedSla ?? null,
		lock_ttl: info.lockTTL ?? null,
		price: toReais(info.price),
		list_price: toReais(info.listPrice),
		selling_price: toReais(info.sellingPrice),
		delivery_window: toText(info.deliveryWindow),
		delivery_company: info.deliveryCompany ?? null,
		delivery_channel: info.deliveryChannel ?? null,
		address_id: info.addressId ?? null
	}))

const toDeliveryIdRows = (detail: tOrderDetail): tRow[] =>
	logisticsOf(detail).flatMap(info =>
		(info.deliveryIds ?? []).map(delivery => ({
			order_id: detail.orderId,
			item_index: info.itemIndex,
			courier_id: delivery.courierId ?? null,
			courier_name: delivery.courierName ?? null,
			dock_id: delivery.dockId ?? null,
			quantity: delivery.quantity ?? null,
			warehouse_id: delivery.warehouseId ?? null,
			account_carrier_name: delivery.accountCarrierName ?? null
		}))
	)

/** Endereço principal (shippingData.address). Só cidade, bairro, CEP e UF — a tabela não tem rua nem destinatário. */
const toShippingDataRows = (detail: tOrderDetail): tRow[] => {
	const address = detail.shippingData?.address

	if (!address) return []

	return [
		{
			order_id: detail.orderId,
			address_id: address.addressId,
			address_type: address.addressType ?? null,
			neighborhood: address.neighborhood ?? null,
			postal_code: address.postalCode ?? null,
			city: address.city ?? null,
			state: address.state ?? null,
			country: address.country ?? null
		}
	]
}

const transactionsOf = (detail: tOrderDetail) => detail.paymentData?.transactions ?? []

const toTransactionRows = (detail: tOrderDetail): tRow[] =>
	transactionsOf(detail).map(transaction => ({
		order_id: detail.orderId,
		is_active: flag(transaction.isActive),
		transaction_id: transaction.transactionId ?? null,
		merchant_name: transaction.merchantName ?? null
	}))

/** Sem dado de cartão: a tabela não tem titular, dígitos nem validade, e o ETL não lê esses campos. */
const toPaymentRows = (detail: tOrderDetail): tRow[] =>
	transactionsOf(detail).flatMap(transaction =>
		(transaction.payments ?? []).map(payment => ({
			order_id: detail.orderId,
			transaction_id: required(transaction.transactionId, `${detail.orderId} payment transaction_id`),
			payment_id: payment.id ?? OLD_ETL_FALLBACK.paymentId,
			payment_system: toText(payment.paymentSystem),
			payment_system_name: payment.paymentSystemName,
			value: toReais(payment.value),
			installments: payment.installments ?? null,
			reference_value: toReais(payment.referenceValue),
			redemption_code: payment.redemptionCode ?? null,
			gift_card_id: payment.giftCardId ?? null,
			gift_card_name: payment.giftCardName ?? null,
			gift_card_caption: payment.giftCardCaption ?? null,
			gift_card_as_discount: flag(payment.giftCardAsDiscount),
			gift_card_provider: payment.giftCardProvider ?? null,
			group: payment.group ?? null,
			tid: payment.tid ?? null
		}))
	)

const toGiftCardRows = (detail: tOrderDetail): tRow[] =>
	(detail.paymentData?.giftCards ?? []).map(card => ({
		order_id: detail.orderId,
		gift_card_id: toText(card.id),
		redemption_code: card.redemptionCode ?? null,
		name: card.name ?? null,
		caption: card.caption ?? null,
		value: toReais(card.value),
		balance: toReais(card.balance),
		provider: card.provider ?? null,
		group_name: card.groupName ?? null,
		in_use: flag(card.inUse),
		is_special_card: flag(card.isSpecialCard)
	}))

/** vtex_order_rates — promoções aplicadas (ratesAndBenefitsData.rateAndBenefitsIdentifiers). */
const toRateRows = (detail: tOrderDetail): tRow[] =>
	(detail.ratesAndBenefitsData?.rateAndBenefitsIdentifiers ?? []).map(rate => ({
		order_id: detail.orderId,
		featured: flag(rate.featured),
		id: rate.id,
		name: toText(rate.name)
	}))

/**
 * vtex_client_profile — perfil do cliente do pedido (dado pessoal; a VTEX já manda e-mail e telefone mascarados).
 * `id` = clientProfileData.userProfileId, a mesma chave de vtex_order_details.client_profile_id. Sem userProfileId não
 * há linha. `type`: documentType ("cpf"/"cnpj"); sem ele, deduzido de isCorporate — confirmar na paridade.
 */
const toClientProfileRow = (detail: tOrderDetail): tRow | null => {
	const profile = detail.clientProfileData

	if (!profile?.userProfileId) return null

	const type = profile.documentType ?? (profile.isCorporate ? 'cnpj' : 'cpf')

	return {
		id: profile.userProfileId,
		type: toText(type, TYPE_LENGTH),
		first_name: profile.firstName ?? null,
		last_name: profile.lastName ?? null,
		document: profile.document ?? null,
		home_phone: profile.phone ?? null,
		email: profile.email ?? null
	}
}

interface iDetailRows {
	details: tRow
	children: Record<tOrderChildTable, tRow[]>
	clientProfile: tRow | null
}

/** Todas as linhas de um pedido. Lança se algum campo não couber no tipo da coluna (ex.: seller não numérico). */
const toDetailRows = (detail: tOrderDetail, context: iDetailContext): iDetailRows => ({
	details: toDetailRow(detail, context),
	children: {
		[ORDER_TABLES.items]: toItemRows(detail),
		[ORDER_TABLES.logisticsInfo]: toLogisticsInfoRows(detail),
		[ORDER_TABLES.deliveryIds]: toDeliveryIdRows(detail),
		[ORDER_TABLES.shippingData]: toShippingDataRows(detail),
		[ORDER_TABLES.transactions]: toTransactionRows(detail),
		[ORDER_TABLES.payments]: toPaymentRows(detail),
		[ORDER_TABLES.giftCards]: toGiftCardRows(detail),
		[ORDER_TABLES.rates]: toRateRows(detail)
	},
	clientProfile: toClientProfileRow(detail)
})

export {
	toClientProfileRow,
	toDeliveryIdRows,
	toDetailRow,
	toDetailRows,
	toGiftCardRows,
	toItemRows,
	toLogisticsInfoRows,
	toOrderRow,
	toPaymentRows,
	sellerNameOf,
	toRateRows,
	toShippingDataRows,
	toTransactionRows
}
export type { iDetailContext, iDetailRows }
