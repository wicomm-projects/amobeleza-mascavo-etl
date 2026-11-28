import { parseArgs } from 'node:util'

import 'dotenv/config'

import { getEnv, getTargetMode, isBrand, type tBrand } from './config/index.js'

/**
 * CLI do ETL: `npm run etl -- <comando> [opções]`. Roda `npm run etl -- help` para a lista.
 *
 * Só `run` grava, e só no destino do modo (TARGET_MODE): Docker local por padrão; banco da cliente com o wicomm_etl no
 * modo produção. Os que leem a produção (schema:pull, parity, check-access do banco de
 * referência) só leem, pelo ref-reader.
 */

const out = (line = '') => process.stdout.write(`${line}\n`)

const HELP = `
ETL Amobeleza + Mascavo

Uso: npm run etl -- <comando> [opções]

  sources                         Fontes × marca: configurada ou aguardando chave
  jobs                            Lista os jobs registrados e as tabelas de cada um
  check-access [--source s] [--brand b]
                                  Uma leitura mínima por credencial (sem trazer dado). Inclui o banco local e o de referência
  db:apply                        Recria no Docker LOCAL as tabelas de db/schema/** (confere o marcador local)
  schema:pull                     Lê SHOW CREATE TABLE na produção (só leitura) das tabelas dos jobs → db/schema/
  run <job> [--brand b] [--from AAAA-MM-DD] [--to AAAA-MM-DD] [--dry-run] [--fixture arquivo.json]
                                  Executa uma carga (destino do TARGET_MODE: Docker local, ou produção com wicomm_etl)
  parity <job> [--brand b] [--sample N] [--from AAAA-MM-DD] [--to AAAA-MM-DD]
                                  Compara o que o ETL montaria com a produção, só lendo. Relatório em reports/
`

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

