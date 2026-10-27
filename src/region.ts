/**
 * Region model shared by every layer: two storage buckets (`cn` | `ai`) keyed
 * by the credential's own claim, plus the per-region gateway constants.
 *
 * Evidence: docs/INTL_SG_EVIDENCE.md (2026-09-15). The desktop installs of
 * both regions expose the same wire shapes; only the gateways, rosters, and
 * the refresh contract differ. `userRegion.region` ('CN' | 'SG', observed in
 * both cases; the desktop logs also spell it lowercase 'sg') is the
 * authoritative claim, the credential host suffix is the fallback, and the
 * edition label is the last resort.
 *
 * A THIRD claim exists and is recognized here without being served: the US
 * cluster (`userRegion: "US"`, hosts under `*.traeapi.us`, issue #66). It is a
 * {@link TraeServiceRegion} but not a {@link TraeRegion}; see
 * {@link assertSupportedRegion}.
 *
 * @module dsh-connect-trae/region
 */

import type { TraeEdition } from './paths.ts'

/** Storage/routing bucket: the CN service or the international (ai) service. */
export type TraeRegion = 'cn' | 'ai'

/**
 * The service a credential's own claims name.
 *
 * WIDER than {@link TraeRegion} on purpose. The US cluster is a real,
 * distinguishable Trae service — `userRegion: "US"` and hosts under
 * `*.traeapi.us` (issue #66, measured on an international 3.6.4 install:
 * `grow-normal.traeapi.us` answers the pay endpoint with 200 where the SG
 * gateway answers 401) — but this plugin does not serve it yet.
 *
 * Naming it as its own value is the whole fix: while the US claim was
 * unrecognised, `regionOfCredential` fell through to the edition label (`sg` →
 * `ai`) and shipped a US token to `*.trae.ai`, where every read answered 401
 * and the card reported it as a generic "refresh failed". A value the type
 * system carries forces every gateway site to say out loud what it does with a
 * region it cannot serve, instead of silently inheriting the SG routing.
 */
export type TraeServiceRegion = 'cn' | 'ai' | 'us'

/**
 * Code the Host reports for a region this build recognises but cannot serve.
 * The card and any external caller can switch on it; the message is only for
 * humans.
 */
export const TRAE_UNSUPPORTED_REGION_CODE = 'unsupported-region'

/** Message for a US credential, phrased to end the re-login loop. */
export const TRAE_UNSUPPORTED_REGION_MESSAGE =
  'This Trae account belongs to the United States region (userRegion "US", host *.traeapi.us), '
  + 'which dsh-connect-trae does not support yet. Requests are NOT sent to the Singapore gateway; '
  + 'sign in with a CN or Singapore account (or use the CN build of Trae) to use this panel.'

/**
 * A credential that resolved to a region this build does not serve.
 *
 * Thrown BEFORE any request is built, by every client that reads a credential:
 * the failure has to be a local, explicit verdict, not a 401 from the wrong
 * gateway (issue #66: a US token sent to `*.trae.ai` answers 401, which read as
 * "your sign-in expired" and produced an endless re-login loop).
 */
export class TraeUnsupportedRegionError extends Error {
  override name = 'TraeUnsupportedRegionError'
  readonly code = TRAE_UNSUPPORTED_REGION_CODE
  constructor(readonly region: Exclude<TraeServiceRegion, TraeRegion>) {
    super(TRAE_UNSUPPORTED_REGION_MESSAGE)
  }
}

/**
 * One section of the plugin card: a provider the user can switch, bind an
 * account to, and pick models for, INDEPENDENTLY.
 *
 * A panel is not a region. `cn` and `ai` happen to be one-to-one with regions,
 * but the CN enterprise pool shares the `cn` credential while billing a
 * different account and serving a different roster — it needs its own switch,
 * its own account binding and its own model selection, which is exactly what a
 * panel is. Keeping panels a separate concept from regions is what lets
 * `enterprise` be handled by the same settings plumbing with no new storage
 * shape: each panel is just one more slot in the `regions` map.
 */
export type TraePanel = 'cn' | 'ai' | 'enterprise'

/** Every panel, in card tab order. */
export const TRAE_PANELS: readonly TraePanel[] = ['cn', 'enterprise', 'ai']

/** The region whose credential/account pool a panel draws on. */
export function regionOfPanel(panel: TraePanel): TraeRegion {
  return panel === 'ai' ? 'ai' : 'cn'
}

/** The provider id a panel publishes. */
export function providerOfPanel(panel: TraePanel): string {
  if (panel === 'enterprise') return 'trae-enterprise'
  return panel === 'ai' ? 'trae-global' : 'trae'
}

/** The panel that owns a provider id, or undefined for an unknown id. */
export function panelOfProvider(provider: string): TraePanel | undefined {
  return TRAE_PANELS.find(panel => providerOfPanel(panel) === provider)
}

/** Narrow a stored settings key to a panel. */
export function panelOfKey(value: unknown): TraePanel | undefined {
  return (TRAE_PANELS as readonly string[]).includes(value as string) ? value as TraePanel : undefined
}

/** One region's upstream gateway bases. */
export interface TraeRegionGateways {
  /** Chat + agent API base (the `llm_utils_chat` / raw-chat family). */
  readonly chat: string
  /** SOLO remote model directory base (`/api/remote/v1`). */
  readonly remote: string
  /** Pay/status API base; the credential's own host is preferred when known. */
  readonly pay: string
}

