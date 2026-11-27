/**
 * Identidade do MySQL de PRODUÇÃO da cliente, o único destino aceito fora do Docker local (modo `TARGET_MODE=production`).
 *
 * O endereço (host) fica só no `.env` da VPS, fora do Git. Quem garante que o destino é o banco da cliente é o servidor:
 * o target-guard confere `@@hostname` e `@@server_uuid` na mesma conexão que vai gravar, então um `.env` apontando para
 * outro servidor (ou um túnel) é recusado antes de qualquer gravação. Se a cliente trocar o banco de máquina, o uuid
 * muda, o ETL para de gravar (falha visível) e a mudança vira um PR revisado.
 *
 * - `port`: porta que o `.env` da VPS precisa ter em `TARGET_DB_PORT`.
 * - `user`: o usuário de gravação criado em 27/11/2026 por `ops/mysql/usuario-wicomm-etl.sql`.
 * - `hostname`/`serverUuid`: `SELECT @@hostname, @@server_uuid` na produção, lidos em 27/11/2026.
 */
const PRODUCTION_TARGET = {
	port: 3306,
	user: 'wicomm_etl',
	hostname: 'srvgnr-mysql',
	serverUuid: '13e248a0-f5a1-11f0-877b-00155d6dc208'
} as const

export { PRODUCTION_TARGET }
