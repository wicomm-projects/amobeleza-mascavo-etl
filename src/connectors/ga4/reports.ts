import type { protos } from '@google-analytics/data'

import type { tBrand } from '../../config/index.js'
import type { tRow } from '../../core/db/index.js'

import type { iChannelClassifier } from './de-para.js'
import type { iGa4Row, tCollapse } from './transform.js'

/**
 * Uma definição de relatório por tabela: dimensões e métricas da API de dados do GA4 → colunas com a grafia exata do
 * contrato (docs/contrato/mascavo_etl.md e o dicionário da Amobeleza, resumidos em docs/conectores/ga4.md).
 *
 * Mascavo (o que o B2C lê): trafego, vendas, users, items, category — colunas já nos nomes do GA4.
 * Amobeleza (Web Analytics, tabelas h_*): trafego, transacoes, navegacao, por_hora — colunas da era Universal
 * Analytics. A equivalência UA → GA4 abaixo foi aceita pelo Matheus (AMO-Q5) e é validada na paridade antes de ligar a
 * produção (ver a doc).
 *
 * Nomes de dimensões e métricas conferidos na doc do schema da API (v1beta) em 18/11/2026. `conversions` foi
 * renomeada para `keyEvents` pelo Google em 2024.
 */

type tFilterExpression = protos.google.analytics.data.v1beta.IFilterExpression
type tOrderBy = protos.google.analytics.data.v1beta.IOrderBy

const GA4_TABLES = [
	'sheets_google_drive_trafego',
	'sheets_google_drive_vendas',
	'sheets_google_drive_users',
	'sheets_google_drive_items',
	'sheets_google_drive_category',
	'sheets_google_drive_transacoes',
	'sheets_google_drive_navegacao',
	'sheets_google_drive_por_hora'
] as const

type tGa4Table = (typeof GA4_TABLES)[number]

type tReportScope =
	/** Janela do job (padrão 3 dias); grava com replaceDateWindow na coluna de data. */
	| { kind: 'window'; dateColumn: string }
	/** De uma data fixa até o fim da janela; substitui a tabela inteira (replaceAll). */
	| { kind: 'since'; startDate: string }
	/** Últimos N dias até o fim da janela; substitui a tabela inteira (replaceAll). */
	| { kind: 'lastDays'; days: number }

interface iRowContext {
	/** ID numérico da propriedade GA4 da marca (texto). */
	propertyId: string
	channel: iChannelClassifier
}

interface iReportDefinition {
	table: tGa4Table
	dimensions: readonly string[]
	metrics: readonly string[]
	dimensionFilter?: tFilterExpression
	orderBys?: readonly tOrderBy[]
	/** Devolve também linhas com todas as métricas zeradas (o padrão do GA4 é omitir). */
	keepEmptyRows?: boolean
	scope: tReportScope
	/** Linhas que o MySQL veria como a mesma chave primária (collation sem maiúscula/acento). */
	collapse?: tCollapse
	toRow: (row: iGa4Row, context: iRowContext) => tRow
}

/**
 * As propriedades GA4 nasceram como "App + Web" em 2019: nenhuma tem dado antes disso. `category` lê desde aí para que
 * todo item que aparece em `items` tenha categoria (o Power BI liga items → category por Item_name, N:1).
 */
const CATEGORY_START_DATE = '2019-01-01'

/**
 * A `por_hora` da Amobeleza tinha 96 linhas na produção (4 dias × 24 h): a planilha era uma janela móvel substituída
 * inteira. *Assumida, a confirmar.*
 */
const POR_HORA_DAYS = 4

const event = (name: string): tFilterExpression => ({
	filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: name } }
})

// ---------------------------------------------------------------- Mascavo

/**
 * O Power BI chama `event_count` de "Sessões". *Assumido, a confirmar na paridade*: contagem do evento session_start
 * (≈ sessões). Se a paridade mostrar que era o total de eventos, basta tirar o filtro.
 */
const mascavoTrafego: iReportDefinition = {
	table: 'sheets_google_drive_trafego',
	dimensions: ['date', 'sessionSource', 'sessionCampaignName', 'platformDeviceCategory'],
	metrics: ['eventCount'],
	dimensionFilter: event('session_start'),
	scope: { kind: 'window', dateColumn: 'date' },
	// Índice único da produção: (date, ga4_property_id, session_source(100), session_campaign_name(100),
	// platform_device_category(100), vehicle_channel_no_pay(100), type(100)), em utf8mb4_unicode_ci.
	collapse: {
		keyColumns: [
			'date',
			'ga4_property_id',
			'session_source',
			'session_campaign_name',
			'platform_device_category',
			'vehicle_channel_no_pay',
			'type'
		],
		prefix: {
			session_source: 100,
			session_campaign_name: 100,
			platform_device_category: 100,
			vehicle_channel_no_pay: 100,
			type: 100
		},
		sumColumns: ['event_count']
	},
	toRow: (row, { propertyId, channel }) => {
		const source = row.text('sessionSource')
		const campaign = row.text('sessionCampaignName')

		return {
			date: row.date('date'),
			// int na tabela de tráfego, varchar na de vendas (dicionário da WPP).
			ga4_property_id: Number(propertyId),
			session_source: source,
			session_campaign_name: campaign,
			platform_device_category: row.text('platformDeviceCategory'),
			event_count: row.count('eventCount'),
			...channel.classify(source, campaign)
		}
	}
}

