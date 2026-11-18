import type { tRow } from '../../core/db/index.js'

import type { tListOrder, tOrderDetail } from './schemas.js'
import { ORDER_TABLES, type tOrderChildTable } from './tables.js'
import { flag, toInt, toJson, toText, toUtcDate } from './values.js'

/**
 * Transformações puras: resposta da VTEX → linhas das tabelas antigas, com a grafia exata do dicionário
 * (docs/contrato/mascavo_etl.md). Sem I/O, sem relógio: a mesma entrada dá sempre a mesma saída.
 *
 * Convenções (docs/contrato/convencoes.md): dinheiro em centavos como a VTEX manda; datas em UTC sem fração; status em
 * inglês e descrição em português, sem traduzir; booleano em 1/0. Valor ausente fica nulo — nada é inventado. As
 * colunas em que a VTEX pode mandar nulo e o dicionário diz "Não nulo" estão listadas em docs/conectores/vtex.md.
 *
 * Toda linha de uma tabela sai com as mesmas colunas (o writer exige).
 */

/** Sufixo do seller no ID do pedido ("1665527299796-01" → "1665527299796"). */
const ORDER_SUFFIX = /-\d+$/

const TOTAL_IDS = { items: 'Items', discounts: 'Discounts', shipping: 'Shipping', taxes: 'Tax' } as const

const SALES_CHANNEL_LENGTH = 3
const TYPE_LENGTH = 10

/** vtex_orders — uma linha por pedido da LISTA do OMS. `hostnameFallback`: conta VTEX, quando a lista não traz. */
const toOrderRow = (order: tListOrder, hostnameFallback: string | null): tRow => ({
	order_id: order.orderId,
	order_date: toUtcDate(order.creationDate),
	total_value: order.totalValue,
	status: order.status ?? null,
	status_description: order.statusDescription ?? null,
	market_place_order_id: order.marketPlaceOrderId ?? null,
	sequence: order.sequence ?? null,
	sales_channel: order.salesChannel ?? null,
	affiliate_id: order.affiliateId ?? null,
	origin: order.origin ?? null,
	workflow_in_error_state: flag(order.workflowInErrorState),
	workflow_in_retry: flag(order.workflowInRetry),
	shipping_estimated_date: toUtcDate(order.ShippingEstimatedDate),
	shipping_estimated_date_max: toUtcDate(order.ShippingEstimatedDateMax),
	shipping_estimated_date_min: toUtcDate(order.ShippingEstimatedDateMin),
	order_is_complete: flag(order.orderIsComplete),
	authorized_date: toUtcDate(order.authorizedDate),
	total_items: order.totalItems ?? null,
	currency_code: order.currencyCode ?? null,
	hostname: order.hostname ?? hostnameFallback,
	last_change: toUtcDate(order.lastChange),
	is_all_delivered: flag(order.isAllDelivered),
	is_any_delivered: flag(order.isAnyDelivered),
	ready_for_handling_date: toUtcDate(order.readyForHandlingDate)
})

/** Seller "1" é a própria loja na VTEX. */
const MAIN_SELLER_ID = '1'

/**
 * `seller_name` (só amobeleza_etl.vtex_orders): nome do seller do pedido quando é um seller terceiro; nulo quando é a
 * própria loja — o Power BI lê "seller vazio = Amobeleza". Na VTEX cada pedido (depois do split) tem um seller só.
 * A regra exata do ETL antigo não está documentada: confirmar na paridade.
 */
const sellerNameOf = (detail: tOrderDetail): string | null => {
	const seller = detail.sellers?.find(candidate => String(candidate.id) !== MAIN_SELLER_ID)

	return seller ? toText(seller.name) : null
}

const totalOf = (detail: tOrderDetail, id: string): number => detail.totals?.find(total => total.id === id)?.value ?? 0

/** openTextField vem como { value: "..." } ou texto, ou nulo. */
const openText = (value: unknown): string | null => {
	if (value === null || value === undefined) return null

	if (typeof value === 'object' && 'value' in value) return toText((value as { value: unknown }).value)

	return toText(value)
}

