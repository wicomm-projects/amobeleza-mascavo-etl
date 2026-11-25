import { describe, expect, it } from 'vitest'

import { createChannelClassifier } from '../../src/connectors/ga4/de-para.js'
import { reportsOf } from '../../src/connectors/ga4/reports.js'
import type { iReportData } from '../../src/connectors/ga4/schemas.js'
import { toRows } from '../../src/connectors/ga4/transform.js'

const METADATA = {
	currencyCode: 'BRL',
	timeZone: 'America/Sao_Paulo',
	dataLossFromOtherRow: false,
	subjectToThresholding: false,
	sampled: false,
	truncated: false
}

const definitionOf = (table: string) => {
	const found = reportsOf('mascavo').find(definition => definition.table === table)

	if (!found) throw new Error(`sem definição para ${table}`)

	return found
}

const reportOf = (
	dimensionHeaders: string[],
	dimensions: string[],
	metricHeaders: string[],
	metrics: string[]
): iReportData => ({
	dimensionHeaders,
	metricHeaders,
	rows: [{ dimensions, metrics }],
	rowCount: 1,
	metadata: METADATA
})

const rowsOf = (table: string, report: iReportData) => {
	const definition = definitionOf(table)

	if (!definition.channelRules) throw new Error(`${table} deveria ter channelRules`)

	const channel = createChannelClassifier(definition.channelRules)

	return toRows(table, report, definition.toRow, { propertyId: '123', channel }, { truncated: 0 })
}

describe('relatórios do GA4 da Mascavo: origem / mídia', () => {
	it('tráfego: origem e campanha em minúsculas e o canal do De/Para de tráfego', () => {
		const report = reportOf(
			['date', 'sessionSourceMedium', 'sessionCampaignName', 'platformDeviceCategory'],
			['20261116', 'RD Station / email', 'CB_0172_X', 'web / mobile'],
			['eventCount'],
			['10']
		)

		expect(rowsOf('sheets_google_drive_trafego', report)).toEqual([
			{
				date: '2026-11-16',
				ga4_property_id: 123,
				session_source: 'rd station / email',
				session_campaign_name: 'cb_0172_x',
				platform_device_category: 'web / mobile',
				event_count: 10,
				vehicle_channel_no_pay: 'crm',
				type: 'não pago'
			}
		])
	})

	it('vendas: mantém as maiúsculas e grava o canal do De/Para de vendas', () => {
		const report = reportOf(
			['date', 'sourceMedium', 'campaignName', 'platformDeviceCategory'],
			['20261116', 'RD Station / email', 'CB_0172_X', 'web / mobile'],
			['purchaseRevenue', 'keyEvents:purchase'],
			['99.9', '2']
		)
		const [row] = rowsOf('sheets_google_drive_vendas', report)

		expect(row).toMatchObject({
			source: 'RD Station / email',
			event_campaign_name: 'CB_0172_X',
			vehicle_channel_no_pay: 'CRM',
			type: 'Não pago',
			purchase_revenue: 99.9,
			conversions: 2
		})
	})

	it('users e items pedem sessionSourceMedium e não têm De/Para', () => {
		for (const table of ['sheets_google_drive_users', 'sheets_google_drive_items']) {
			const definition = definitionOf(table)

			expect(definition.dimensions).toContain('sessionSourceMedium')
			expect(definition.channelRules).toBeUndefined()
		}

		expect(definitionOf('sheets_google_drive_trafego').dimensions).toContain('sessionSourceMedium')
		expect(definitionOf('sheets_google_drive_vendas').dimensions).toContain('sourceMedium')
	})
})
