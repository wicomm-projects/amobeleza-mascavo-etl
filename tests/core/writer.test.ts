import { describe, expect, it } from 'vitest'

import type { iConnectionSource } from '../../src/core/db/connection.js'
import { createWriter } from '../../src/core/db/writer.js'
import { SafetyError } from '../../src/core/errors.js'

type tMarker = 'present' | 'absent' | 'missing-table'

/** Conexão falsa que registra cada SQL e simula o marcador do banco local. Nenhum banco real é usado. */
const fakeSource = (marker: tMarker) => {
	const queries: string[] = []
	let connections = 0
	const source: iConnectionSource = {
		getConnection: async () => {
			connections += 1

			return {
				query: async (sql: string) => {
					queries.push(sql)

					if (sql.includes('etl_local_meta')) {
						if (marker === 'missing-table') throw new Error("Table 'etl_local_meta.marker' doesn't exist")

						return [marker === 'present' ? [{ env: 'local-dev' }] : [], []]
					}

					return [{ affectedRows: 1 }, []]
				},
				release: () => undefined
			}
		}
	}

	return { source, queries, connections: () => connections }
}

const writes = (queries: string[]) => queries.filter(sql => /^(INSERT|DELETE|START|COMMIT)/.test(sql))

const now = () => new Date('2026-11-18T12:00:00.000Z')

describe('writer: travas do banco de destino', () => {
	it.each<tMarker>(['absent', 'missing-table'])('sem marcador local (%s): recusa e não grava nada', async marker => {
		const fake = fakeSource(marker)
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_orders'], dryRun: false },
			{ source: fake.source, now }
		)

		await expect(
			writer.transaction(tx => tx.replaceByKeys('vtex_orders', 'order_id', ['1-01'], [{ order_id: '1-01' }]))
		).rejects.toThrow(SafetyError)

		expect(writes(fake.queries)).toEqual([])
	})

	it('com marcador local: grava dentro de uma transação', async () => {
		const fake = fakeSource('present')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_orders'], dryRun: false },
			{ source: fake.source, now }
		)

		const { results } = await writer.transaction(tx =>
			tx.replaceByKeys('vtex_orders', 'order_id', ['1-01'], [{ order_id: '1-01', status: 'invoiced' }])
		)

		expect(writes(fake.queries)).toEqual([
			'START TRANSACTION',
			'DELETE FROM `mascavo_etl`.`vtex_orders` WHERE `order_id` IN (?)',
			'INSERT INTO `mascavo_etl`.`vtex_orders` (`order_id`, `status`, `created_at`, `updated_at`) VALUES ?',
			'COMMIT'
		])
		expect(results).toHaveLength(1)
	})

	it.each(['failed_jobs', 'telescope_entries', 'migrations', 'users', 'health_check_result_history_items'])(
		'recusa declarar tabela do Laravel: %s',
		table => {
			expect(() => createWriter({ database: 'mascavo_etl', tables: [table], dryRun: false })).toThrow(SafetyError)
		}
	)

	it('recusa banco fora de mascavo_etl e amobeleza_etl', () => {
		expect(() => createWriter({ database: 'mysql', tables: ['user'], dryRun: false })).toThrow(SafetyError)
	})

	it('recusa gravar tabela fora da lista do job e desfaz a transação', async () => {
		const fake = fakeSource('present')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_orders'], dryRun: false },
			{ source: fake.source, now }
		)

		await expect(writer.transaction(tx => tx.replaceAll('vtex_products', [{ id: 1 }]))).rejects.toThrow(SafetyError)

		expect(fake.queries.filter(sql => /^(INSERT|DELETE)/.test(sql))).toEqual([])
		expect(fake.queries).toContain('ROLLBACK')
		expect(fake.queries).not.toContain('COMMIT')
	})

	it('erro no meio da carga desfaz tudo (ROLLBACK, sem COMMIT)', async () => {
		const fake = fakeSource('present')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_orders'], dryRun: false },
			{ source: fake.source, now }
		)

		await expect(
			writer.transaction(async tx => {
				await tx.replaceByKeys('vtex_orders', 'order_id', ['1-01'], [{ order_id: '1-01' }])
				throw new Error('falha na transformação')
			})
		).rejects.toThrow('falha na transformação')

		expect(fake.queries).toContain('ROLLBACK')
		expect(fake.queries).not.toContain('COMMIT')
	})

	it('dry-run não abre conexão nenhuma', async () => {
		const fake = fakeSource('present')
		const writer = createWriter(
			{ database: 'amobeleza_etl', tables: ['vtex_orders'], dryRun: true },
			{ source: fake.source, now }
		)

		const { results } = await writer.transaction(tx =>
			tx.replaceByKeys('vtex_orders', 'order_id', ['1-01'], [{ order_id: '1-01' }])
		)

		expect(fake.connections()).toBe(0)
		expect(results[0]).toMatchObject({ table: 'vtex_orders', inserted: 1, dryRun: true })
	})

	it('dry-run também recusa tabela fora da lista', async () => {
		const writer = createWriter({ database: 'amobeleza_etl', tables: ['vtex_orders'], dryRun: true })

		await expect(writer.transaction(tx => tx.replaceAll('failed_jobs', []))).rejects.toThrow(SafetyError)
	})

	it('replaceDateWindow recusa linha fora da janela antes de apagar', async () => {
		const fake = fakeSource('present')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['sheets_google_drive_trafego'], dryRun: false },
			{ source: fake.source, now }
		)

		await expect(
			writer.transaction(tx =>
				tx.replaceDateWindow('sheets_google_drive_trafego', 'date', '2026-11-01', '2026-11-03', [
					{ date: '2026-11-04' }
				])
			)
		).rejects.toThrow(/fora da janela/)

		expect(fake.queries.filter(sql => sql.startsWith('DELETE'))).toEqual([])
	})

	it('upsert nunca sobrescreve created_at', async () => {
		const fake = fakeSource('present')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_order_details'], dryRun: false },
			{ source: fake.source, now }
		)

		await writer.transaction(tx =>
			tx.upsert('vtex_order_details', [{ order_id: '1-01', status: 'invoiced' }], { keyColumns: ['order_id'] })
		)

		const insert = fake.queries.find(sql => sql.startsWith('INSERT')) ?? ''

		expect(insert).toContain(
			'ON DUPLICATE KEY UPDATE `status` = VALUES(`status`), `updated_at` = VALUES(`updated_at`)'
		)
		expect(insert).not.toContain('`created_at` = VALUES')
		expect(insert).not.toContain('`order_id` = VALUES')
	})
})
