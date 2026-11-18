/**
 * Tabelas do AnyMarket em amobeleza_etl. Nomes do dicionário da WPP ("Documentação Amobeleza", seção 2.5): o pedido em
 * anymarket_orders (PK = id do pedido no AnyMarket) e as filhas ligadas por anymarket_order_id.
 */
const ANYMARKET_TABLES = {
	orders: 'anymarket_orders',
	items: 'anymarket_order_items',
	payments: 'anymarket_order_payments',
	shipping: 'anymarket_order_shipping',
	tracking: 'anymarket_order_tracking',
	buyer: 'anymarket_order_buyer'
} as const

/** Coluna que liga as filhas ao pedido (FK lógica para anymarket_orders.id). */
const ORDER_KEY_COLUMN = 'anymarket_order_id'

/** Filhas: a carga apaga as linhas dos pedidos do lote e insere de novo (item removido some). */
const CHILD_TABLES = [
	ANYMARKET_TABLES.items,
	ANYMARKET_TABLES.payments,
	ANYMARKET_TABLES.shipping,
	ANYMARKET_TABLES.tracking,
	ANYMARKET_TABLES.buyer
] as const

const ALL_TABLES: readonly string[] = [ANYMARKET_TABLES.orders, ...CHILD_TABLES]

export { ALL_TABLES, ANYMARKET_TABLES, CHILD_TABLES, ORDER_KEY_COLUMN }
