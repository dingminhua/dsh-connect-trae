/**
 * Same-origin usage route for the Trae plugin card: sign-in state and the
 * read-only usage/credit summary, fetched by the browser half. The route
 * answers loopback browser requests only and never carries token material.
 *
 * Follows the `dsh-workbuddy-connect` status-route pattern so the plugin card
 * stays consistent with that project's external presentation.
 *
 * @module dsh-connect-trae/web-status
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { TraeCredentialStore } from './auth.ts'
import type { TraeModelInfo } from './catalog.ts'
import type { TraeUsageClient } from './usage.ts'
import type { TraeRawDiagnostic } from './raw-diagnostic.ts'
import type { TraeRegion } from './region.ts'
import {
  regionOfTraeStatusUrl,
  TRAE_ACCOUNTS_REFRESH_PATH,
  TRAE_CHECKIN_PATH,
  TRAE_MODELS_REFRESH_PATH,
  TRAE_USAGE_PATH,
} from './status-paths.ts'
import type { TraeWebCheckin, TraeWebCredits, TraeWebUsage } from './status-paths.ts'

export { TRAE_USAGE_PATH } from './status-paths.ts'
export type { TraeWebUsage } from './status-paths.ts'

/**
 * The upstream's business code for "该设备今日已参与签到" — this DEVICE already
 * used today's check-in (measured 2026-09-26 on a CN account whose claim was
 * refused with exactly this code after an account switch on the same machine).
 *
 * It arrives as HTTP 200 with a non-zero `code`, which is why it has to be
 * matched on the code rather than on the HTTP status: read as a transport
 * failure it looks like the plugin is broken, when the day is simply spent.
 */
const CHECKIN_DEVICE_ALREADY_CLAIMED = 9095

/**
 * Constructor dependencies. Everything region-specific is addressed by the
 * region the request names: the two regions are separate provider stacks, so
 * the card must be served the directory, selection, and credits of the tab the
 * user is on.
 */
export interface TraeUsageRouteOptions {
  /** The region-scoped credential store backing each region's requests. */
  store(region: TraeRegion): TraeCredentialStore
  /** The region-scoped usage client (CN work credits / international pay status). */
  client(region: TraeRegion): TraeUsageClient
  /** The requested region's last-refreshed raw directory (one entry per upstream model). */
  displayModels(region: TraeRegion): readonly TraeModelInfo[]
  /** The user's model selection in the requested region, stored as model id (= Trae name). */
  enabledModelIds(region: TraeRegion): readonly string[]
  /**
   * Whether the requested region's provider is currently offered to DSH. The
   * card renders this as the tab's on/off checkbox, so the switch reflects the
   * committed settings value rather than a local guess.
   */
  regionEnabled(region: TraeRegion): boolean
  /** Re-read one region's live directory from the upstream. */
  discoverModels?(region: TraeRegion, signal?: AbortSignal): Promise<readonly TraeModelInfo[]>
  /** Raw-Chat capability state of the requested region. */
  rawDiagnostic?(region: TraeRegion): TraeRawDiagnostic
}

/** Redact token-like content before it crosses to the browser. */
function safeMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, '[redacted token]')
    .replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, '$1[redacted]')
    .slice(0, 500)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) })
  res.end(payload)
}

/** Loopback browser origins only; other devices are refused until trusted origins exist. */
function loopbackOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'
  } catch {
    return false
  }
}

/** Map the credit snapshot to the card's compact credit document. */
function toCredits(snapshot: { summary: { totalAmount: number; consumedAmount: number }; packs: { displayDesc: string; availableEndpoint?: number; consumedCredits?: number; creditsLimit?: number }[] }): TraeWebCredits {
  const { totalAmount, consumedAmount } = snapshot.summary
  const credit = (value: number): number => Math.round(value * 10_000) / 10_000
  const accounts = snapshot.packs.map(pack => ({
    displayDesc: pack.displayDesc,
    remain: credit(Math.max(0, (pack.creditsLimit ?? 0) - (pack.consumedCredits ?? 0))),
    size: pack.creditsLimit ?? 0,
  }))
  // `usage.credits_amount` is consumed credit, not remaining balance. Derive
  // each bucket's balance from its quota, matching total - consumed upstream.
  const remaining = (endpoint: number): number => snapshot.packs
    .filter(pack => pack.availableEndpoint === endpoint)
    .reduce((sum, pack) => credit(sum + Math.max(0, (pack.creditsLimit ?? 0) - (pack.consumedCredits ?? 0))), 0)
  return {
    total: totalAmount,
    consumed: consumedAmount,
    available: totalAmount - consumedAmount,
    workAvailable: remaining(1),
    generalAvailable: remaining(0),
    accounts,
  }
}

