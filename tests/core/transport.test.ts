import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { HttpError, SafetyError } from '../../src/core/errors.js'
import { createGetClient, parseRetryAfter } from '../../src/core/http/transport.js'

/** Servidor HTTP local (127.0.0.1, porta aleatória) que responde a sequência de status combinada. Sem rede externa. */
let server: Server
let baseURL = ''
let statusQueue: number[] = []
const methods: string[] = []

beforeAll(async () => {
	server = createServer((req, res) => {
		methods.push(req.method ?? '')
		const status = statusQueue.shift() ?? 200

		res.writeHead(status, { 'content-type': 'application/json', 'location': 'http://127.0.0.2:9/roubo' })
		res.end(JSON.stringify({ status }))
	})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
	await new Promise<void>(resolve => server.close(() => resolve()))
})

beforeEach(() => {
	statusQueue = []
	methods.length = 0
})

const client = () =>
	createGetClient({
		source: 'teste',
		baseURL,
		headers: { 'X-Teste': '1' },
		timeoutMs: 2000,
		maxAttempts: 3,
		backoffBaseMs: 1
	})

describe('transporte HTTP só leitura', () => {
	it('expõe apenas get: não há como fazer POST, PUT, PATCH ou DELETE', () => {
		expect(Object.keys(client())).toEqual(['get'])
	})

	it('tenta de novo em 429 e só usa GET', async () => {
		statusQueue = [429, 200]

		await expect(client().get('/pedidos')).resolves.toEqual({ status: 200 })
		expect(methods).toEqual(['GET', 'GET'])
	})

	it('tenta de novo em 5xx até o limite e então falha', async () => {
		statusQueue = [500, 502, 503]

		await expect(client().get('/pedidos')).rejects.toBeInstanceOf(HttpError)
		expect(methods).toHaveLength(3)
	})

	it('não segue redirect: as credenciais nunca vão para outro host', async () => {
		statusQueue = [302]

		await expect(client().get('/pedidos')).rejects.toMatchObject({ status: 302, retryable: false })
		expect(methods).toEqual(['GET'])
	})

	it.each(['http://outro-host/pedidos', '//outro-host/pedidos', 'pedidos'])(
		'recusa caminho que não é relativo ao baseURL: %s',
		async path => {
			await expect(client().get(path)).rejects.toBeInstanceOf(SafetyError)
			expect(methods).toEqual([])
		}
	)

	it('não tenta de novo em 4xx (credencial errada, rota inexistente)', async () => {
		statusQueue = [403]

		await expect(client().get('/pedidos')).rejects.toMatchObject({ status: 403, retryable: false })
		expect(methods).toEqual(['GET'])
	})
})

describe('Retry-After', () => {
	it('lê segundos', () => {
		expect(parseRetryAfter('2')).toBe(2000)
	})

	it('lê data HTTP', () => {
		const now = Date.parse('2026-11-18T12:00:00Z')

		expect(parseRetryAfter('Wed, 18 Nov 2026 12:00:05 GMT', now)).toBe(5000)
	})

	it('ignora valor ausente ou ilegível', () => {
		expect(parseRetryAfter(undefined)).toBeUndefined()
		expect(parseRetryAfter('amanhã')).toBeUndefined()
	})
})
