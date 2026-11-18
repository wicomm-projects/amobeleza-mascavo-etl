import { defineConfig } from 'vitest/config'

/**
 * Testes de integração: exigem o MySQL LOCAL do docker-compose (npm run db:up). Não rodam no `npm test`.
 * Se o Docker não estiver de pé, falham — de propósito, para não "passar" sem provar nada.
 */
export default defineConfig({
	test: {
		include: ['tests/integration/**/*.test.ts'],
		environment: 'node',
		fileParallelism: false,
		env: {
			NODE_ENV: 'test',
			LOG_LEVEL: 'silent',
			TARGET_DB_HOST: '127.0.0.1',
			TARGET_DB_PORT: '3307',
			TARGET_DB_USER: 'etl_local',
			TARGET_DB_PASSWORD: 'etl_local_dev'
		}
	}
})