/** Map the check-in answer to the card's compact document. */
function toCheckin(status: {
  checkedIn: boolean
  credits: number
  enabled: boolean
  didCheckedIn: boolean
  extraCredits?: number
}): TraeWebCheckin {
  return {
    checkedIn: status.checkedIn,
    didCheckedIn: status.didCheckedIn,
    credits: status.credits,
    enabled: status.enabled,
    ...status.extraCredits === undefined ? {} : { extraCredits: status.extraCredits },
  }
}

/**
 * Assemble one region's card document. `region` is the tab the card is on; the
 * region-scoped store already answers with only that region's accounts, so the
 * document's model slots and account list are that region's by construction.
 * Sign-in state is read-only; credit is a live billing answer whose failure
 * degrades to `creditsError` rather than failing the whole document.
 */
export async function traeWebUsage(deps: TraeUsageRouteOptions, region: TraeRegion): Promise<TraeWebUsage> {
  const store = deps.store(region)
  const enabled = deps.regionEnabled(region)
  const accounts = await store.accounts()
  const authStatus = await store.status()
  if (authStatus.state !== 'signed-in') {
    // A bare "signed out" is undiagnosable on a machine whose layout differs
    // from the ones this plugin was written against — the reported WSL2/CLI
    // case. The probed paths and their failure reasons are safe to surface:
    // they carry paths and error text, never token material.
    const { failures } = await store.diagnose()
    return {
      status: 'signed-out',
      accounts,
      enabled,
      searched: failures.map(failure => ({
        path: failure.path,
        edition: failure.edition,
        source: failure.source,
        reason: failure.reason,
        ...failure.message === undefined ? {} : { message: safeMessage(failure.message) },
      })),
    }
  }
  let credential
  try {
    credential = await store.resolve()
  } catch (error: unknown) {
    // Account selection must remain available even when the selected token is
    // expired or its refresh request fails. Report that as account-level status
    // instead of converting the entire route into HTTP 500.
    return { status: 'signed-out', accounts, enabled, message: safeMessage(error) }
  }
  // Only user-facing identity and expiry cross to the browser. Token material
  // and stable user IDs stay on the Host. The requested region drives which
  // per-region model directory and selection this document reports, and which
  // usage surface the credits block reads.
  const account = {
    accountId: accounts.find(item => item.selected)?.id ?? '',
    accountName: credential.accountName ?? credential.userId,
    tokenExpiresAtMs: credential.expiresAtMs,
    region,
    enabled,
    accounts,
    models: deps.displayModels(region).map(model => ({ ...model, ...model.input === undefined ? {} : { input: [...model.input] } })),
    enabledModelIds: [...deps.enabledModelIds(region)],
    ...deps.rawDiagnostic === undefined ? {} : { rawChat: deps.rawDiagnostic(region) },
  }
  const client = deps.client(region)
  if (region === 'ai') {
    // The international region is subscription-based: read its pay status
    // instead of the CN Work-credit packs. A failure degrades to
    // payStatusError, exactly like creditsError on the CN side.
    try {
      const payStatus = await client.payStatus()
      return { status: 'signed-in', ...account, payStatus }
    } catch (error: unknown) {
      return { status: 'signed-in', ...account, payStatusError: safeMessage(error) }
    }
  }
  // Credits and check-in are independent reads, so they settle independently:
  // a broken check-in endpoint still leaves the credit panel usable, and vice
  // versa. Each failure degrades to its own error field rather than taking the
  // whole document down.
  const [snapshotResult, checkinResult] = await Promise.allSettled([
    client.snapshot(),
    client.checkinStatus(),
  ])
  return {
    status: 'signed-in',
    ...account,
    ...snapshotResult.status === 'fulfilled'
      ? { credits: toCredits(snapshotResult.value) }
      : { creditsError: safeMessage(snapshotResult.reason) },
    ...checkinResult.status === 'fulfilled'
      ? { checkin: toCheckin(checkinResult.value) }
      : { checkinError: safeMessage(checkinResult.reason) },
  }
}

/**
 * The region a request addresses, or a 400 answer. Absent parameter means the
 * domestic tab; an unknown value is refused rather than guessed.
 */
function requestRegion(req: IncomingMessage, res: ServerResponse): TraeRegion | undefined {
  const region = regionOfTraeStatusUrl(req.url ?? '/')
  if (region === undefined) {
    json(res, 400, { error: 'unknown region' })
    return undefined
  }
  return region
}

