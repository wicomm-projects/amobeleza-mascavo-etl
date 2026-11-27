import { afterEach, describe, expect, it } from 'vitest'

import { resetEnvCache } from '../../src/config/env.js'
import { PRODUCTION_TARGET } from '../../src/config/production-target.js'
import { MASK, maskPersonalData } from '../../src/connectors/vtex/personal-data.js'
import { ORDER_TABLES } from '../../src/connectors/vtex/tables.js'
import { SafetyError } from '../../src/core/errors.js'
import { assertRunOptions } from '../../src/core/jobs/runner.js'

describe('runner: --fixture e o modo do destino', () => {
	it('modo produção: --fixture sem --dry-run é recusado (dado de exemplo nunca vai para a cliente)', () => {
		expect(() => assertRunOptions({ dryRun: false, fixture: 'exemplo.json' }, 'production')).toThrow(SafetyError)
	})

	it('modo produção: --fixture com --dry-run passa (não grava nada)', () => {
		expect(() => assertRunOptions({ dryRun: true, fixture: 'exemplo.json' }, 'production')).not.toThrow()
	})

	it('modo produção: carga normal, sem fixture, passa', () => {
		expect(() => assertRunOptions({ dryRun: false }, 'production')).not.toThrow()
	})

	it('modo local: --fixture continua gravando no Docker', () => {
		expect(() => assertRunOptions({ dryRun: false, fixture: 'exemplo.json' }, 'local')).not.toThrow()
	})
})

describe('modo lido do env (sem injeção)', () => {
	const PRODUCTION_ENV = {
		TARGET_MODE: 'production',
		TARGET_DB_HOST: '203.0.113.20',
		TARGET_DB_PORT: String(PRODUCTION_TARGET.port),
		TARGET_DB_USER: PRODUCTION_TARGET.user,
		TARGET_DB_PASSWORD: 'x'
	}
	const saved = Object.fromEntries(Object.keys(PRODUCTION_ENV).map(key => [key, process.env[key]]))

	const useEnv = (values: Record<string, string>) => {
		Object.assign(process.env, values)
		resetEnvCache()
	}

	afterEach(() => {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key]
			else process.env[key] = value
		}

		resetEnvCache()
	})

	it('TARGET_MODE=production no env: --fixture sem --dry-run é recusado e a máscara desliga', () => {
		useEnv(PRODUCTION_ENV)

		expect(() => assertRunOptions({ dryRun: false, fixture: 'exemplo.json' })).toThrow(SafetyError)
		expect(maskPersonalData(ORDER_TABLES.clientProfile, [{ id: 'u-1', email: 'a@exemplo.com' }])[0]?.email).toBe(
			'a@exemplo.com'
		)
	})

	it('sem TARGET_MODE no env: --fixture passa e a máscara continua ligada', () => {
		resetEnvCache()

		expect(() => assertRunOptions({ dryRun: false, fixture: 'exemplo.json' })).not.toThrow()
		expect(maskPersonalData(ORDER_TABLES.clientProfile, [{ id: 'u-1', email: 'a@exemplo.com' }])[0]?.email).toBe(
			MASK
		)
	})
})
