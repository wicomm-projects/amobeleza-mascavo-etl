import { defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		include: ['tests/**/*.test.ts'],
		environment: 'node',
		// Os testes nunca leem o .env real: cada teste monta o ambiente que precisa.
		env: { NODE_ENV: 'test', LOG_LEVEL: 'silent' }
	}
})
