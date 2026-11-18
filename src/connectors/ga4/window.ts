import { AppError } from '../../core/errors.js'

/**
 * Janela de datas dos relatórios. As datas do GA4 são dias do fuso da propriedade (São Paulo, a confirmar no
 * check-access): aqui tudo é dia (AAAA-MM-DD), sem hora — a convenção de UTC vale para os carimbos da VTEX, não para o
 * `date` do GA4, que sempre foi o dia do relatório.
 */

const SAO_PAULO_TZ = 'America/Sao_Paulo'
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

interface iDateWindow {
	/** Primeiro dia, inclusive. */
	from: string
	/** Último dia, inclusive. */
	to: string
}

const dayInTimeZone = (date: Date, timeZone: string = SAO_PAULO_TZ): string =>
	// en-CA formata como AAAA-MM-DD.
	new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

const addDays = (day: string, days: number): string => {
	const date = new Date(`${day}T00:00:00.000Z`)

	date.setUTCDate(date.getUTCDate() + days)

	return date.toISOString().slice(0, 10)
}

/** O CLI monta --from como 00:00Z e --to como 23:59Z do dia digitado: a parte UTC é o próprio dia. */
const dayOfCliDate = (date: Date): string => date.toISOString().slice(0, 10)

interface iWindowRequest {
	from?: Date
	to?: Date
	/** Janela da fixture, usada quando o CLI não passa a data. */
	fallback?: iDateWindow
	/** Tamanho da janela padrão em dias, contando o último. */
	days: number
	now?: Date
}

/** Padrão: os últimos `days` dias até hoje (São Paulo). `--from`/`--to` do CLI vencem; depois, a janela da fixture. */
const resolveWindow = ({ from, to, fallback, days, now = new Date() }: iWindowRequest): iDateWindow => {
	const end = to ? dayOfCliDate(to) : (fallback?.to ?? dayInTimeZone(now))
	const start = from ? dayOfCliDate(from) : (fallback?.from ?? addDays(end, -(days - 1)))

	if (!ISO_DAY.test(start) || !ISO_DAY.test(end) || start > end) {
		throw new AppError(`Janela inválida ${start}..${end} (use AAAA-MM-DD, início <= fim).`)
	}

	return { from: start, to: end }
}

export { ISO_DAY, SAO_PAULO_TZ, addDays, dayInTimeZone, resolveWindow }
export type { iDateWindow }
