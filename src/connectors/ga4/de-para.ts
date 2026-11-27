import { z } from 'zod'

import { AppError } from '../../core/errors.js'

import deParaFile from './de-para.json' with { type: 'json' }
import { collationKey } from './text.js'

/**
 * De/Para de canal (só Mascavo: sheets_google_drive_trafego e _vendas).
 *
 * Nas planilhas do Supermetrics, `vehicle_channel_no_pay` (ex.: "google ads", "crm", "direto") e `type` (pago / não
 * pago) eram colunas calculadas. O GA4 não as tem: a classificação vem de `de-para.json`, montado a partir do histórico
 * da produção (só leitura), com uma lista de regras por tabela e os textos exatos de cada uma (o tráfego grava em
 * minúsculas; as vendas, "Google Ads" / "Pago"). "origem / mídia" sem regra grava as duas colunas nulas e entra na lista
 * de pendências das `notes` do resumo.
 *
 * Três tipos de regra, nesta ordem de prioridade:
 * 1. `origem` + `campanha` (opcional, para ajustes futuros);
 * 2. `origem` ("origem / mídia" inteira, ex.: "br.search.yahoo.com / referral");
 * 3. `midia` (só a mídia, ex.: "referral"): vale para qualquer origem com essa mídia que não tenha regra própria. Assim
 *    site novo de referral não vira pendência, e o arquivo não precisa listar cada domínio (alguns são endereços
 *    internos que o GA4 registra como referência: IPs, ambientes de teste, sistemas de parceiros).
 */

const channelFields = {
	vehicle_channel_no_pay: z.string().min(1),
	type: z.string().min(1)
}

const sourceRuleSchema = z.object({
	// "" é uma origem de verdade: o GA4 às vezes manda "origem / mídia" vazia (gravada vazia na tabela).
	origem: z.string().trim(),
	campanha: z.string().trim().min(1).optional(),
	...channelFields
})

const mediumRuleSchema = z.object({
	midia: z.string().trim().min(1),
	...channelFields
})

const ruleSchema = z.union([sourceRuleSchema.strict(), mediumRuleSchema.strict()])

const deParaSchema = z.object({
	leiame: z.string().optional(),
	fonte: z.unknown().optional(),
	trafego: z.array(ruleSchema),
	vendas: z.array(ruleSchema)
})

type tChannelTable = 'trafego' | 'vendas'

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

/** "origem / mídia" do GA4: a mídia é o que vem depois do último " / ". Sem separador, não há mídia. */
const MEDIUM_SEPARATOR = ' / '

const mediumOf = (source: string): string | null => {
	const index = source.lastIndexOf(MEDIUM_SEPARATOR)

	return index < 0 ? null : source.slice(index + MEDIUM_SEPARATOR.length)
}

const pairKey = (source: string, campaign: string) => `${collationKey(source)}\u0000${collationKey(campaign)}`

const createChannelClassifier = (table: tChannelTable, input: unknown = deParaFile): iChannelClassifier => {
	const parsed = deParaSchema.safeParse(input)

	if (!parsed.success) {
		const issue = parsed.error.issues[0]

		throw new AppError(`de-para.json inválido: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`.trim())
	}

	const rules = parsed.data[table]
	const byPair = new Map<string, iChannel>()
	const bySource = new Map<string, iChannel>()
	const byMedium = new Map<string, iChannel>()

	const add = (target: Map<string, iChannel>, key: string, channel: iChannel, label: string) => {
		if (target.has(key)) throw new AppError(`de-para.json: regra repetida em ${table} para ${label}`)

		target.set(key, channel)
	}

	for (const rule of rules) {
		const channel = { vehicle_channel_no_pay: rule.vehicle_channel_no_pay, type: rule.type }

		if ('midia' in rule) {
			add(byMedium, collationKey(rule.midia), channel, `a mídia ${rule.midia}`)
			continue
		}

		if (rule.campanha === undefined) {
			add(bySource, collationKey(rule.origem), channel, `${rule.origem} / (qualquer campanha)`)
			continue
		}

		add(byPair, pairKey(rule.origem, rule.campanha), channel, `${rule.origem} / ${rule.campanha}`)
	}

	const missing = new Map<string, string>()

	const classify = (source: string, campaign: string): iChannel => {
		const medium = mediumOf(source)
		const channel =
			byPair.get(pairKey(source, campaign)) ??
			bySource.get(collationKey(source)) ??
			(medium === null ? undefined : byMedium.get(collationKey(medium)))

		if (channel) return channel

		const key = pairKey(source, campaign)

		if (!missing.has(key)) missing.set(key, `${source} / ${campaign}`)

		return UNMAPPED
	}

	return { classify, unmapped: () => [...missing.values()], ruleCount: rules.length }
}

export { createChannelClassifier }
export type { iChannel, iChannelClassifier, tChannelTable }
