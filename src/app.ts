import express, { type Express } from 'express'

import { getEnv } from './config/index.js'
import { listRuns } from './core/jobs/status.js'
import { listSourceStatus, referenceDbStatus } from './core/sources-status.js'

/**
 * Express só para consulta: /health e /status. Nenhuma rota grava ou dispara carga — o ETL roda pelo agendador ou pelo
 * CLI. O servidor escuta só em loopback (o env recusa outro HOST); na VPS, consulta via túnel SSH.
 */
const createApp = (): Express => {
	const app = express()
	const startedAt = Date.now()

	app.disable('x-powered-by')

	app.get('/health', (_req, res) => {
		res.json({
			status: 'ok',
			uptimeSec: Math.round((Date.now() - startedAt) / 1000),
			scheduler: getEnv().SCHEDULER_ENABLED,
			referenceDb: referenceDbStatus(),
			sources: listSourceStatus()
		})
	})

	app.get('/status', (_req, res) => {
		res.json({ runs: listRuns() })
	})

	app.use((_req, res) => {
		res.status(404).json({ error: 'not_found' })
	})

	return app
}

export { createApp }
