import { describe, expect, it } from 'vitest'

import { guardedTargetSource } from '../../src/core/db/guarded.js'
import { assertLocalGrants } from '../../src/core/db/target-guard.js'
import { createWriter } from '../../src/core/db/writer.js'
import { SafetyError } from '../../src/core/errors.js'

import { fakeTarget, type tTargetScenario } from './fakes.js'

const writes = (queries: string[]) => queries.filter(sql => /^(INSERT|DELETE|START|COMMIT)/.test(sql))

const now = () => new Date('2026-11-18T12:00:00.000Z')

const NOT_LOCAL: tTargetScenario[] = [
	'no-marker',
	'missing-marker-table',
	'other-host',
	'other-user',
	'global-privileges',
	'can-write-marker'
]

describe('writer: só grava no Docker local', () => {
	it.each(NOT_LOCAL)('destino que não é o Docker local (%s): recusa e não grava nada', async scenario => {
		const fake = fakeTarget(scenario)
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_orders'], dryRun: false },
			{ source: fake.source, now }
		)

		await expect(
			writer.transaction(tx => tx.replaceByKeys('vtex_orders', 'order_id', ['1-01'], [{ order_id: '1-01' }]))
		).rejects.toThrow(SafetyError)

		expect(writes(fake.queries)).toEqual([])
	})

	it('no Docker local: grava dentro de uma transação', async () => {
		const fake = fakeTarget('local')
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

	it.each(NOT_LOCAL)('conexão protegida (usada pelo lock) recusa destino %s', async scenario => {
		const fake = fakeTarget(scenario)

		await expect(guardedTargetSource(fake.source).getConnection()).rejects.toThrow(SafetyError)
		expect(fake.queries.some(sql => sql.includes('GET_LOCK'))).toBe(false)
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
		const fake = fakeTarget('local')
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
		const fake = fakeTarget('local')
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
		const fake = fakeTarget('local')
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

		await expect(writer.transaction(tx => tx.replaceAll('failed_jobs', [{ id: 1 }]))).rejects.toThrow(SafetyError)
	})
})

describe('writer: proteção contra apagar dado por resposta vazia ou janela errada', () => {
	it('replaceAll com lote vazio é recusado antes de apagar', async () => {
		const fake = fakeTarget('local')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_category_tree'], dryRun: false },
			{ source: fake.source, now }
		)

		await expect(writer.transaction(tx => tx.replaceAll('vtex_category_tree', []))).rejects.toThrow(/lote vazio/)
		expect(fake.queries.filter(sql => sql.startsWith('DELETE'))).toEqual([])
	})

	it('replaceAll com lote vazio só passa com allowEmpty explícito', async () => {
		const fake = fakeTarget('local')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['vtex_category_tree'], dryRun: false },
			{ source: fake.source, now }
		)

		await writer.transaction(tx => tx.replaceAll('vtex_category_tree', [], { allowEmpty: true }))
		expect(fake.queries).toContain('DELETE FROM `mascavo_etl`.`vtex_category_tree`')
	})

	it('replaceDateWindow com lote vazio é recusado antes de apagar', async () => {
		const fake = fakeTarget('local')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['sheets_google_drive_trafego'], dryRun: false },
			{ source: fake.source, now }
		)

		await expect(
			writer.transaction(tx =>
				tx.replaceDateWindow('sheets_google_drive_trafego', 'date', '2026-11-01', '2026-11-03', [])
			)
		).rejects.toThrow(/lote vazio/)
		expect(fake.queries.filter(sql => sql.startsWith('DELETE'))).toEqual([])
	})

	it('replaceDateWindow recusa linha fora da janela antes de apagar', async () => {
		const fake = fakeTarget('local')
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

	it('replaceDateWindow apaga até o fim do último dia (serve para DATE e DATETIME)', async () => {
		const fake = fakeTarget('local')
		const writer = createWriter(
			{ database: 'mascavo_etl', tables: ['sheets_google_drive_trafego'], dryRun: false },
			{ source: fake.source, now }
		)

		await writer.transaction(tx =>
			tx.replaceDateWindow('sheets_google_drive_trafego', 'date', '2026-11-01', '2026-11-03', [
				{ date: '2026-11-03 18:00:00' }
			])
		)

		expect(fake.queries).toContain(
			'DELETE FROM `mascavo_etl`.`sheets_google_drive_trafego` WHERE `date` >= ? AND `date` < ?'
		)
	})

	it('upsert nunca sobrescreve created_at', async () => {
		const fake = fakeTarget('local')
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

describe('grants do usuário local', () => {
	it('aceita os grants do Docker (db/init/00-local.sql)', () => {
		expect(() =>
			assertLocalGrants([
				'GRANT USAGE ON *.* TO `etl_local`@`%`',
				'GRANT ALL PRIVILEGES ON `mascavo_etl`.* TO `etl_local`@`%`',
				'GRANT ALL PRIVILEGES ON `amobeleza_etl`.* TO `etl_local`@`%`',
				'GRANT SELECT ON `etl_local_meta`.* TO `etl_local`@`%`'
			])
		).not.toThrow()
	})

	it.each([
		'GRANT ALL PRIVILEGES ON *.* TO `root`@`%` WITH GRANT OPTION',
		'GRANT SELECT ON *.* TO `leitura`@`%`',
		'GRANT INSERT ON `etl_local_meta`.* TO `etl_local`@`%`',
		'GRANT ALL PRIVILEGES ON `outro_banco`.* TO `etl_local`@`%`',
		'GRANT `dba`@`%` TO `etl_local`@`%`'
	])('recusa %s', line => {
		expect(() => assertLocalGrants([line])).toThrow(SafetyError)
	})
})
