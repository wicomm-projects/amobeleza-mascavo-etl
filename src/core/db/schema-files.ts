import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import mysql from 'mysql2/promise'

import type { tDatabase } from '../../config/index.js'
import { AppError, SafetyError } from '../errors.js'

import { fromPool, type iConnectionSource } from './connection.js'
import { getTargetPool } from './pools.js'
import type { iRefReader } from './ref-reader.js'
import { isLaravelTable, isSafeIdentifier } from './tables.js'
import { assertLocalTarget, assertTargetDatabase } from './target-guard.js'

/**
 * Estrutura das tabelas em db/schema/<banco>/<tabela>.sql — um CREATE TABLE por arquivo, só estrutura, nunca dado.
 *
 * - `pullSchemas` (schema:pull): lê SHOW CREATE TABLE na produção, pelo ref-reader (só leitura), e grava os arquivos.
 *   Enquanto não houver usuário de leitura, os arquivos são provisórios, escritos a partir do dicionário da WPP.
 * - `applySchemas` (db:apply): recria as tabelas no Docker LOCAL. Confere o marcador local antes de qualquer DROP.
 */

const SCHEMA_DIR = path.join('db', 'schema')

interface iSchemaFile {
	database: tDatabase
	table: string
	file: string
}

const listSchemaFiles = async (root: string = SCHEMA_DIR): Promise<iSchemaFile[]> => {
	const files: iSchemaFile[] = []
	const databases = await readdir(root, { withFileTypes: true }).catch(() => [])

	for (const entry of databases) {
		if (!entry.isDirectory()) continue

		const database = assertTargetDatabase(entry.name)
		const tables = await readdir(path.join(root, entry.name))

		for (const name of tables.filter(file => file.endsWith('.sql')).sort()) {
			files.push({ database, table: name.replace(/\.sql$/, ''), file: path.join(root, entry.name, name) })
		}
	}

	return files
}

/** Remove linhas de comentário (`--`) e devolve o único CREATE TABLE do arquivo, sem `;` final. */
const parseSchemaFile = (content: string, table: string): string => {
	const body = content
		.split(/\r?\n/)
		.filter(line => !line.trimStart().startsWith('--'))
		.join('\n')
		.trim()
		.replace(/;\s*$/, '')

	const header = new RegExp(`^CREATE TABLE \`?${table}\`?\\s*\\(`, 'i')

	if (!header.test(body)) throw new AppError(`${table}.sql precisa começar com CREATE TABLE \`${table}\` (`)

	if (body.includes(';')) throw new AppError(`${table}.sql tem mais de um comando; só um CREATE TABLE por arquivo.`)

	return body
}

const applySchemas = async (
	files: iSchemaFile[],
	source: iConnectionSource = fromPool(getTargetPool)
): Promise<string[]> => {
	const connection = await source.getConnection()
	const applied: string[] = []

	try {
		// Trava: db:apply apaga e recria tabelas, então só roda no Docker local.
		await assertLocalTarget(connection)

		for (const { database, table, file } of files) {
			if (!isSafeIdentifier(table) || isLaravelTable(table))
				throw new SafetyError(`Arquivo de schema recusado: ${file}`)

			const ddl = parseSchemaFile(await readFile(file, 'utf8'), table)

			await connection.query(`USE ${mysql.escapeId(database)}`)
			await connection.query(`DROP TABLE IF EXISTS ${mysql.escapeId(table)}`)
			await connection.query(ddl)
			applied.push(`${database}.${table}`)
		}
	} finally {
		connection.release()
	}

	return applied
}

/** Tira o contador de AUTO_INCREMENT, que muda a cada carga e só geraria diff no Git. */
const normalizeDdl = (ddl: string): string => ddl.replace(/\s+AUTO_INCREMENT=\d+/i, '')

const pullSchemas = async (
	reader: iRefReader,
	tablesByDatabase: Map<tDatabase, Set<string>>,
	root: string = SCHEMA_DIR
): Promise<string[]> => {
	const written: string[] = []
	const today = new Date().toISOString().slice(0, 10)

	for (const [database, tables] of tablesByDatabase) {
		await mkdir(path.join(root, database), { recursive: true })

		for (const table of [...tables].sort()) {
			const ddl = normalizeDdl(await reader.showCreateTable(database, table, tables))
			const file = path.join(root, database, `${table}.sql`)

			await writeFile(file, `-- Gerado por schema:pull em ${today}. Só estrutura, sem dado.\n${ddl};\n`, 'utf8')
			written.push(file)
		}
	}

	return written
}

export { applySchemas, listSchemaFiles, normalizeDdl, parseSchemaFile, pullSchemas }
export type { iSchemaFile }
