import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import type { TraeCatalog } from './catalog.ts'
import { TraeStreamFailure } from './upstream.ts'
import type { TraeUpstreamClient, TraeUpstreamErrorKind } from './upstream.ts'

export interface ShimLogger {
  warn(...args: unknown[]): void
  error(...args: unknown[]): void
}

export interface TraeShim {
  ready: Promise<void>
  baseUrl(): string
  token(): string
  /** Bearer secret of one named route (defaults to the first route). */
  tokenOf(label?: string): string
  close(): Promise<void>
}

/** One bearer-authenticated chat route served by the shim. */
export interface TraeShimRoute {
  /** Stable label used to look the route's secret up (`solo` | `enterprise`). */
  label: string
  client: TraeUpstreamClient
  /**
   * Account-pool hooks for this route (issue #44). Absent means "one fixed
   * account, no rotation and no failover" — the behaviour before the pool
   * existed, and still the behaviour when the pool is switched off.
   */
  pool?: TraeShimPool
}

/**
 * What an account pool tells the shim around one chat attempt.
 *
 * The shim owns the HTTP surface and the pool owns "who bills", so the two meet
 * here: the pool may re-point the next request, hand back a client for a
 * different account after a failure, and hear about failures that only a real
 * request — not a probe — can produce.
 *
 * Every method must resolve rather than throw: a pool failure must never turn a
 * chat request into a 500 when a plain answer was possible.
 */
export interface TraeShimPool {
  /**
   * Choose the account for this request and report which one it is. Called once,
   * before the first attempt; `undefined` means "the pool chose nobody", which
   * leaves the route's own client to bill the bound account.
   */
  prepare(): Promise<string | undefined>
  /**
   * The client for the next account worth trying after the current one failed,
   * or `undefined` when the pool has nothing left to try.
   *
   * The returned client must be bound to that account's OWN credential:
   * failing over is not a rebind, so it must not move the account the user
   * selected (the same rule per-account probes already follow).
   */
  next(tried: readonly string[]): Promise<{ accountId: string; client: TraeUpstreamClient } | undefined>
  /** Record a real request's failure against the account that hit it. */
  failed(accountId: string, kind: TraeUpstreamErrorKind, message: string): Promise<void>
  /** One clause naming why no other account can serve, for the error text. */
  shortfall(tried: readonly string[]): Promise<string | undefined>
}

export interface TraeShimOptions {
  catalog: TraeCatalog
  /**
   * Single-route form, kept for the existing call sites and tests.
   *
   * A shim serves exactly as many chat routes as the region publishes provider
   * ids, and they must not be interchangeable: the consumer and enterprise
   * pools bill different accounts, so the route is chosen by the bearer token
   * the adapter was built with, and an unknown token is rejected rather than
   * defaulting to "some" pool.
   */
  client?: TraeUpstreamClient
  routes?: readonly TraeShimRoute[]
  logger?: ShimLogger
}

const BODY_LIMIT = 64 * 1024 * 1024
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const STATUS_BY_KIND: Readonly<Record<TraeUpstreamErrorKind, number>> = {
  authentication: 401,
  hard_credit: 402,
  soft_rate: 429,
  not_found: 502,
  server: 502,
  client: 400,
  unconfigured: 503,
}

/**
 * Failures that say something about the ACCOUNT and are therefore worth another
 * account: a rejected token, a drained quota, a rate limit, a 5xx.
 *
 * `not_found`, `client` and `unconfigured` are deliberately absent — they say
 * something about the request or this build, and replaying them on a second
 * account would burn the same error twice while teaching the pool a false fact
 * about an account that never got a chance to serve.
 */
const FAILOVER_KINDS: ReadonlySet<TraeUpstreamErrorKind> = new Set(['authentication', 'hard_credit', 'soft_rate', 'server'])

/**
 * Accounts one request may try.
 *
 * Not "all of them": every attempt costs a round-trip before the user sees a
 * byte, and a pool whose every member is down must fail with a reason instead of
 * turning one request into a slow tour of the roster.
 */
