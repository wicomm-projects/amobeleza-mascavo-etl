/** Tabelas VTEX, com a grafia do dicionário da WPP (docs/contrato/mascavo_etl.md). Mesmas nos dois bancos. */

const ORDER_TABLES = {
	orders: 'vtex_orders',
	details: 'vtex_order_details',
	items: 'vtex_order_items',
	logisticsInfo: 'vtex_order_logistics_info',
	deliveryIds: 'vtex_order_logistics_delivery_ids',
	shippingData: 'vtex_order_shipping_data',
	transactions: 'vtex_order_payment_transactions',
	payments: 'vtex_order_payment_transactions_payments',
	giftCards: 'vtex_order_payment_gift_cards',
	rates: 'vtex_order_rates',
	clientProfile: 'vtex_client_profile'
} as const

const CATALOG_TABLES = {
	products: 'vtex_products',
	categoryTree: 'vtex_category_tree',
	skusAndProducts: 'vtex_skus_and_products_id'
} as const

/** Filhas do detalhe: regravadas por order_id (item removido do pedido some). */
const ORDER_CHILD_TABLES = [
	ORDER_TABLES.items,
	ORDER_TABLES.logisticsInfo,
	ORDER_TABLES.deliveryIds,
	ORDER_TABLES.shippingData,
	ORDER_TABLES.transactions,
	ORDER_TABLES.payments,
	ORDER_TABLES.giftCards,
	ORDER_TABLES.rates
] as const

type tOrderChildTable = (typeof ORDER_CHILD_TABLES)[number]

export { CATALOG_TABLES, ORDER_CHILD_TABLES, ORDER_TABLES }
export type { tOrderChildTable }
