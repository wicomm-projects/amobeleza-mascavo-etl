import { describe, expect, it } from 'vitest'

import { createChannelClassifier, type tChannelTable } from '../../src/connectors/ga4/de-para.js'

const input = {
	trafego: [
		{ origem: 'google / cpc', vehicle_channel_no_pay: 'google ads', type: 'pago' },
		{ origem: 'google / organic', vehicle_channel_no_pay: 'pesquisa orgânica', type: 'não pago' },
		{ origem: 'google / organic', campanha: 'cb_0001', vehicle_channel_no_pay: 'google ads', type: 'pago' }
	],
	vendas: [{ origem: 'google / cpc', vehicle_channel_no_pay: 'Google Ads', type: 'Pago' }]
}

describe('De/Para de canal do GA4', () => {
	it('tráfego: "google / cpc" vira google ads / pago, sem diferença de maiúscula', () => {
		const classifier = createChannelClassifier('trafego')

		expect(classifier.classify('google / cpc', '(not set)')).toEqual({
			vehicle_channel_no_pay: 'google ads',
			type: 'pago'
		})
		expect(classifier.classify('Google / CPC', '(not set)')).toEqual({
			vehicle_channel_no_pay: 'google ads',
			type: 'pago'
		})
	})

	it('vendas: "google / cpc" vira Google Ads / Pago (textos da tabela de vendas)', () => {
		expect(createChannelClassifier('vendas').classify('google / cpc', '(not set)')).toEqual({
			vehicle_channel_no_pay: 'Google Ads',
			type: 'Pago'
		})
	})

	it('origem sem regra devolve nulo e entra em unmapped()', () => {
		const classifier = createChannelClassifier('vendas', input)

		expect(classifier.classify('origem nova / x', 'campanha')).toEqual({ vehicle_channel_no_pay: null, type: null })
		expect(classifier.unmapped()).toEqual(['origem nova / x / campanha'])
		expect(classifier.ruleCount).toBe(1)
	})

	it('regra com campanha vence a regra só com origem', () => {
		const classifier = createChannelClassifier('trafego', input)

		expect(classifier.classify('google / organic', 'cb_0001').type).toBe('pago')
		expect(classifier.classify('google / organic', 'outra').type).toBe('não pago')
	})

	it('regra repetida lança erro', () => {
		const repeated = { origem: 'a / b', vehicle_channel_no_pay: 'x', type: 'y' }

		expect(() => createChannelClassifier('trafego', { trafego: [repeated, repeated], vendas: [] })).toThrow(
			/regra repetida/
		)
	})

	it('formato antigo (regras) é recusado', () => {
		expect(() => createChannelClassifier('trafego', { regras: [] })).toThrow(/de-para.json inválido/)
	})

	it('o de-para.json real carrega e as duas listas não estão vazias', () => {
		expect(createChannelClassifier('trafego').ruleCount).toBeGreaterThan(0)
		expect(createChannelClassifier('vendas').ruleCount).toBeGreaterThan(0)
	})
})

describe('regra por mídia (referral)', () => {
	const withMedium = {
		trafego: [
			{ midia: 'referral', vehicle_channel_no_pay: 'referral', type: 'não pago' },
			{ origem: 'br.search.yahoo.com / referral', vehicle_channel_no_pay: 'pesquisa orgânica', type: 'não pago' }
		],
		vendas: []
	}

	it('site de referral sem regra própria cai na regra da mídia e não vira pendência', () => {
		const classifier = createChannelClassifier('trafego', withMedium)

		expect(classifier.classify('site-novo.com.br / referral', '(referral)')).toEqual({
			vehicle_channel_no_pay: 'referral',
			type: 'não pago'
		})
		expect(classifier.unmapped()).toEqual([])
	})

	it('a regra da origem vence a regra da mídia', () => {
		const classifier = createChannelClassifier('trafego', withMedium)

		expect(classifier.classify('br.search.yahoo.com / referral', '(referral)').vehicle_channel_no_pay).toBe(
			'pesquisa orgânica'
		)
	})

	it('origem sem " / " não usa regra de mídia', () => {
		const classifier = createChannelClassifier('trafego', withMedium)

		expect(classifier.classify('(not set)', '(not set)').vehicle_channel_no_pay).toBeNull()
	})

	it('mídia repetida lança erro', () => {
		const repeated = { midia: 'referral', vehicle_channel_no_pay: 'x', type: 'y' }

		expect(() => createChannelClassifier('trafego', { trafego: [repeated, repeated], vendas: [] })).toThrow(
			/regra repetida/
		)
	})

	it('o de-para.json real tem a regra de referral nas duas tabelas', () => {
		expect(createChannelClassifier('trafego').classify('qualquer.site / referral', '').type).toBe('não pago')
		expect(createChannelClassifier('vendas').classify('qualquer.site / referral', '').vehicle_channel_no_pay).toBe(
			'Referral'
		)
	})
})

