import { Writable } from 'node:stream'

import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import { REDACT_PATHS, serializeError } from '../../src/config/logger.js'
import type { iConnectionSource } from '../../src/core/db/connection.js'
import { createWriter } from '../../src/core/db/writer.js'
import { AppError, DatabaseError, SafetyError, sanitizeDbError, sanitizeErrorChain } from '../../src/core/errors.js'

import { fakeTarget } from './fakes.js'

/** Dado pessoal fictício que nunca pode aparecer em erro nem em log. */
const PII = 'joao.silva@exemplo.com'
const DOCUMENT = '123.456.789-00'

/** Imita o erro do mysql2: mensagem do servidor com o valor e o INSERT montado em `sql`. */
const driverError = () =>
	Object.assign(new Error(`Duplicate entry '${PII}' for key 'anymarket_order_buyer.email'`), {
		code: 'ER_DUP_ENTRY',
		errno: 1062,
		sqlState: '23000',
		sqlMessage: `Duplicate entry '${PII}' for key 'anymarket_order_buyer.email'`,
		sql: `INSERT INTO \`amobeleza_etl\`.\`anymarket_order_buyer\` VALUES ('${PII}', '${DOCUMENT}')`
	})

const leaks = (text: string) => text.includes(PII) || text.includes(DOCUMENT)

describe('erro do banco sem dado pessoal', () => {
	it('troca o erro do driver por DatabaseError só com código, número e chave', () => {
		const sanitized = sanitizeDbError(driverError())

		expect(sanitized).toBeInstanceOf(DatabaseError)
		expect((sanitized as Error).message).toBe(
			'Erro do banco ER_DUP_ENTRY (1062): chave anymarket_order_buyer.email'
		)
		expect(leaks(JSON.stringify(sanitized))).toBe(false)
		expect(sanitized).not.toHaveProperty('sql')
		expect(sanitized).not.toHaveProperty('sqlMessage')
		expect((sanitized as Error).cause).toBeUndefined()
	})

	it('guarda o nome da coluna quando o servidor informa', () => {
		const err = Object.assign(new Error("Incorrect integer value: 'abc' for column 'quantity' at row 1"), {
			code: 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
			errno: 1366,
			sql: "INSERT ... ('abc')"
		})

		expect((sanitizeDbError(err) as Error).message).toBe(
			'Erro do banco ER_TRUNCATED_WRONG_VALUE_FOR_FIELD (1366): coluna quantity'
		)
	})

	it('sanitiza a cadeia de causas numa cópia, sem alterar o erro original', () => {
		const inner = driverError()
		const outer = new AppError('carga falhou', { cause: inner })
		const sanitized = sanitizeErrorChain(outer) as Error

		expect(sanitized).not.toBe(outer)
		expect(sanitized).toBeInstanceOf(AppError)
		expect(sanitized.message).toBe('carga falhou')
		expect(sanitized.cause).toBeInstanceOf(DatabaseError)
		expect(outer.cause).toBe(inner)
	})

	it('não mexe em erro que não é do driver', () => {
		const safety = new SafetyError('trava')
		const plain = new Error('falha na transformação')

		expect(sanitizeDbError(safety)).toBe(safety)
		expect(sanitizeDbError(plain)).toBe(plain)
	})

	it('o writer desfaz a transação e sobe o erro sem o dado do comprador', async () => {
		const target = fakeTarget('local')
		const source: iConnectionSource = {
			getConnection: async () => {
				const connection = await target.source.getConnection()

				return {
					...connection,
					query: async (sql: string, params?: unknown[]) => {
						if (sql.startsWith('INSERT')) {
							target.queries.push(sql)
							throw driverError()
						}

						return connection.query(sql, params)
					}
				}
			}
		}
		const writer = createWriter(
			{ database: 'amobeleza_etl', tables: ['anymarket_order_buyer'], dryRun: false },
			{ source }
		)

		const failure = await writer
			.transaction(tx => tx.replaceAll('anymarket_order_buyer', [{ email: PII, document: DOCUMENT }]))
			.catch((err: unknown) => err)

		expect(failure).toBeInstanceOf(DatabaseError)
		expect(leaks(JSON.stringify(failure)) || leaks((failure as Error).message)).toBe(false)
		expect(target.queries).toContain('ROLLBACK')
		expect(target.queries).not.toContain('COMMIT')
	})

	it('o log não leva SQL nem valores, nem com o erro do driver solto ou embrulhado', () => {
		const lines: string[] = []
		const stream = new Writable({
			write(chunk, _encoding, done) {
				lines.push(String(chunk))
				done()
			}
		})
		const logger = pino(
			{ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' }, serializers: { err: serializeError } },
			stream
		)

		logger.error({ err: driverError() }, 'carga falhou')
		logger.error({ err: new AppError('trava', { cause: driverError() }) }, 'carga falhou')
		logger.error({ db: { sql: driverError().sql, sqlMessage: driverError().sqlMessage } }, 'detalhe')

		expect(lines).toHaveLength(3)
		expect(lines.map(leaks)).toEqual([false, false, false])
		expect(lines[0]).toContain('ER_DUP_ENTRY')
	})

	// Casos trazidos do PR #6 (sessão da VTEX, AMO-Q7), que este PR substitui.
	it('esconde o SQL de um erro do driver guardado dentro de outro objeto', () => {
		const lines: string[] = []
		const stream = new Writable({
			write(chunk, _encoding, done) {
				lines.push(String(chunk))
				done()
			}
		})
		const logger = pino(
			{ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' }, serializers: { err: serializeError } },
			stream
		)

		logger.error({ falha: { causa: driverError() } }, 'carga falhou')

		expect(leaks(lines.join(''))).toBe(false)
	})

	it('continua escondendo as credenciais das fontes', () => {
		const lines: string[] = []
		const stream = new Writable({
			write(chunk, _encoding, done) {
				lines.push(String(chunk))
				done()
			}
		})
		const logger = pino(
			{ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' }, serializers: { err: serializeError } },
			stream
		)

		logger.info({ request: { headers: { 'X-VTEX-API-AppToken': 'segredo-de-teste' } } }, 'GET')

		expect(lines.join('')).not.toContain('segredo-de-teste')
	})
})
