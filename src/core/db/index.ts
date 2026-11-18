/**
 * API pública de acesso a banco. Fora de src/core/db, todo código passa por aqui (regra no-restricted-imports do
 * ESLint): não há como abrir conexão crua com o destino ou com a produção sem as travas.
 */
export { rowsOf } from './connection.js'
export type { iConnectionSource, iSqlConnection } from './connection.js'
export { checkLocalTarget, guardedTargetSource } from './guarded.js'
export { closePools, isRefConfigured } from './pools.js'
export { createRefReader } from './ref-reader.js'
export type { iRefReader } from './ref-reader.js'
export { applySchemas, listSchemaFiles, pullSchemas } from './schema-files.js'
export type { iSchemaFile } from './schema-files.js'
export { createWriter } from './writer.js'
export type { iWriteResult, iWriteTx, iWriter, iWriterScope, tRow, tWriteStrategy } from './writer.js'
