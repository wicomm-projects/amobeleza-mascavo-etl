import { describe, expect, it } from 'vitest'

import type { iConnectionSource } from '../../src/core/db/connection.js'
import { applySchemas, normalizeDdl, parseSchemaFile } from '../../src/core/db/schema-files.js'
import { SafetyError } from '../../src/core/errors.js'

describe('arquivos de schema', () => {
	it('aceita um único CREATE TABLE com comentários de cabeçalho', () => {
		const ddl = parseSchemaFile(
			'-- provisório\nCREATE TABLE `vtex_orders` (\n  order_id varchar(255)\n);\n',
			'vtex_orders'
		)

		expect(ddl).toBe('CREATE TABLE `vtex_orders` (\n  order_id varchar(255)\n)')
	})

	it('recusa arquivo com mais de um comando', () => {
		expect(() => parseSchemaFile('CREATE TABLE `a` (id int); DROP TABLE `b`;', 'a')).toThrow(/mais de um comando/)
	})

	it('recusa arquivo cujo CREATE TABLE não é da tabela do nome do arquivo', () => {
		expect(() => parseSchemaFile('CREATE TABLE `outra` (id int);', 'vtex_orders')).toThrow(/CREATE TABLE/)
	})

	it('tira o contador de AUTO_INCREMENT do DDL da produção', () => {
		expect(normalizeDdl(') ENGINE=InnoDB AUTO_INCREMENT=223292 DEFAULT CHARSET=utf8mb4')).toBe(
			') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
		)
	})

	it('db:apply recusa rodar sem o marcador do banco local, antes de qualquer DROP', async () => {
		const queries: string[] = []
		const source: iConnectionSource = {
			getConnection: async () => ({
				query: async (sql: string) => {
					queries.push(sql)

					return [[], []]
				},
				release: () => undefined
			})
		}

		await expect(
			applySchemas([{ database: 'mascavo_etl', table: 'vtex_orders', file: 'x.sql' }], source)
		).rejects.toThrow(SafetyError)
		expect(queries.some(sql => sql.startsWith('DROP'))).toBe(false)
	})
})
