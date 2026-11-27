import mysql, { type Pool } from 'mysql2/promise'

import { getEnv } from '../../config/index.js'
import { NotConfiguredError } from '../errors.js'

/**
 * Dois pools separados, de propósito:
 * - target: banco de DESTINO das cargas. MySQL local por padrão; no TARGET_MODE=production, o banco da cliente, com TLS.
 *   O env só aceita o host do modo e o target-guard confere a identidade do destino antes de gravar.
 * - ref: MySQL da CLIENTE, só para leitura (schema:pull e paridade), com TLS. Só é usado pelo ref-reader, que abre
 *   transação READ ONLY e recusa SQL que não seja SELECT/SHOW.
 *
 * `timezone: 'Z'` faz o mysql2 converter Date em UTC — as datas da VTEX ficam em UTC no banco (o Power BI subtrai 3 h).
 * `multipleStatements: false` impede dois comandos numa string só.
 */

let targetPool: Pool | null = null
let refPool: Pool | null = null

const POOL_CONNECTION_LIMIT = 4
const CONNECT_TIMEOUT_MS = 10_000

/**
 * TLS com o MySQL da cliente (destino no modo produção e leitor da paridade): a conexão sai da VPS pela internet e leva
 * dado pessoal. Se o servidor não aceitar TLS, o mysql2 recusa conectar.
 *
 * O servidor usa o certificado padrão do MySQL (`server-cert.pem`, autoassinado, sem o IP no certificado), então o
 * certificado não é validado: a cifra protege contra quem só escuta a rede, não contra quem se passa pelo servidor. Quando
 * a cliente tiver um certificado próprio, passar o CA aqui e ligar `rejectUnauthorized` (AMO-Q51, 27/11/2026).
 */
const CLIENT_DB_TLS = { rejectUnauthorized: false, minVersion: 'TLSv1.2' } as const

const getTargetPool = (): Pool => {
	if (targetPool) return targetPool

	const env = getEnv()

	if (!env.TARGET_DB_USER || !env.TARGET_DB_PASSWORD) {
		throw new NotConfiguredError(
			'Banco de destino sem usuário/senha (TARGET_DB_USER, TARGET_DB_PASSWORD). Veja .env.example e o docker-compose.'
		)
	}

	targetPool = mysql.createPool({
		host: env.TARGET_DB_HOST,
		port: env.TARGET_DB_PORT,
		user: env.TARGET_DB_USER,
		password: env.TARGET_DB_PASSWORD,
		connectionLimit: POOL_CONNECTION_LIMIT,
		connectTimeout: CONNECT_TIMEOUT_MS,
		timezone: 'Z',
		charset: 'utf8mb4',
		multipleStatements: false,
		dateStrings: false,
		...(env.TARGET_MODE === 'production' ? { ssl: CLIENT_DB_TLS } : {})
	})

	return targetPool
}

const isRefConfigured = (): boolean => {
	const env = getEnv()

	return Boolean(env.REF_DB_HOST && env.REF_DB_USER && env.REF_DB_PASSWORD)
}

const getRefPool = (): Pool => {
	if (refPool) return refPool

	const env = getEnv()

	if (!env.REF_DB_HOST || !env.REF_DB_USER || !env.REF_DB_PASSWORD) {
		throw new NotConfiguredError(
			'Banco de referência não configurado (REF_DB_*). Aguarde o usuário só leitura da cliente; o root nunca é usado.'
		)
	}

	refPool = mysql.createPool({
		host: env.REF_DB_HOST,
		port: env.REF_DB_PORT,
		user: env.REF_DB_USER,
		password: env.REF_DB_PASSWORD,
		connectionLimit: 2,
		connectTimeout: CONNECT_TIMEOUT_MS,
		timezone: 'Z',
		charset: 'utf8mb4',
		multipleStatements: false,
		// Strings em vez de Date: a paridade compara o valor exatamente como está gravado.
		dateStrings: true,
		ssl: CLIENT_DB_TLS
	})

	return refPool
}

const closePools = async (): Promise<void> => {
	const pools = [targetPool, refPool].filter((pool): pool is Pool => pool !== null)

	targetPool = null
	refPool = null
	await Promise.all(pools.map(pool => pool.end()))
}

export { closePools, getRefPool, getTargetPool, isRefConfigured }