/**
 * Origens novas desde 20/08/2026 (primeira carga do ETL novo, 27/11/2026), classificadas pela cliente a partir da
 * sugestão por analogia com o histórico. Cada linha: tabela, origem / mídia, campanha, canal, tipo.
 */
const APPROVED_27_11: [tChannelTable, string, string, string, string][] = [
	['trafego', 'wicomm / push', '20261125_wpp_beauty_friday', 'crm', 'não pago'],
	['trafego', 'rd station / wpp', '20261125_wpush_beauty_friday', 'crm', 'não pago'],
	['trafego', 'rdstation / whatsapp', '20260909_wppc_wpp_mascavo_day', 'crm', 'não pago'],
	['trafego', 'pinterest / paidsocial', '626757307436', 'pinterest ads', 'pago'],
	['trafego', 'tolstoy / feed_share', '(organic)', 'referral', 'não pago'],
	['trafego', '', '', 'referral', 'não pago'],
	['trafego', 'facebook / paid_social', '(referral)', 'facebook ads', 'pago'],
	['trafego', 'reclameaqui / brandpage_contact_widget', 'site_visit', 'referral', 'não pago'],
	['trafego', '--sanitized-- / --sanitized--', '--sanitized--', 'facebook ads', 'pago'],
	['trafego', 'pinterest / social', 'influ-mascavobr', 'social orgânico', 'não pago'],
	['trafego', 'claude.ai / ai-assistant', '(ai-assistant)', 'outros', 'não pago'],
	['trafego', 'gemini / (not set)', '(not set)', 'pesquisa orgânica', 'não pago'],
	['trafego', 'facebook= / cpc', 'cb_0360_mascavo_cons_wsc_fb-wsc_trafego', 'facebook ads', 'pago'],
	['trafego', 'facebook / paid', '(not set)', 'facebook ads', 'pago'],
	['trafego', 'koin / marketplace', 'mascavo', 'referral', 'não pago'],
	['trafego', 'awin / affiliate', '(not set)', 'afiliado', 'pago'],
	['vendas', 'groovinads / ads', 'CB_0335_Mascavo_CONV_CONV_grvin-conv_conversao', 'Groovin Ads', 'Pago'],
	['vendas', 'wicomm / push', '20261125_WPP_BEAUTY_FRIDAY', 'CRM', 'Não pago'],
	['vendas', 'rdstation / whatsapp', '20260909_WPPC_WPP_MASCAVO_DAY', 'CRM', 'Não pago'],
	['vendas', 'RP / Social', 'Steal The Look', 'Social orgânico', 'Não pago'],
	['vendas', 'RD Station / WPP', '20261125_WPUSH_BEAUTY_FRIDAY', 'CRM', 'Não pago'],
	['vendas', '', '', 'Referral', 'Não pago'],
	['vendas', 'RD Station / push_web', '20260812_WPPC_PUSH_WEB_LANCAMENTO_FACE_THE_DAY', 'CRM', 'Não pago']
]

describe('De/Para: origens novas aprovadas pela cliente em 27/11/2026', () => {
	it.each(APPROVED_27_11)('%s: "%s" vira o canal aprovado', (table, source, campaign, channel, type) => {
		expect(createChannelClassifier(table).classify(source, campaign)).toEqual({
			vehicle_channel_no_pay: channel,
			type
		})
	})

	it('WhatsApp da RD vai para CRM também nas regras antigas, para não dividir o mesmo disparo em dois canais', () => {
		expect(createChannelClassifier('trafego').classify('rd station / whatsapp', 'x').vehicle_channel_no_pay).toBe(
			'crm'
		)
		expect(createChannelClassifier('trafego').classify('rd / whatsapp', 'x').vehicle_channel_no_pay).toBe('crm')
		expect(createChannelClassifier('vendas').classify('RD Station / whatsapp', 'x').vehicle_channel_no_pay).toBe(
			'CRM'
		)
		expect(createChannelClassifier('vendas').classify('rd / whatsapp', 'x').vehicle_channel_no_pay).toBe('CRM')
	})

	it('Groovin vira o canal novo "groovin ads / pago" também nas regras antigas do tráfego', () => {
		for (const source of ['groovin / ads', 'groovinads / ads', 'groovinads / display']) {
			expect(createChannelClassifier('trafego').classify(source, 'x')).toEqual({
				vehicle_channel_no_pay: 'groovin ads',
				type: 'pago'
			})
		}
	})

	it('nenhuma pendência sobra para as origens aprovadas', () => {
		for (const table of ['trafego', 'vendas'] as const) {
			const classifier = createChannelClassifier(table)

			for (const [rowTable, source, campaign] of APPROVED_27_11) {
				if (rowTable === table) classifier.classify(source, campaign)
			}

			expect(classifier.unmapped()).toEqual([])
		}
	})
})
