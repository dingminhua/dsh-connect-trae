import { request } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { TraeCatalog } from '../src/catalog.ts'
import { createTraeShim, type TraeShim } from '../src/shim.ts'
import { TraeStreamFailure } from '../src/upstream.ts'
import type { TraeUpstreamClient } from '../src/upstream.ts'

const cleanup: TraeShim[] = []
afterEach(async () => { await Promise.all(cleanup.splice(0).map(shim => shim.close())) })

async function start(client?: TraeUpstreamClient): Promise<TraeShim> {
  const shim = createTraeShim({
    catalog: new TraeCatalog(),
    client: client ?? new (await import('../src/upstream.ts')).UnconfiguredTraeUpstreamClient(),
  })
  await shim.ready
  cleanup.push(shim)
  return shim
}

function raw(port: number, options: { method?: string; path?: string; headers?: Record<string, string>; body?: string }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path ?? '/', headers: options.headers }, res => {
      const chunks: Buffer[] = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

describe('Trae loopback shim', () => {
  it('binds an ephemeral loopback port and serves models with the secret', async () => {
    const shim = await start()
    expect(shim.baseUrl()).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    const response = await fetch(`${shim.baseUrl()}/v1/models`, { headers: { authorization: `Bearer ${shim.token()}` } })
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { id: string }[] }
    expect(body.data.map(item => item.id)).toContain('DeepSeek-V4-Flash-Official')
  })

  it('rejects missing bearer and hostile Host', async () => {
    const shim = await start()
    const port = Number(new URL(shim.baseUrl()).port)
    const missing = await raw(port, { path: '/healthz', headers: { host: `127.0.0.1:${port}` } })
    expect(missing.status).toBe(401)
    const hostile = await raw(port, { path: '/healthz', headers: { host: 'evil.example', authorization: `Bearer ${shim.token()}` } })
    expect(hostile.status).toBe(403)
  })

  it('rejects hostile Origin and non-JSON chat', async () => {
    const shim = await start()
    const port = Number(new URL(shim.baseUrl()).port)
    const origin = await raw(port, {
      method: 'POST', path: '/v1/chat/completions',
      headers: { host: `127.0.0.1:${port}`, origin: 'https://evil.example', 'content-type': 'application/json', authorization: `Bearer ${shim.token()}` },
      body: '{}',
    })
    expect(origin.status).toBe(403)
    const contentType = await raw(port, {
      method: 'POST', path: '/v1/chat/completions',
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'text/plain', authorization: `Bearer ${shim.token()}` },
      body: '{}',
    })
    expect(contentType.status).toBe(415)
  })

  it('returns an explicit 503 while the real protocol is disabled', async () => {
    const shim = await start()
    const response = await fetch(`${shim.baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${shim.token()}` },
      body: JSON.stringify({ model: 'DeepSeek-V4-Flash-Official', messages: [] }),
    })
    expect(response.status).toBe(503)
    expect(await response.text()).toContain('protocol is not configured')
  })

  it('aborts upstream when the inbound request closes', async () => {
    let seenSignal: AbortSignal | undefined
    let enteredResolve!: () => void
    const entered = new Promise<void>(resolve => { enteredResolve = resolve })
    const shim = await start({
      async chatStream(_body, signal) {
        seenSignal = signal
        enteredResolve()
        await new Promise(resolve => setTimeout(resolve, 100))
        return { ok: false, status: 503, kind: 'unconfigured', message: 'late' }
      },
    })
    const port = Number(new URL(shim.baseUrl()).port)
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/v1/chat/completions', headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', authorization: `Bearer ${shim.token()}` } })
    req.on('error', () => {})
    req.write('{}')
    req.end()
    await entered
    req.destroy()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(seenSignal?.aborted).toBe(true)
  })

  /**
   * Issue #85. Trae's 3004 (shared-queue rate limit) arrives as an SSE `error`
   * event after `request_wait_in_queue`, so it can land after the shim has
   * already answered 200. The failure used to be turned into a bare `res.end()`:
   * the status line was gone, and the message went with it, leaving the kernel a
   * truncated stream it could only read as `TRANSPORT` and retry.
   *
   * These two cases pin the boundary: a REFUSAL must reach the client as an
   * error payload, and a plain socket failure must keep closing quietly (no
   * invented error frame for a local abort).
   */
  it('carries a mid-stream upstream failure to the client as an SSE error frame', async () => {
    const shim = await start({
      async chatStream() {
        return {
          ok: true,
          response: new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n'))
              // A real failure arrives while the answer is being consumed, not in
              // the same tick as the first chunk: `Readable.fromWeb` surfaces a
              // synchronous error before it drains what was already enqueued,
              // which would test the ordering of the shim's buffering rather
              // than the frame it writes.
              setTimeout(() => {
                controller.error(new TraeStreamFailure(
                  'Trae throttled the shared request queue for this account (a rate limit, not the credit balance) · Trae code 3004 · upstream: your requests have exceeded the rate limit',
                  'soft_rate',
                  429,
                  3004,
                ))
              }, 5)
            },
          }), { headers: { 'content-type': 'text/event-stream' } }),
        }
      },
    })
    const port = Number(new URL(shim.baseUrl()).port)
    const response = await raw(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', authorization: `Bearer ${shim.token()}` },
      body: '{}',
    })
    // The 200 cannot be taken back; the failure has to travel inside it.
    expect(response.status).toBe(200)
    expect(response.body).toContain('"content":"partial"')
    expect(response.body).toContain('"error":')
    expect(response.body).toContain('Trae code 3004')
    expect(response.body).toContain('"type":"soft_rate"')
    expect(response.body).toContain('"trae_code":3004')
    // A failure is not a completion: no sentinel may claim the turn finished.
    expect(response.body).not.toContain('[DONE]')
  })

  it('closes a stream that dies without an upstream verdict, inventing no error frame', async () => {
    const shim = await start({
      async chatStream() {
        return {
          ok: true,
          response: new Response(new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'))
              controller.error(new Error('socket hang up'))
            },
          }), { headers: { 'content-type': 'text/event-stream' } }),
        }
      },
    })
    const port = Number(new URL(shim.baseUrl()).port)
    const response = await raw(port, {
      method: 'POST',
      path: '/v1/chat/completions',
      headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', authorization: `Bearer ${shim.token()}` },
      body: '{}',
    })
    expect(response.body).not.toContain('"error":')
  })
})