/**
 * Verified gateway bases per region (docs/INTL_SG_EVIDENCE.md §2).
 * The AI gateway is shared by both international installs (Trae desktop and
 * TRAE SOLO); its mchost shards (`api16/api22-normal-alisg.mchost.guru`)
 * answer the same bytes but stay internal — `coresg-normal.trae.ai` is the
 * single stable entry point.
 */
export const REGION_GATEWAYS: Readonly<Record<TraeRegion, TraeRegionGateways>> = {
  cn: {
    chat: 'https://trae-api-cn.mchost.guru',
    remote: 'https://solo.trae.cn/api/remote/v1',
    pay: 'https://api.trae.cn',
  },
  ai: {
    chat: 'https://coresg-normal.trae.ai',
    remote: 'https://coresg-normal.trae.ai/api/remote/v1',
    pay: 'https://growsg-normal.trae.ai',
  },
}

/**
 * Enterprise (tenant) chat gateway for a CN credential that belongs to a
 * `tob_online` tenant.
 *
 * This is a SECOND chat gateway on the same credential, not a second region:
 * the roster, the credential and the protocol are the same as `cn`, but a
 * tenant account is billed against the enterprise pool when the request goes
 * here. Measured 2026-10-17 on a live `Trae CN` tenant account: the same model
 * served from this host does not move the personal `consumed_amount`, while
 * the same call to `trae-api-cn.mchost.guru` charges it.
 *
 * Two wire differences, both load-bearing:
 *  - the request must carry a per-call `session_id` (the consumer gateway
 *    rejects it with `4001`), and
 *  - a refused call answers **HTTP 200** whose FIRST SSE frame is
 *    `event:error` with `code: 4001` — not an HTTP error status, so the
 *    refusal is only visible if the response body is inspected.
 */
export const TRAE_ENTERPRISE_HOST = 'https://console.enterprise.trae.cn'

/** Region for an edition label: the international installs belong to `ai`. */
export function regionOfEdition(edition: TraeEdition): TraeRegion {
  return edition === 'sg' || edition === 'solo-sg' ? 'ai' : 'cn'
}

/**
 * Region from the credential's `userRegion` claim. The desktop storage spells
 * it as an object (`{"region":"CN","_aiRegion":"CN"}`); the app logs also
 * spell the bare value lowercase (`"sg"`). Both are accepted, case-blind.
 *
 * `"US"` is recognized as its own region (issue #66). It used to fall through
 * this function unrecognised, which is what let a US credential inherit the SG
 * routing from the edition label.
 */
export function regionOfUserRegion(value: unknown): TraeServiceRegion | undefined {
  const raw = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)['region']
    : value
  if (typeof raw !== 'string') return undefined
  const lowered = raw.trim().toLowerCase()
  if (lowered === 'cn') return 'cn'
  if (lowered === 'sg' || lowered === 'ai') return 'ai'
  if (lowered === 'us') return 'us'
  return undefined
}

/**
 * Region from a credential host (`.trae.ai` → ai, `.trae.cn`/`.trae.com.cn` →
 * cn, `.traeapi.us` → us).
 *
 * The US suffix is checked explicitly. It is NOT a special case of
 * `.trae.ai`: `grow-normal.traeapi.us` is a different cluster with its own
 * pay/pay-status endpoints, and the plugin's SG gateways answer a US token
 * with 401 (issue #66).
 */
export function regionOfHost(host: string | undefined): TraeServiceRegion | undefined {
  if (host === undefined) return undefined
  const trimmed = host.trim()
  if (trimmed === '') return undefined
  let hostname: string
  try {
    hostname = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`).hostname
  } catch {
    return undefined
  }
  if (hostname === 'traeapi.us' || hostname.endsWith('.traeapi.us')) return 'us'
  if (hostname === 'trae.ai' || hostname.endsWith('.trae.ai')) return 'ai'
  if (hostname === 'trae.cn' || hostname.endsWith('.trae.cn') || hostname.endsWith('.trae.com.cn')) return 'cn'
  return undefined
}

/**
 * Region of a credential: the `userRegion` claim wins, the host suffix is the
 * fallback, and the edition label is the last resort. Every level is derived
 * from data the credential itself carries, so no user configuration is needed.
 *
 * The edition fallback is only ever reached by a credential that carries
 * NEITHER a claim NOR a resolvable host (a CLI token). That matters: it is the
 * reason a US credential no longer becomes `ai` — its own claim resolves first.
 */
export function regionOfCredential(credential: {
  edition: TraeEdition
  host?: string
  userRegion?: string
}): TraeServiceRegion {
  return regionOfUserRegion(credential.userRegion)
    ?? regionOfHost(credential.host)
    ?? regionOfEdition(credential.edition)
}

/** Whether this build actually serves the region (only `cn` and `ai` today). */
export function isSupportedRegion(region: TraeServiceRegion): region is TraeRegion {
  return region !== 'us'
}

/**
 * Narrow a resolved credential region to a servable bucket, or throw
 * {@link TraeUnsupportedRegionError}.
 *
 * Every gateway lookup goes through this instead of indexing
 * `REGION_GATEWAYS`/`TRAE_REMOTE_DIRECTORY_FUNCTIONS` directly: those maps hold
 * only the two supported clusters, and the missing index IS the bug in issue
 * #66 (`REGION_GATEWAYS[regionOfCredential(us)]` silently read the `ai` entry,
 * because the resolver had already rounded the US claim down to SG).
 */
export function assertSupportedRegion(region: TraeServiceRegion): TraeRegion {
  if (!isSupportedRegion(region)) throw new TraeUnsupportedRegionError(region)
  return region
}