const MAX_POOL_ATTEMPTS = 3

function hostnameOfHost(host: string): string {
  let hostname = host.trim().toLowerCase()
  if (hostname.startsWith('[')) {
    const end = hostname.indexOf(']')
    return end === -1 ? hostname : hostname.slice(0, end + 1)
  }
  const colon = hostname.lastIndexOf(':')
  if (colon !== -1 && /^\d+$/.test(hostname.slice(colon + 1))) hostname = hostname.slice(0, colon)
  return hostname
}

function hostIsLoopback(host: string | undefined): boolean {
  return host !== undefined && host.trim() !== '' && LOOPBACK_HOSTS.has(hostnameOfHost(host))
}

function originIsLoopback(origin: string | undefined): boolean {
  if (origin === undefined || origin.trim() === '') return true
  try {
    const hostname = new URL(origin).hostname
    return LOOPBACK_HOSTS.has(hostname) || hostname === '::1'
  } catch {
    return false
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

function writeError(res: ServerResponse, status: number, kind: string, message: string): void {
  writeJson(res, status, { error: { message, type: kind, code: kind } })
}

/**
 * Write a failure into an SSE body that has already started.
 *
 * The shape is OpenAI's own in-stream error payload (`data: {"error":{...}}`),
 * because that is what an OpenAI-compatible reader understands: the `openai`
 * SDK throws an `APIError` whose message is the `error.message` here, and the
 * kernel classifies that text. A bare `[DONE]` would claim success; nothing at
 * all is the truncated-200 case this exists to end (issue #85).
 *
 * Deliberately NOT followed by `[DONE]`: this is a failure, and a terminal
 * "done" after it would let a client that only looks for the sentinel treat the
 * turn as completed.
 */
function writeStreamError(res: ServerResponse, failure: TraeStreamFailure): void {
  const payload = JSON.stringify({
    error: {
      message: failure.message,
      type: failure.kind,
      code: failure.kind,
      ...failure.traeCode === undefined ? {} : { trae_code: failure.traeCode },
    },
  })
  res.write(`data: ${payload}\n\n`)
  res.end()
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('request body too large'))
        req.destroy()
      } else {
        chunks.push(chunk)
      }
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export function createTraeShim(options: TraeShimOptions): TraeShim {
  /**
   * Resolve the route table. The single-client form becomes a one-entry table
   * labelled `solo`, so existing call sites and tests keep one code path.
   */
  const routes: readonly (TraeShimRoute & { secret: string })[] = options.routes !== undefined
    ? options.routes.map(route => ({ ...route, secret: randomBytes(32).toString('base64url') }))
    : [{ label: 'solo', client: options.client as TraeUpstreamClient, secret: randomBytes(32).toString('base64url') }]
  const secret = routes[0]?.secret ?? randomBytes(32).toString('base64url')
  const sockets = new Set<import('node:net').Socket>()
  const server: Server = createServer((req, res) => { void handle(req, res) })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
  })
  const ready = new Promise<void>((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  server.listen(0, '127.0.0.1')

  /** Route whose secret matches the request's bearer, or `undefined`. */
  function routeOf(req: IncomingMessage): (TraeShimRoute & { secret: string }) | undefined {
    const match = typeof req.headers.authorization === 'string'
      ? /^Bearer\s+(.+)$/i.exec(req.headers.authorization.trim())
      : null
    if (match === null) return undefined
    const actual = Buffer.from(match[1] ?? '')
    for (const route of routes) {
      const expected = Buffer.from(route.secret)
      if (actual.length === expected.length && timingSafeEqual(actual, expected)) return route
    }
    return undefined
  }

  /**
   * Run one chat request, failing over across pooled accounts when the account
   * that was chosen cannot serve it (issue #44).
   *
   * The happy path makes exactly one upstream call, so a pool that is switched
   * off — or on, with the first choice healthy — costs nothing but one cheap
   * ranking lookup. A failure is reported to the pool BEFORE the decision to
   * retry, because a rate limit the pool never hears about is a rate limit it
   * will walk straight back into on the next request.
   */
  async function chatWithFailover(
    route: TraeShimRoute & { secret: string },
    raw: string,
    signal: AbortSignal,
  ): Promise<
    | { kind: 'stream'; response: Response; accountId?: string; pool?: TraeShimPool }
    | { kind: 'failed'; status: number; code: string; message: string }
  > {
    const pool = route.pool
    let client: TraeUpstreamClient = route.client
    let accountId = pool === undefined ? undefined : await pool.prepare().catch(() => undefined)
    const tried: string[] = []
    for (let attempt = 0; ; attempt += 1) {
      const result = await client.chatStream(raw, signal)
      if (result.ok) {
        // The account is carried out with the stream because a failure can still
        // arrive AFTER this point (issue #85) and the pool has to hear about it
        // too — otherwise a throttled account that answers 200 and then fails
        // stays "healthy" and is picked again on the very next request.
        return {
          kind: 'stream',
          response: result.response,
          ...accountId === undefined ? {} : { accountId },
          ...pool === undefined ? {} : { pool },
        }
      }
      const retryable = pool !== undefined && !signal.aborted && FAILOVER_KINDS.has(result.kind)
      // Only account-scoped failures are recorded: a bad model id is not evidence
      // that the account cannot serve, and writing it would exclude the account
      // from the pool permanently over one typo.
      if (retryable && accountId !== undefined) await pool.failed(accountId, result.kind, result.message).catch(() => {})
      const failed = { kind: 'failed' as const, status: STATUS_BY_KIND[result.kind], code: result.kind, message: result.message }
      if (!retryable) return failed
      if (accountId !== undefined) tried.push(accountId)
      // A spent attempt budget and an empty pool end the request the same way, so
      // the pool is asked once, at the end, whether it can explain the shortfall
      // (`undefined` when it has nothing to add — e.g. accounts remain, this
      // request simply ran out of tries).
      const next = attempt + 1 >= MAX_POOL_ATTEMPTS ? undefined : await pool.next(tried).catch(() => undefined)
      if (next === undefined) {
        const reason = await pool.shortfall(tried).catch(() => undefined)
        return reason === undefined ? failed : { ...failed, message: `${failed.message} (${reason})` }
      }
      client = next.client
      accountId = next.accountId
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if (!hostIsLoopback(req.headers.host)) return writeError(res, 403, 'host_not_allowed', 'Host must be loopback')
      if (!originIsLoopback(req.headers.origin)) return writeError(res, 403, 'origin_not_allowed', 'Origin must be loopback')
      // The bearer selects the billing pool, so an unrecognised token is a 401
      // and never a fallback to the first route.
      const route = routeOf(req)
      if (route === undefined) return writeError(res, 401, 'unauthorized', 'Missing or invalid bearer')
      const url = req.url ?? '/'
      if (req.method === 'GET' && (url === '/healthz' || url === '/healthz/')) return writeJson(res, 200, { ok: true })
      if (req.method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
        return writeJson(res, 200, {
          object: 'list',
          data: options.catalog.current().map(model => ({ id: model.id, object: 'model', created: 0, owned_by: 'trae' })),
        })
      }
      if (req.method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/chat/completions/')) {
        if (typeof req.headers['content-type'] !== 'string' || !req.headers['content-type'].toLowerCase().startsWith('application/json')) {
          return writeError(res, 415, 'unsupported_media_type', 'Content-Type must be application/json')
        }
        const raw = (await readBody(req)).toString('utf8')
        try { JSON.parse(raw) } catch { return writeError(res, 400, 'invalid_json', 'Request body must be valid JSON') }
        const parsed = JSON.parse(raw) as { model?: unknown; messages?: unknown[]; tools?: unknown[]; temperature?: unknown; reasoning_effort?: unknown; max_tokens?: unknown }
        options.logger?.warn('dsh-connect-trae: chat request received', {
          model: parsed.model,
          messages: Array.isArray(parsed.messages) ? parsed.messages.map(message => (typeof message === 'object' && message !== null ? (message as Record<string, unknown>)['role'] ?? '?' : '?')) : '(none)',
          toolCount: Array.isArray(parsed.tools) ? parsed.tools.length : 0,
          maxTokens: parsed.max_tokens,
          reasoningEffort: parsed.reasoning_effort,
          temperature: parsed.temperature,
          bodyBytes: raw.length,
        })
        const controller = new AbortController()
        const abort = (): void => controller.abort()
        req.once('aborted', abort)
        req.socket.once('close', abort)
        const result = await chatWithFailover(route, raw, controller.signal)
        if (result.kind === 'failed') return writeError(res, result.status, result.code, result.message)
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        const body = Readable.fromWeb(result.response.body as Parameters<typeof Readable.fromWeb>[0])
        body.on('error', (error: unknown) => {
          const record = error instanceof Error
            ? { name: error.name, message: error.message, cause: error.cause ? String(error.cause) : undefined }
            : String(error)
          options.logger?.warn('dsh-connect-trae: upstream stream failed', record)
          if (!res.writableEnded) {
            // Issue #85: a failure Trae reported INSIDE the stream must survive the
            // loopback boundary as a failure, not as a short 200.
            //
            // The status line and the first bytes are already gone, so an HTTP
            // error code is no longer available — but the SSE body is still open,
            // and an OpenAI-compatible client reads an error payload there as a
            // real error (`data: {"error":{...}}`, and the SDK throws APIError).
            // That is what carries the message — including Trae's own text
            // (`rate limit`), which the kernel's classifier turns into
            // RATE_LIMIT — instead of a bare EOF that reads as TRANSPORT and is
            // retried against the same throttled account.
            //
            // Only failures that came from the upstream get this frame: a local
            // abort or a client that went away must still close quietly.
            if (error instanceof TraeStreamFailure) {
              // A failure that arrives after the answer began is still an
              // ACCOUNT fact. The pool must learn it before the next request
              // ranks accounts, or it walks straight back into the same limit
              // (`soft_rate` is one of FAILOVER_KINDS for exactly this reason).
              // Recorded even when the client already left: the account really was
              // throttled, and that stays true whatever became of the socket.
              //
              // Guarded by FAILOVER_KINDS for the reason the pre-stream path
              // states — a mid-stream failure can still be `client` (an unmeasured
              // code, or an `error` event with no code at all). Recording that
              // would exclude a healthy account for 30 minutes over one bad
              // request: billing moves to the other account in a two-account pool,
              // and in a one-account pool the rotation stops with nothing on
              // screen to explain it.
              if (
                FAILOVER_KINDS.has(error.kind)
                && result.accountId !== undefined
                && result.pool !== undefined
              ) {
                void result.pool.failed(result.accountId, error.kind, error.message).catch(() => {})
              }
              // The frame itself is pointless once the client is gone, and writing
              // to a destroyed response is at best a no-op — so close quietly then.
              if (controller.signal.aborted) {
                if (!res.writableEnded) res.end()
                return
              }
              writeStreamError(res, error)
              return
            }
            res.end()
          }
        })
        body.pipe(res)
        return
      }
      writeError(res, 404, 'not_found', `No such route: ${req.method} ${url}`)
    } catch (error: unknown) {
      options.logger?.error('dsh-connect-trae: shim request failed', error)
      if (!res.headersSent) writeError(res, 500, 'internal', 'Internal shim error')
      else if (!res.writableEnded) res.end()
    }
  }

  return {
    ready,
    baseUrl() {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('trae shim is not listening')
      return `http://127.0.0.1:${address.port}`
    },
    token: () => secret,
    tokenOf(label?: string) {
      if (label === undefined) return secret
      const route = routes.find(entry => entry.label === label)
      if (route === undefined) throw new Error(`trae shim has no route named ${label}`)
      return route.secret
    },
    close: () => new Promise<void>((resolve, reject) => {
      for (const socket of sockets) socket.destroy()
      server.close(error => error === undefined ? resolve() : reject(error))
    }),
  }
}