/** vtex_order_details — PK order_id, 1:1 com vtex_orders. */
const toDetailRow = (detail: tOrderDetail): tRow => ({
	order_id: detail.orderId,
	sequence: detail.sequence,
	client_profile_id: detail.clientProfileData?.userProfileId ?? null,
	marketplace_order_id: detail.marketplaceOrderId ?? null,
	marketplace_services_endpoint: toText(detail.marketplaceServicesEndpoint),
	seller_order_id: detail.sellerOrderId ?? null,
	origin: detail.origin,
	affiliate_id: detail.affiliateId ?? null,
	sales_channel: toText(detail.salesChannel, SALES_CHANNEL_LENGTH),
	merchant_name: detail.merchantName ?? null,
	status: detail.status,
	status_description: detail.statusDescription ?? null,
	value: detail.value,
	creation_date: toUtcDate(detail.creationDate),
	last_change: toUtcDate(detail.lastChange),
	order_group: detail.orderGroup ?? detail.orderId.replace(ORDER_SUFFIX, ''),
	totals_items: totalOf(detail, TOTAL_IDS.items),
	totals_discounts: totalOf(detail, TOTAL_IDS.discounts),
	totals_shipping: totalOf(detail, TOTAL_IDS.shipping),
	totals_taxes: totalOf(detail, TOTAL_IDS.taxes),
	followup_email: detail.followUpEmail ?? null,
	hostname: detail.hostname,
	opentextfield: openText(detail.openTextField),
	roundingerror: detail.roundingError ?? null,
	orderformid: detail.orderFormId ?? null,
	commercialconditiondata: toJson(detail.commercialConditionData),
	iscompleted: flag(detail.isCompleted),
	allowcancellation: flag(detail.allowCancellation),
	allowedition: flag(detail.allowEdition),
	ischeckedin: flag(detail.isCheckedIn),
	utm_source: detail.marketingData?.utmSource ?? null,
	coupon: detail.marketingData?.coupon ?? null,
	authorizeddate: toUtcDate(detail.authorizedDate),
	invoiceddate: toUtcDate(detail.invoicedDate)
})

const toItemRows = (detail: tOrderDetail): tRow[] =>
	(detail.items ?? []).map((item, index) => {
		const field = (name: string) => `${detail.orderId} item ${index} ${name}`

		return {
			order_id: detail.orderId,
			uniqueid: item.uniqueId,
			id: toInt(item.id, field('id')),
			productid: toInt(item.productId, field('productId')),
			ean: item.ean ?? null,
			lockid: item.lockId ?? null,
			quantity: item.quantity,
			seller: toInt(item.seller, field('seller')),
			name: toText(item.name),
			refid: item.refId ?? null,
			price: item.price,
			listprice: item.listPrice,
			manualprice: item.manualPrice ?? null,
			imageurl: toText(item.imageUrl),
			detailurl: toText(item.detailUrl),
			sellersku: item.sellerSku ?? null,
			commission: item.commission ?? null,
			tax: item.tax ?? null,
			presaledate: toUtcDate(item.preSaleDate),
			additionalinfo: JSON.stringify(item.additionalInfo ?? null),
			measurementunit: item.measurementUnit ?? null,
			unitmultiplier: item.unitMultiplier ?? null,
			sellingprice: item.sellingPrice ?? null,
			isgift: flag(item.isGift),
			shippingprice: item.shippingPrice ?? null,
			rewardvalue: item.rewardValue ?? null,
			freightcommission: item.freightCommission ?? null,
			taxcode: item.taxCode ?? null,
			costprice: item.costPrice ?? null
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
		price: info.price ?? null,
		list_price: info.listPrice ?? null,
		selling_price: info.sellingPrice ?? null,
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
			transaction_id: transaction.transactionId ?? null,
			payment_id: payment.id,
			payment_system: toText(payment.paymentSystem),
			payment_system_name: payment.paymentSystemName,
			value: payment.value ?? null,
			installments: payment.installments ?? null,
			reference_value: payment.referenceValue ?? null,
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
		value: card.value ?? null,
		balance: card.balance ?? null,
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
const toDetailRows = (detail: tOrderDetail): iDetailRows => ({
	details: toDetailRow(detail),
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
export type { iDetailRows }
