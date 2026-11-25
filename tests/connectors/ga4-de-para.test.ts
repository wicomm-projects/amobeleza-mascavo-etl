import { describe, expect, it } from 'vitest'

import { createChannelClassifier } from '../../src/connectors/ga4/de-para.js'

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
