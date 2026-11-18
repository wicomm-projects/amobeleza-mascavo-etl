import { z } from 'zod'

import { AppError } from '../../core/errors.js'

import deParaFile from './de-para.json' with { type: 'json' }
import { collationKey } from './text.js'

/**
 * De/Para de canal (só Mascavo: sheets_google_drive_trafego e _vendas).
 *
 * Nas planilhas do Supermetrics, `vehicle_channel_no_pay` (ex.: "google ads", "crm", "direto", "pesquisa orgânica") e
 * `type` (pago / não pago) eram colunas calculadas. O GA4 não as tem: a classificação vem de `de-para.json`, montado a
 * partir do histórico com `SELECT DISTINCT` só de leitura na produção. Origem/campanha sem regra grava as duas colunas
 * nulas e entra na lista de pendências das `notes` do resumo.
 *
 * Uma regra com `campanha` vence a regra só com `origem` (ex.: "google" + "(organic)" ≠ "google" + campanha paga).
 */

const ruleSchema = z.object({
	origem: z.string().trim().min(1),
	campanha: z.string().trim().min(1).optional(),
	vehicle_channel_no_pay: z.string().min(1),
	type: z.string().min(1)
})

const deParaSchema = z.object({
	leiame: z.string().optional(),
	regras: z.array(ruleSchema)
})

interface iChannel {
	vehicle_channel_no_pay: string | null
	type: string | null
}

interface iChannelClassifier {
	classify: (source: string, campaign: string) => iChannel
	/** Combinações "origem / campanha" sem regra, na ordem em que apareceram. */
	unmapped: () => string[]
	ruleCount: number
}

const UNMAPPED: iChannel = { vehicle_channel_no_pay: null, type: null }

const pairKey = (source: string, campaign: string) => `${collationKey(source)}\u0000${collationKey(campaign)}`

const createChannelClassifier = (input: unknown = deParaFile): iChannelClassifier => {
	const parsed = deParaSchema.safeParse(input)

	if (!parsed.success) {
		const issue = parsed.error.issues[0]

		throw new AppError(`de-para.json inválido: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim())
	}

	const byPair = new Map<string, iChannel>()
	const bySource = new Map<string, iChannel>()

	for (const rule of parsed.data.regras) {
		const channel = { vehicle_channel_no_pay: rule.vehicle_channel_no_pay, type: rule.type }
		const key = rule.campanha === undefined ? collationKey(rule.origem) : pairKey(rule.origem, rule.campanha)
		const target = rule.campanha === undefined ? bySource : byPair

		if (target.has(key)) {
			throw new AppError(
				`de-para.json: regra repetida para ${rule.origem} / ${rule.campanha ?? '(qualquer campanha)'}`
			)
		}

		target.set(key, channel)
	}

	const missing = new Map<string, string>()

	const classify = (source: string, campaign: string): iChannel => {
		const channel = byPair.get(pairKey(source, campaign)) ?? bySource.get(collationKey(source))

		if (channel) return channel

		const key = pairKey(source, campaign)

		if (!missing.has(key)) missing.set(key, `${source} / ${campaign}`)

		return UNMAPPED
	}

	return { classify, unmapped: () => [...missing.values()], ruleCount: parsed.data.regras.length }
}

export { createChannelClassifier }
export type { iChannel, iChannelClassifier }
