import 'dotenv/config'

import { getEnv, getLogger } from './config/index.js'

// Fail-fast: valida o env antes de importar o resto. Env inválido (ex.: usuário root, destino fora do local) → não sobe.
let env: ReturnType<typeof getEnv>

try {
	env = getEnv()
} catch (err) {
	// Sem env válido ainda não há logger: stderr é o canal de último recurso.
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
	process.exit(1)
}

// Tudo que é assíncrono fica em main(), sem top-level await (mesmo padrão do bff-givex).
async function main() {
	const { createApp } = await import('./app.js')
	const { startScheduler, stopScheduler } = await import('./core/jobs/scheduler.js')
	const { closePools } = await import('./core/db/index.js')

	const logger = getLogger()
	const app = createApp()

	const server = app.listen(env.PORT, env.HOST, () => {
		logger.info({ host: env.HOST, port: env.PORT, scheduler: env.SCHEDULER_ENABLED }, 'ETL no ar')
	})

	if (env.SCHEDULER_ENABLED) {
		const scheduled = startScheduler()

		logger.info({ scheduled }, 'Agendador ligado')
	} else {
		logger.info('Agendador desligado (SCHEDULER_ENABLED=false): cargas só pelo CLI')
	}

	const shutdown = async (signal: string) => {
		logger.info({ signal }, 'Desligando')
		await stopScheduler()
		server.close()
		await closePools()
		process.exit(0)
	}

	process.on('SIGINT', () => void shutdown('SIGINT'))
	process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

main().catch(err => {
	process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
	process.exit(1)
})