/** Mount the GET usage route on an optional webServer context. */
export function registerTraeUsageRoute(ctx: Context, deps: TraeUsageRouteOptions): void {
  ctx.effect(() => {
    const disposeUsage = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_USAGE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          json(res, 405, { error: 'method not allowed' })
          return
        }
        if (!loopbackOrigin(req)) {
          json(res, 403, { error: 'origin-not-trusted' })
          return
        }
        const region = requestRegion(req, res)
        if (region === undefined) return
        try {
          json(res, 200, await traeWebUsage(deps, region))
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    const disposeAccounts = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_ACCOUNTS_REFRESH_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const region = requestRegion(req, res)
        if (region === undefined) return
        try {
          json(res, 200, { accounts: await deps.store(region).accounts() })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    const disposeRefresh = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_MODELS_REFRESH_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        if (deps.discoverModels === undefined) return json(res, 503, { error: 'model refresh unavailable' })
        const region = requestRegion(req, res)
        if (region === undefined) return
        try {
          const models = await deps.discoverModels(region)
          json(res, 200, { models })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    /**
     * Daily check-in claim — the ONLY route in this plugin that mutates
     * upstream account state, so it is guarded more tightly than its siblings:
     * POST only, loopback origin only, and the status read runs FIRST so a day
     * the ACCOUNT has already been paid for never reaches the upstream claim.
     *
     * `alreadyCheckedIn` and `deviceCheckedIn` are deliberately separate
     * answers, because the two flags mean different things (see
     * {@link TraeWebCheckin}): `checkedIn` is the account's reward for today
     * existing, `didCheckedIn` is this MACHINE having spent its check-in —
     * possibly for a different account. Treating the latter as "claimed today"
     * was a shipped bug: after switching accounts the card said "claimed
     * today" and disabled the button, which is the right call for the wrong
     * reason and hides that the new account was never rewarded.
     *
     * The upstream is idempotent per Beijing day (verified 2026-09-24: a
     * repeat claim answers `code: 0` with the entitlement total unchanged), but
     * relying on that for correctness would put the guard in someone else's
     * hands.
     */
    const disposeCheckin = ctx.webServer.register({
      kind: 'exact',
      path: TRAE_CHECKIN_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
        if (!loopbackOrigin(req)) return json(res, 403, { error: 'origin-not-trusted' })
        const region = requestRegion(req, res)
        if (region === undefined) return
        if (region !== 'cn') {
          // The `/trae/api/v2/ug/*` family does not exist on the ai gateways
          // (404, probed 2026-09-24); answering 404 here states that plainly
          // instead of surfacing an upstream HTML 404 as a network fault.
          return json(res, 404, { error: 'check-in is not available for the international region' })
        }
        try {
          const client = deps.client(region)
          const current = await client.checkinStatus()
          if (!current.enabled) {
            return json(res, 409, { error: 'check-in is not enabled for this account' })
          }
          // Only the ACCOUNT-level flag stops a claim: this account's reward
          // for today already exists, so there is genuinely nothing to do and
          // no request is worth sending.
          if (current.checkedIn) {
            return json(res, 200, {
              claimed: false,
              alreadyCheckedIn: true,
              deviceCheckedIn: current.didCheckedIn,
              checkin: toCheckin(current),
            })
          }
          // The device is spent but this account is not: a claim can only be
          // refused (9095). Do not send it, and report the refusal truthfully.
          if (current.didCheckedIn) {
            return json(res, 200, {
              claimed: false,
              alreadyCheckedIn: false,
              deviceCheckedIn: true,
              code: CHECKIN_DEVICE_ALREADY_CLAIMED,
              message: 'this device already used today\'s check-in',
              checkin: toCheckin(current),
            })
          }
          const claim = await client.claimCheckin()
          const checkin = await client.checkinStatus()
          // 9095 is the upstream's own "该设备今日已参与签到": the device raced
          // us (another window, or the Trae app itself). It is a refusal, but a
          // benign one — reporting it as a hard error would tell the user
          // something is broken when the day is simply used up.
          const deviceClaimed = claim.code === CHECKIN_DEVICE_ALREADY_CLAIMED
          json(res, 200, {
            claimed: claim.claimed,
            alreadyCheckedIn: false,
            ...deviceClaimed ? { deviceCheckedIn: true } : {},
            code: claim.code,
            message: claim.message,
            checkin: toCheckin(checkin),
          })
        } catch (error: unknown) {
          json(res, 500, { error: safeMessage(error) })
        }
      },
    })
    return () => {
      disposeCheckin()
      disposeRefresh()
      disposeAccounts()
      disposeUsage()
    }
  }, 'dsh-connect-trae: Web usage route')
}