/**
 * `source` e `campaignName` são as dimensões atribuídas ao evento-chave (a "campanha do evento" do Supermetrics).
 * `conversions` ← `keyEvents` (todos os eventos-chave da propriedade). `investment` era texto calculado na planilha e não
 * existe no GA4: fica nulo até combinar a regra.
 */
const mascavoVendas: iReportDefinition = {
	table: 'sheets_google_drive_vendas',
	dimensions: ['date', 'source', 'campaignName', 'platformDeviceCategory'],
	metrics: ['purchaseRevenue', 'keyEvents'],
	scope: { kind: 'window', dateColumn: 'date' },
	// Índice único da produção: (date, ga4_property_id(50), source(100), event_campaign_name(100),
	// platform_device_category(50), purchase_revenue, conversions, vehicle_channel_no_pay(50), type(50), investment(50)).
	// Juntamos pelas colunas de texto (sem as métricas) e somamos receita e conversões: junta um pouco mais que o índice,
	// mas nunca deixa duas linhas colidirem e os totais ficam iguais. `investment` é sempre nulo aqui.
	collapse: {
		keyColumns: [
			'date',
			'ga4_property_id',
			'source',
			'event_campaign_name',
			'platform_device_category',
			'vehicle_channel_no_pay',
			'type'
		],
		prefix: {
			ga4_property_id: 50,
			source: 100,
			event_campaign_name: 100,
			platform_device_category: 50,
			vehicle_channel_no_pay: 50,
			type: 50
		},
		sumColumns: ['purchase_revenue', 'conversions']
	},
	toRow: (row, { propertyId, channel }) => {
		const source = row.text('source')
		const campaign = row.text('campaignName')

		return {
			date: row.date('date'),
			ga4_property_id: propertyId,
			source,
			event_campaign_name: campaign,
			platform_device_category: row.text('platformDeviceCategory'),
			purchase_revenue: row.money('purchaseRevenue'),
			conversions: row.money('keyEvents'),
			...channel.classify(source, campaign),
			investment: null
		}
	}
}

const mascavoUsers: iReportDefinition = {
	table: 'sheets_google_drive_users',
	dimensions: ['date', 'sessionSource'],
	metrics: ['firstTimePurchasers', 'newUsers'],
	scope: { kind: 'window', dateColumn: 'Date' },
	// PK (Date, Session_source) com Session_source em utf8mb4_bin: "Google" e "google" são linhas diferentes na produção.
	collapse: {
		keyColumns: ['Date', 'Session_source'],
		match: 'exact',
		sumColumns: ['First_time_purchasers', 'New_users']
	},
	toRow: row => ({
		Date: row.date('date'),
		Session_source: row.text('sessionSource'),
		First_time_purchasers: row.count('firstTimePurchasers'),
		New_users: row.count('newUsers')
	})
}

/**
 * A PK da tabela são as cinco colunas, com Session_source e Item_name em utf8mb4_bin (estrutura real): maiúscula conta.
 * Juntamos só data + origem + item exatamente iguais (na prática, só diferença de espaço no fim).
 */
const mascavoItems: iReportDefinition = {
	table: 'sheets_google_drive_items',
	dimensions: ['date', 'sessionSource', 'itemName'],
	metrics: ['itemRevenue', 'itemsPurchased'],
	scope: { kind: 'window', dateColumn: 'Date' },
	collapse: {
		keyColumns: ['Date', 'Session_source', 'Item_name'],
		match: 'exact',
		sumColumns: ['Item_revenue', 'Item_purchase_quantity']
	},
	toRow: row => ({
		Date: row.date('date'),
		Session_source: row.text('sessionSource'),
		Item_name: row.text('itemName'),
		Item_revenue: row.number('itemRevenue'),
		Item_purchase_quantity: row.count('itemsPurchased')
	})
}

/**
 * Mapa item → categoria. O runReport exige ao menos uma métrica: `itemsPurchased` só ordena (não vira coluna), com
 * `keepEmptyRows` para trazer também item nunca comprado. Um item com duas categorias no período fica com a de mais
 * unidades compradas — o Power BI precisa de Item_name único do lado "1" da relação.
 */
