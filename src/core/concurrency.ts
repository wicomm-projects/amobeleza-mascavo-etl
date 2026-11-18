/**
 * Executa `tasks` com no máximo `concurrency` promessas simultâneas, preservando a ordem dos resultados. Não interrompe nas
 * falhas: devolve um "settled" por tarefa para o chamador decidir (ex.: buscar o detalhe de 300 pedidos e saber quais
 * falharam). Mesmo padrão do bff-givex (src/utils/limit.ts).
 */
const runWithConcurrency = async <T>(
	tasks: (() => Promise<T>)[],
	concurrency: number
): Promise<PromiseSettledResult<T>[]> => {
	const results: PromiseSettledResult<T>[] = new Array(tasks.length)
	let nextIndex = 0

	const worker = async () => {
		while (nextIndex < tasks.length) {
			const current = nextIndex

			nextIndex += 1
			const task = tasks[current]!

			try {
				results[current] = { status: 'fulfilled', value: await task() }
			} catch (reason) {
				results[current] = { status: 'rejected', reason }
			}
		}
	}

	const workers = Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, () => worker())

	await Promise.all(workers)

	return results
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export { runWithConcurrency, sleep }
