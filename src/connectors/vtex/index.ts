import { getBrandConfig, type tBrand } from '../../config/index.js'
import { HttpError } from '../../core/errors.js'
import type { iAccessResult, iJob, iSource } from '../../core/jobs/types.js'

import { catalogJob } from './catalog-job.js'
import { catalogParity } from './catalog-parity.js'
import { createBrandApi } from './client.js'
import { ordersJob } from './orders-job.js'
import { orderParity } from './orders-parity.js'

/**
 * VTEX — pedidos e catálogo das duas lojas (etapa 1 do roadmap). Uma fonte por marca: mascavo → mascavo_etl,
 * amobeleza → amobeleza_etl, credenciais VTEX_<MARCA>_* do .env. Detalhes em docs/conectores/vtex.md.
 *
 * - vtex-orders (a cada 30 min): 10 tabelas de pedido + vtex_client_profile (o perfil vem no detalhe do pedido).
 * - vtex-catalog (1x/dia): vtex_products, vtex_skus_and_products_id, vtex_category_tree.
 */

const jobs: readonly iJob[] = [
	{ ...ordersJob, parity: orderParity },
	{ ...catalogJob, parity: catalogParity }
]

const describeError = (err: unknown): string => {
	if (err instanceof HttpError) return err.status ? `HTTP ${err.status}` : 'falha de rede'

	return err instanceof Error ? err.message : String(err)
}

/**
 * Uma leitura mínima por permissão que os jobs usam: 1 pedido da lista do OMS e 1 produto do mapa do catálogo. Só
 * conta se respondeu; nenhum dado de pedido ou cliente sai daqui.
 */
const checkAccess = async (brand?: tBrand): Promise<iAccessResult> => {
	if (!brand) return { ok: false, detail: 'a VTEX roda por marca' }

	const api = createBrandApi(brand)

	try {
		await api.listOrders({ per_page: 1, page: 1 })
	} catch (err) {
		return { ok: false, detail: `lista de pedidos (OMS): ${describeError(err)}` }
	}

	try {
		await api.getProductAndSkuIds(1, 1)
	} catch (err) {
		return { ok: false, detail: `catálogo: ${describeError(err)}` }
	}

	return { ok: true, detail: 'lista de pedidos (OMS) e catálogo responderam' }
}

const vtexSource: iSource = {
	name: 'vtex',
	label: 'VTEX',
	scope: 'brand',
	phase: 1,
	isConfigured: brand => (brand ? getBrandConfig(brand).vtex !== undefined : false),
	checkAccess,
	jobs
}

export { vtexSource }
