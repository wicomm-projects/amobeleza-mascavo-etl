import { describe, expect, it } from 'vitest'

import { incompatibleRequested } from '../../src/connectors/ga4/schemas.js'

/** Resposta no formato do checkCompatibility do GA4 (só nomes de campo, nenhum dado). */
const response = {
	dimensionCompatibilities: [
		{ dimensionMetadata: { apiName: 'campaignName' }, compatibility: 'INCOMPATIBLE' },
		{ dimensionMetadata: { apiName: 'sessionSource' }, compatibility: 'COMPATIBLE' }
	],
	metricCompatibilities: [
		{ metricMetadata: { apiName: 'itemRevenue' }, compatibility: 'INCOMPATIBLE' },
		{ metricMetadata: { apiName: 'eventCount' }, compatibility: 2 }
	]
}

describe('checkCompatibility do GA4 no check-access', () => {
	it('campo incompatível que o relatório não pede não é erro', () => {
		expect(incompatibleRequested(response, ['date', 'sessionSource', 'sessions'])).toEqual([])
	})

	it('campo pedido que aparece como incompatível é erro', () => {
		expect(incompatibleRequested(response, ['date', 'sessionSource', 'eventCount'])).toEqual(['eventCount'])
	})
})
