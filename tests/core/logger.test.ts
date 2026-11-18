import { Writable } from 'node:stream'

import { pino } from 'pino'
import { describe, expect, it } from 'vitest'

import { REDACT_PATHS } from '../../src/config/logger.js'

/** Logger com o mesmo redact do getLogger, escrevendo numa lista em vez do stdout. */
const captureLogger = () => {
	const lines: string[] = []
	const stream = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			lines.push(chunk.toString())
			callback()
		}
	})
	const logger = pino({ level: 'info', redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, stream)

	return { logger, lines }
}

/** Erro como o do mysql2: mensagem do MySQL + `sql` com os valores do INSERT. */
const mysqlError = () =>
	Object.assign(new Error("Column 'type' cannot be null"), {
		code: 'ER_BAD_NULL_ERROR',
		sql: "INSERT INTO `mascavo_etl`.`vtex_client_profile` (`email`) VALUES ('cliente@exemplo.com')"
	})

describe('logger: redact', () => {
	it('esconde o SQL com valores de um erro de gravação (err.sql)', () => {
		const { logger, lines } = captureLogger()

		logger.error({ err: mysqlError() }, 'Carga falhou')

		const output = lines.join('')

		expect(output).not.toContain('cliente@exemplo.com')
		expect(JSON.parse(lines[0] ?? '{}').err.sql).toBe('[REDACTED]')
		// O resto do erro continua útil para depurar.
		expect(output).toContain('ER_BAD_NULL_ERROR')
		expect(output).toContain("Column 'type' cannot be null")
	})

	it('esconde o SQL de um erro do mysql2 que vem dentro de outro objeto', () => {
		const { logger, lines } = captureLogger()

		logger.error({ falha: { causa: mysqlError() } }, 'Carga falhou')

		expect(lines.join('')).not.toContain('cliente@exemplo.com')
	})

	it('continua escondendo as credenciais das fontes', () => {
		const { logger, lines } = captureLogger()

		logger.info({ request: { headers: { 'X-VTEX-API-AppToken': 'segredo-de-teste' } } }, 'GET')

		expect(lines.join('')).not.toContain('segredo-de-teste')
	})
})