const mascavoCategory: iReportDefinition = {
	table: 'sheets_google_drive_category',
	dimensions: ['itemCategory', 'itemCategory2', 'itemName'],
	metrics: ['itemsPurchased'],
	orderBys: [{ metric: { metricName: 'itemsPurchased' }, desc: true }],
	keepEmptyRows: true,
	scope: { kind: 'since', startDate: CATEGORY_START_DATE },
	collapse: { keyColumns: ['Item_name'], keep: 'first' },
	toRow: row => ({
		Item_category: row.text('itemCategory'),
		Item_category_2: row.text('itemCategory2'),
		Item_name: row.text('itemName')
	})
}

// ---------------------------------------------------------------- Amobeleza (colunas da era UA — equivalência da AMO-Q5)

/**
 * `bounces` não existe no GA4: rejeição = sessão não engajada, então bounces = sessions − engagedSessions (a mesma conta
 * da taxa de rejeição do GA4). `pageviews` ← `screenPageViews`; receita/transações ← `purchaseRevenue`/`transactions`.
 */
const amobelezaTrafego: iReportDefinition = {
	table: 'sheets_google_drive_trafego',
	dimensions: ['date', 'sessionSourceMedium', 'sessionCampaignName', 'deviceCategory', 'mobileDeviceBranding'],
	metrics: ['sessions', 'engagedSessions', 'newUsers', 'screenPageViews', 'purchaseRevenue', 'transactions'],
	scope: { kind: 'window', dateColumn: 'date' },
	toRow: row => {
		const sessions = row.count('sessions')

		return {
			date: row.date('date'),
			source_medium: row.text('sessionSourceMedium'),
			campaign: row.text('sessionCampaignName'),
			device_category: row.text('deviceCategory'),
			mobile_device_brand: row.text('mobileDeviceBranding'),
			sessions,
			bounces: Math.max(0, sessions - row.count('engagedSessions')),
			new_users: row.count('newUsers'),
			pageviews: row.count('screenPageViews'),
			transaction_revenue: row.money('purchaseRevenue'),
			transactions: row.count('transactions')
		}
	}
}

/** O Power BI cruza `transaction_id` (sem o sufixo) com o pedido VTEX para trazer Origem / Mídia. */
const amobelezaTransacoes: iReportDefinition = {
	table: 'sheets_google_drive_transacoes',
	dimensions: [
		'date',
		'transactionId',
		'sessionSourceMedium',
		'sessionCampaignName',
		'deviceCategory',
		'mobileDeviceBranding'
	],
	metrics: ['transactions', 'purchaseRevenue'],
	scope: { kind: 'window', dateColumn: 'date' },
	toRow: row => ({
		date: row.date('date'),
		transaction_id: row.text('transactionId'),
		source_medium: row.text('sessionSourceMedium'),
		campaign: row.text('sessionCampaignName'),
		device_category: row.text('deviceCategory'),
		mobile_device_brand: row.text('mobileDeviceBranding'),
		transactions: row.count('transactions'),
		transaction_revenue: row.money('purchaseRevenue')
	})
}

/** `segment` era o segmento do UA, que a API do GA4 não tem: fica nulo (AMO-Q5). O Power BI não lê esta tabela. */
const amobelezaNavegacao: iReportDefinition = {
	table: 'sheets_google_drive_navegacao',
	dimensions: ['date', 'deviceCategory', 'mobileDeviceBranding'],
	metrics: ['sessions'],
	scope: { kind: 'window', dateColumn: 'date' },
	toRow: row => ({
		date: row.date('date'),
		device_category: row.text('deviceCategory'),
		mobile_device_brand: row.text('mobileDeviceBranding'),
		segment: null,
		sessions: row.count('sessions')
	})
}

const amobelezaPorHora: iReportDefinition = {
	table: 'sheets_google_drive_por_hora',
	dimensions: ['date', 'hour'],
	metrics: ['purchaseRevenue', 'transactions', 'sessions'],
	scope: { kind: 'lastDays', days: POR_HORA_DAYS },
	toRow: row => ({
		date: row.date('date'),
		hour: row.hour('hour'),
		transaction_revenue: row.money('purchaseRevenue'),
		transactions: row.count('transactions'),
		sessions: row.count('sessions')
	})
}

const REPORTS_BY_BRAND: Readonly<Record<tBrand, readonly iReportDefinition[]>> = {
	mascavo: [mascavoTrafego, mascavoVendas, mascavoUsers, mascavoItems, mascavoCategory],
	amobeleza: [amobelezaTrafego, amobelezaTransacoes, amobelezaNavegacao, amobelezaPorHora]
}

const reportsOf = (brand: tBrand): readonly iReportDefinition[] => REPORTS_BY_BRAND[brand]

export { CATEGORY_START_DATE, POR_HORA_DAYS, reportsOf }
export type { iReportDefinition, iRowContext, tFilterExpression, tGa4Table, tOrderBy, tReportScope }