const parseDay = (value: string | undefined, endOfDay: boolean): Date | undefined => {
	if (value === undefined) return undefined

	if (!ISO_DATE.test(value)) throw new Error(`Data inválida: ${value} (use AAAA-MM-DD)`)

	return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`)
}

const parseBrand = (value: string | undefined): tBrand | undefined => {
	if (value === undefined) return undefined

	if (!isBrand(value)) throw new Error(`Marca inválida: ${value} (mascavo ou amobeleza)`)

	return value
}

const commandSources = async () => {
	const { listSourceStatus, referenceDbStatus } = await import('./core/sources-status.js')

	for (const status of listSourceStatus()) {
		const who = status.brand ? `${status.label} (${status.brand})` : `${status.label} (global)`
		const state = status.configured ? 'configurada' : 'aguardando chave'
		const jobs = status.jobs.length > 0 ? status.jobs.join(', ') : `sem jobs ainda (fase ${status.phase})`

		out(`${who.padEnd(34)} ${state.padEnd(18)} ${jobs}`)
	}

	out(
		`${'Banco de referência (cliente)'.padEnd(34)} ${referenceDbStatus().configured ? 'configurado' : 'aguardando usuário só leitura'}`
	)
	out(
		`${'Destino das cargas'.padEnd(34)} ${getTargetMode() === 'production' ? 'PRODUÇÃO da cliente (wicomm_etl)' : 'MySQL local (Docker)'}`
	)
	out(`${'Bancos liberados'.padEnd(34)} ${getEnv().TARGET_DATABASES.join(', ')} (TARGET_DATABASES)`)
	out(
		`${'Jobs liberados'.padEnd(34)} ${getEnv().TARGET_JOBS?.join(', ') ?? 'todos dos bancos liberados'} (TARGET_JOBS)`
	)
	out(
		`${'Contas do AnyMarket'.padEnd(34)} ${getEnv().ANYMARKET_ACCOUNTS?.join(', ') ?? 'todas'} (ANYMARKET_ACCOUNTS)`
	)

	return 0
}

const commandJobs = async () => {
	const { allJobs, brandsOf, tablesOf } = await import('./core/jobs/registry.js')
	const jobs = allJobs()

	if (jobs.length === 0) {
		out('Nenhum job registrado ainda. Os conectores entram nas fases 1 (VTEX), 3 (GA4) e 6 (AnyMarket).')

		return 0
	}

	for (const job of jobs) {
		out(`${job.name.padEnd(22)} ${job.scope.padEnd(7)} ${job.schedule ?? 'manual'}`)

		for (const brand of brandsOf(job)) {
			out(`  ${(brand ?? 'global').padEnd(10)} ${job.database(brand)}: ${tablesOf(job, brand).join(', ')}`)
		}
	}

	return 0
}

const commandCheckAccess = async (sourceFilter?: string, brandFilter?: tBrand) => {
	const { SOURCES } = await import('./core/jobs/registry.js')
	const { brandsOfSource } = await import('./core/sources-status.js')
	const { checkTarget, createRefReader, isRefConfigured } = await import('./core/db/index.js')
	let failures = 0

	for (const source of SOURCES) {
		if (sourceFilter && source.name !== sourceFilter) continue

		for (const brand of brandsOfSource(source)) {
			if (brandFilter && brand && brand !== brandFilter) continue

			const who = `${source.label}${brand ? ` (${brand})` : ''}`

			if (!source.isConfigured(brand)) {
				out(`${who.padEnd(32)} aguardando chave`)
				continue
			}

			try {
				const result = await source.checkAccess(brand)

				if (!result.ok) failures += 1

				out(`${who.padEnd(32)} ${result.ok ? 'OK' : 'FALHOU'}: ${result.detail}`)
			} catch (err) {
				failures += 1
				out(`${who.padEnd(32)} FALHOU: ${err instanceof Error ? err.message : String(err)}`)
			}
		}
	}

	if (sourceFilter) return failures > 0 ? 1 : 0

	// Banco de destino: confere a identidade do modo atual (Docker local, ou banco da cliente com o wicomm_etl). Não grava.
	const production = getTargetMode() === 'production'
	const targetLabel = (production ? 'Destino: PRODUÇÃO (cliente)' : 'Banco local (Docker)').padEnd(32)

	try {
		await checkTarget()
		out(
			`${targetLabel} OK: ${production ? 'servidor, usuário wicomm_etl e grants conferidos' : 'identidade do Docker local conferida'}`
		)
	} catch (err) {
		if (production) failures += 1

		out(
			`${targetLabel} ${production ? 'FALHOU' : 'indisponível'}: ${err instanceof Error ? err.message : String(err)}`
		)
	}

	// Banco de referência (produção): o reader confere SHOW GRANTS (só leitura, sem role) antes do SELECT 1 e recusa
	// trabalhar se o usuário puder gravar. Qualquer recusa conta como falha (sai com 1).
	if (!isRefConfigured()) {
		out(`${'Banco de referência (cliente)'.padEnd(32)} aguardando usuário só leitura`)

		return failures > 0 ? 1 : 0
	}

	try {
		await createRefReader().query('SELECT 1 AS ok')
		out(`${'Banco de referência (cliente)'.padEnd(32)} OK: usuário só leitura, sessão READ ONLY`)
	} catch (err) {
		failures += 1
		out(`${'Banco de referência (cliente)'.padEnd(32)} FALHOU: ${err instanceof Error ? err.message : String(err)}`)
	}

	return failures > 0 ? 1 : 0
}

const commandDbApply = async () => {
	const { applySchemas, listSchemaFiles } = await import('./core/db/index.js')
	const files = await listSchemaFiles()

	if (files.length === 0) {
		out('Nenhum arquivo em db/schema/ ainda. Cada conector traz as suas tabelas.')

		return 0
	}

	const applied = await applySchemas(files)

	out(`Recriadas no Docker local: ${applied.length} tabela(s)`)
	applied.forEach(table => out(`  ${table}`))

	return 0
}

const commandSchemaPull = async () => {
	const { tablesByDatabase } = await import('./core/jobs/registry.js')
	const { createRefReader } = await import('./core/db/index.js')
	const { pullSchemas } = await import('./core/db/index.js')
	const tables = tablesByDatabase()

	if (tables.size === 0) {
		out('Nenhuma tabela registrada pelos jobs ainda; nada a ler.')

		return 0
	}

	const written = await pullSchemas(createRefReader(), tables)

	out(`Estrutura lida da produção (só leitura): ${written.length} arquivo(s)`)
	written.forEach(file => out(`  ${file}`))

	return 0
}

const commandRun = async (jobName: string | undefined, values: Record<string, unknown>) => {
	const { findJob } = await import('./core/jobs/registry.js')
	const { runJob } = await import('./core/jobs/runner.js')

	if (!jobName) throw new Error('Informe o job: npm run etl -- run <job>')

	const job = findJob(jobName)

	if (!job) throw new Error(`Job desconhecido: ${jobName}. Veja npm run etl -- jobs`)

	if (getTargetMode() === 'production')
		out('Destino: PRODUÇÃO da cliente (TARGET_MODE=production, usuário wicomm_etl)')

	const record = await runJob({
		job,
		brand: parseBrand(values.brand as string | undefined),
		options: {
			from: parseDay(values.from as string | undefined, false),
			to: parseDay(values.to as string | undefined, true),
			dryRun: Boolean(values['dry-run']),
			fixture: values.fixture as string | undefined
		}
	})

	out(
		`${record.job}${record.brand ? ` (${record.brand})` : ''}: ${record.state}${record.message ? ` — ${record.message}` : ''}`
	)

	for (const [table, rows] of Object.entries(record.rowsByTable ?? {})) {
		out(`  ${table}: ${rows} linha(s)${record.dryRun ? ' (dry-run, nada gravado)' : ''}`)
	}

	return record.state === 'failed' ? 1 : 0
}

const commandParity = async (jobName: string | undefined, values: Record<string, unknown>) => {
	const { findJob } = await import('./core/jobs/registry.js')
	const { createRefReader } = await import('./core/db/index.js')
	const { getLogger } = await import('./config/index.js')

	if (!jobName) throw new Error('Informe o job: npm run etl -- parity <job>')

	const job = findJob(jobName)

	if (!job) throw new Error(`Job desconhecido: ${jobName}`)

	if (!job.parity) {
		out(`O job ${job.name} ainda não tem paridade implementada.`)

		return 0
	}

	const brand = parseBrand(values.brand as string | undefined)
	const summary = await job.parity({
		brand,
		database: job.database(brand),
		logger: getLogger().child({ job: job.name, brand, mode: 'parity' }),
		refReader: createRefReader(),
		options: {
			sample: Number(values.sample ?? 200),
			from: parseDay(values.from as string | undefined, false),
			to: parseDay(values.to as string | undefined, true)
		}
	})

	for (const table of summary.tables) {
		out(`${table.table.padEnd(44)} comparadas ${table.compared}  divergentes ${table.divergent}`)
	}

	for (const note of summary.notes ?? []) out(note)

	out(`Relatório completo: ${summary.reportPath}`)

	return 0
}

const main = async (): Promise<number> => {
	const { positionals, values } = parseArgs({
		allowPositionals: true,
		options: {
			'brand': { type: 'string' },
			'source': { type: 'string' },
			'from': { type: 'string' },
			'to': { type: 'string' },
			'sample': { type: 'string' },
			'fixture': { type: 'string' },
			'dry-run': { type: 'boolean' },
			'help': { type: 'boolean' }
		}
	})
	const [command, argument] = positionals

	if (!command || command === 'help' || values.help) {
		out(HELP)

		return 0
	}

	getEnv()

	switch (command) {
		case 'sources':
			return commandSources()
		case 'jobs':
			return commandJobs()
		case 'check-access':
			return commandCheckAccess(values.source, parseBrand(values.brand))
		case 'db:apply':
			return commandDbApply()
		case 'schema:pull':
			return commandSchemaPull()
		case 'run':
			return commandRun(argument, values)
		case 'parity':
			return commandParity(argument, values)
		default:
			out(`Comando desconhecido: ${command}`)
			out(HELP)

			return 2
	}
}

main()
	.then(async code => {
		const { closePools } = await import('./core/db/index.js')

		await closePools()
		process.exit(code)
	})
	.catch(async err => {
		process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
		const { closePools } = await import('./core/db/index.js')

		await closePools().catch(() => undefined)
		process.exit(1)
	})
