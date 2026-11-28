import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'

import { resetEnvCache } from '../../src/config/env.js'
import { anymarketOrdersJob, isAccountAllowed } from '../../src/connectors/anymarket/orders-job.js'
import type { iWriteResult, iWriteTx, iWriter } from '../../src/core/db/writer.js'

const AMOBELEZA_ACCOUNTS = [
	'AMOBELEZA',
	'Amobeleza',
	'AMOBELEZACOMERCIODIGITALE',
	'Beleza na Web',
	'Itau',
	'VinkloByFestalab'
]

describe('AnyMarket: filtro por conta (ANYMARKET_ACCOUNTS)', () => {
	it('sem filtro ou com "*": todas as contas', () => {
		expect(isAccountAllowed('AMOBELEZA', undefined)).toBe(true)
		expect(isAccountAllowed('AMOBELEZA', ['*'])).toBe(true)
	})

	it('só MASCAVO: as contas da Amobeleza ficam de fora', () => {
		for (const account of AMOBELEZA_ACCOUNTS) expect(isAccountAllowed(account, ['MASCAVO'])).toBe(false)

		expect(isAccountAllowed('MASCAVO', ['MASCAVO'])).toBe(true)
	})

	it('compara como a coluna do MySQL (utf8mb4_unicode_ci): sem diferença de maiúscula e de espaço no fim', () => {
		// O Power BI filtra account_name = 'MASCAVO'; na collation da coluna, "Mascavo" e "MASCAVO " também casam.
		expect(isAccountAllowed('Mascavo', ['MASCAVO'])).toBe(true)
		expect(isAccountAllowed('MASCAVO ', ['MASCAVO'])).toBe(true)
		expect(isAccountAllowed('MASCAVO2', ['MASCAVO'])).toBe(false)
	})
})

/** Writer falso: guarda as chaves que cada gravação recebeu, sem banco. */
const fakeWriter = () => {
	const writes: { table: string; keys: (string | number)[] }[] = []
	const ok = (table: string): iWriteResult =>
		({
			database: 'amobeleza_etl',
			table,
			strategy: 'upsert',
			deleted: 0,
			inserted: 0,
			dryRun: false
		}) as iWriteResult
	const tx = {
		upsert: async (table: string, rows: Record<string, unknown>[]) => {
			writes.push({ table, keys: rows.map(row => row.id as number) })

			return ok(table)
		},
		replaceByKeys: async (table: string, _key: string, keys: readonly (string | number)[]) => {
			writes.push({ table, keys: [...keys] })

			return ok(table)
		}
	} as unknown as iWriteTx
	const writer: iWriter = {
		database: 'amobeleza_etl',
		dryRun: false,
		transaction: async work => ({ value: await work(tx), results: [] })
	}

	return { writer, writes }
}

describe('AnyMarket: o job inteiro grava só a conta liberada', () => {
	let dir: string | undefined

	afterEach(async () => {
		delete process.env.ANYMARKET_ACCOUNTS
		resetEnvCache()

		if (dir) await rm(dir, { recursive: true, force: true })
	})

	it('página com MASCAVO e AMOBELEZA: só o pedido da MASCAVO chega às tabelas', async () => {
		const page = JSON.parse(
			await readFile(path.resolve('src/connectors/anymarket/fixtures/orders-page.json'), 'utf8')
		) as { content: Record<string, unknown>[] }
		const base = page.content[0] as Record<string, unknown>

		page.content = [
			{ ...base, id: 101, accountName: 'MASCAVO' },
			{ ...base, id: 102, accountName: 'AMOBELEZA' }
		]
		dir = await mkdtemp(path.join(tmpdir(), 'anymarket-'))

		const file = path.join(dir, 'page.json')

		await writeFile(file, JSON.stringify(page))
		process.env.ANYMARKET_ACCOUNTS = 'MASCAVO'
		resetEnvCache()

		const { writer, writes } = fakeWriter()
		const summary = await anymarketOrdersJob.run({
			database: 'amobeleza_etl',
			logger: pino({ level: 'silent' }),
			writer,
			options: { dryRun: false, fixture: file }
		})

		expect(writes.length).toBeGreaterThan(0)

		for (const write of writes) expect(write.keys).toEqual([101])

		expect(summary.notes?.join(' ')).toMatch(/1 pedido\(s\) de contas fora de ANYMARKET_ACCOUNTS/)
	})
})
