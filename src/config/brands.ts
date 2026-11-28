import { DATABASES, type tDatabase } from './databases.js'
import { getEnv, type tEnv } from './env.js'

/**
 * Um código, duas configurações. Cada marca grava no próprio banco; o AnyMarket é uma carga única (todas as contas,
 * inclusive a MASCAVO) gravada em amobeleza_etl — é de lá que os dois Power BI leem marketplace.
 */

const BRANDS = ['mascavo', 'amobeleza'] as const

type tBrand = (typeof BRANDS)[number]

interface iVtexCredentials {
	account: string
	environment: string
	appKey: string
	appToken: string
}

interface iGa4Config {
	propertyId: string
}

interface iBrandConfig {
	brand: tBrand
	label: string
	database: tDatabase
	/** undefined = aguardando chave */
	vtex?: iVtexCredentials
	/** undefined = aguardando ID da propriedade */
	ga4?: iGa4Config
}

const ANYMARKET_DATABASE: tDatabase = 'amobeleza_etl'

const isBrand = (value: unknown): value is tBrand => typeof value === 'string' && BRANDS.includes(value as tBrand)

const vtexFromEnv = (
	account: string | undefined,
	environment: string,
	appKey: string | undefined,
	appToken: string | undefined
): iVtexCredentials | undefined => {
	if (!account || !appKey || !appToken) return undefined

	return { account, environment, appKey, appToken }
}

const buildBrandConfig = (brand: tBrand, env: tEnv): iBrandConfig => {
	if (brand === 'mascavo') {
		return {
			brand,
			label: 'Mascavo',
			database: 'mascavo_etl',
			vtex: vtexFromEnv(
				env.VTEX_MASCAVO_ACCOUNT,
				env.VTEX_MASCAVO_ENVIRONMENT,
				env.VTEX_MASCAVO_APP_KEY,
				env.VTEX_MASCAVO_APP_TOKEN
			),
			ga4: env.GA4_MASCAVO_PROPERTY_ID ? { propertyId: env.GA4_MASCAVO_PROPERTY_ID } : undefined
		}
	}

	return {
		brand,
		label: 'Amobeleza',
		database: 'amobeleza_etl',
		vtex: vtexFromEnv(
			env.VTEX_AMOBELEZA_ACCOUNT,
			env.VTEX_AMOBELEZA_ENVIRONMENT,
			env.VTEX_AMOBELEZA_APP_KEY,
			env.VTEX_AMOBELEZA_APP_TOKEN
		),
		ga4: env.GA4_AMOBELEZA_PROPERTY_ID ? { propertyId: env.GA4_AMOBELEZA_PROPERTY_ID } : undefined
	}
}

const getBrandConfig = (brand: tBrand, env: tEnv = getEnv()): iBrandConfig => buildBrandConfig(brand, env)

export { ANYMARKET_DATABASE, BRANDS, DATABASES, getBrandConfig, isBrand }
export type { iBrandConfig, iGa4Config, iVtexCredentials, tBrand, tDatabase }
