/**
 * Os dois bancos da cliente que o ETL alimenta. Módulo próprio, sem dependência, para o env (que valida
 * TARGET_DATABASES) e as marcas (brands.ts, que importa o env) usarem a mesma lista sem import circular.
 */
const DATABASES = ['mascavo_etl', 'amobeleza_etl'] as const

type tDatabase = (typeof DATABASES)[number]

export { DATABASES }
export type { tDatabase }
