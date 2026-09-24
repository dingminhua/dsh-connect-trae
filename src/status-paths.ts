/**
 * Node-free constants and types shared by the Host and browser halves.
 * Mirrors the `dsh-workbuddy-connect` status-route pattern so the plugin card
 * stays consistent with that project's external presentation.
 */
import type { TraeRegion } from './region.ts'

/** Plugin-owned usage endpoint consumed by its browser half. */
export const TRAE_USAGE_PATH = '/plugins/dsh-connect-trae/usage'
/** Plugin-owned live model refresh endpoint. */
export const TRAE_MODELS_REFRESH_PATH = '/plugins/dsh-connect-trae/models/refresh'
/** Plugin-owned local account rescan endpoint. */
export const TRAE_ACCOUNTS_REFRESH_PATH = '/plugins/dsh-connect-trae/accounts/refresh'
/**
 * Plugin-owned daily check-in claim endpoint. POST, loopback-only, and the only
 * route in this plugin that changes upstream account state.
 */
export const TRAE_CHECKIN_PATH = '/plugins/dsh-connect-trae/checkin'

/** Query parameter naming the region a card request addresses. */
export const TRAE_REGION_PARAM = 'region'

/** Every region, in card tab order. */
export const TRAE_REGIONS: readonly TraeRegion[] = ['cn', 'ai']

/**
 * Address one region's status route. The two regions are separate provider
 * stacks; every card request carries the region whose tab the user is on.
 */
export function withTraeRegion(path: string, region: TraeRegion): string {
  return `${path}?${TRAE_REGION_PARAM}=${region}`
}

/**
 * Read the region parameter off a status-route URL. Absent means the domestic
 * tab (`cn`); a present-but-unknown value returns undefined so the route can
 * answer 400 instead of guessing.
 */
export function regionOfTraeStatusUrl(url: string): TraeRegion | undefined {
  const at = url.indexOf('?')
  const value = at === -1 ? null : new URLSearchParams(url.slice(at + 1)).get(TRAE_REGION_PARAM)
  if (value === null || value === '') return 'cn'
  return (TRAE_REGIONS as readonly string[]).includes(value) ? value as TraeRegion : undefined
}

/** One credit pack and its remaining credit. */
export interface TraeWebCreditAccount {
  displayDesc: string
  remain: number
  size: number
}

/** Aggregated usage/credit answer rendered by the plugin card. */
export interface TraeWebCredits {
  total: number
  consumed: number
  available: number
  workAvailable: number
  generalAvailable: number
  accounts: readonly TraeWebCreditAccount[]
}

/** Editable Trae model row rendered by the plugin-owned settings card. */
export interface TraeWebModel {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  input?: ('text' | 'image')[]
  creditMultiplier?: number
  reasoningSupported?: boolean
  reasoning?: {
    supported: string[]
    defaultEffort?: string
  }
  maxContextWindow?: number
}

/**
 * Daily check-in state rendered below the credit stats.
 *
 * `didCheckedIn` is not redundant with `checkedIn`: the upstream reports them
 * separately, and the official client keeps the claim button disabled for the
 * rest of the Beijing day off `did_checked_in` even when a status read comes
 * back `checked_in: false`. The card mirrors that rule so a stale-looking
 * status cannot invite a pointless second claim.
 */
export interface TraeWebCheckin {
  checkedIn: boolean
  didCheckedIn: boolean
  credits: number
  enabled: boolean
  extraCredits?: number
}

/** The claim route's answer, so the card can report a business refusal verbatim. */
export interface TraeWebCheckinClaim {
  /** False when the upstream answered a non-zero business code (e.g. 9004). */
  claimed: boolean
  /** True when today was already claimed, so nothing was sent upstream. */
  alreadyCheckedIn: boolean
  code?: number
  message?: string
  /** The refreshed check-in state, present whenever the claim path ran. */
  checkin?: TraeWebCheckin
}

/** One reward activity rule (name + work/general credits when present). */
export interface TraeWebActivity {
  activityId: string
  enabled: boolean
  workCredits?: number
  generalCredits?: number
}

export interface TraeWebAccount {
  id: string
  accountName: string
  edition: 'cn' | 'sg' | 'solo' | 'solo-sg'
  /** Routing bucket of this account, derived from its credential. */
  region: TraeRegion
  source: 'desktop' | 'dsh' | 'cli'
  tokenExpiresAtMs: number
  selected: boolean
}

/** One probed candidate path and why it did not yield an account. */
export interface TraeWebSearchPath {
  path: string
  edition: 'cn' | 'sg' | 'solo' | 'solo-sg'
  source: 'desktop' | 'cli'
  reason: 'missing' | 'unreadable' | 'invalid'
  message?: string
}

/**
 * Build the next `regions` settings value for the card's save. The write
 * targets ONLY the signed-in account's region slot; every other region's slot
 * is carried over untouched, so switching accounts never clobbers the other
 * region's picks. Tolerates any stored shape (absent, non-object) by starting
 * from an empty document.
 */
export function nextRegionSlots<Slot extends object>(
  regions: unknown,
  region: TraeRegion,
  slot: Slot,
): Record<string, unknown> {
  const base = typeof regions === 'object' && regions !== null && !Array.isArray(regions)
    ? regions as Record<string, unknown>
    : {}
  return { ...base, [region]: slot }
}

/**
 * Narrow a settings value to the `regions` map. Accepts EITHER the whole
 * settings section (`{ regions: {...}, ... }`) or the `regions` map itself, and
 * unwraps the former. This tolerance is deliberate: passing the whole section
 * where the map was expected was a real shipped bug — the lookup then read
 * `section['cn']` (absent), so the card's checkbox reported `true` forever and
 * clicking it appeared to do nothing even though the write succeeded.
 */
function regionsMapOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const record = value as Record<string, unknown>
  const nested = record['regions']
  if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
    return nested as Record<string, unknown>
  }
  return record
}

/** One region's stored slot as a plain object; any other shape reads as empty. */
function regionSlotOf(value: unknown, region: TraeRegion): Record<string, unknown> {
  const slot = regionsMapOf(value)[region]
  return typeof slot === 'object' && slot !== null && !Array.isArray(slot)
    ? slot as Record<string, unknown>
    : {}
}

/**
 * Whether one region's provider is switched on. Opt-out semantics: only an
 * explicit `false` disables it, so a config written before this switch existed
 * (and the pre-region-split flat fields, which never carry `enabled`) keep both
 * providers running exactly as before. The Host reads the same rule through
 * `regionStateOf`, so card and Host can never disagree about a region's state.
 *
 * `value` may be the whole settings section or the `regions` map (see
 * {@link regionsMapOf}).
 */
export function regionEnabledOf(value: unknown, region: TraeRegion): boolean {
  return regionSlotOf(value, region)['enabled'] !== false
}

/**
 * Build the next `regions` settings value for a provider on/off toggle. ONLY
 * the target region's `enabled` flag changes: every other field of that slot
 * (its directory, selection, image opt-ins, context budgets) and every other
 * region's slot are carried over verbatim, so switching a provider off never
 * discards the user's model picks and switching it back on restores them.
 *
 * This is deliberately separate from {@link nextRegionSlots}: that helper
 * writes a whole slot from a signed-in tab's draft, while this one must work
 * for a region that is signed OUT — which is precisely the region a user wants
 * to switch off (no international install, no international account).
 *
 * `value` may be the whole settings section or the `regions` map; the RETURN
 * value is always the `regions` map, i.e. exactly what `settingsScope.set(
 * 'regions', ...)` needs.
 */
export function nextRegionEnabled(
  value: unknown,
  region: TraeRegion,
  enabled: boolean,
): Record<string, unknown> {
  return nextRegionSlots(regionsMapOf(value), region, { ...regionSlotOf(value, region), enabled })
}

/** Subscription status of an international (ai) account, rendered instead of the CN credit packs. */
export interface TraeWebPayStatus {
  isDollarUsageBilling: boolean
  hasPackage: boolean
  isPayFreshman: boolean
  inTrial: boolean
  trialEndTimeMs: number
  enableSoloLite: boolean
  enableSoloBuilder: boolean
  enableSoloCoder: boolean
  enableSoloWeb: boolean
  fission?: { startTimeMs: number; expireTimeMs: number; maxUsage: number }
}

/** The JSON document the plugin card renders. */
export type TraeWebUsage =
  | { status: 'signed-out'; accounts: readonly TraeWebAccount[]; message?: string; searched?: readonly TraeWebSearchPath[]; enabled?: boolean }
  | {
    status: 'signed-in'
    accountId: string
    accountName: string
    tokenExpiresAtMs: number
    /** Which per-region model directory and selection this account owns. */
    region: TraeRegion
    /** Whether this region's provider is currently offered to DSH. */
    enabled?: boolean
    accounts: readonly TraeWebAccount[]
    models: readonly TraeWebModel[]
    enabledModelIds: readonly string[]
    rawChat?: {
      state: 'disabled' | 'unchecked' | 'available' | 'protocol-gated' | 'authentication' | 'credit' | 'rate' | 'transport' | 'server'
      checkedAtMs?: number
      status?: number
    }
    credits?: TraeWebCredits
    creditsError?: string
    /**
     * Daily check-in state (CN only). Absent on the international region,
     * whose check-in surface does not exist — probed 2026-09-24: the
     * `/trae/api/v2/ug/*` family answers 404 on every ai gateway, so the card
     * shows no claim button there rather than a button that cannot work.
     */
    checkin?: TraeWebCheckin
    checkinError?: string
    /** Subscription status of an international account (region ai only). */
    payStatus?: TraeWebPayStatus
    payStatusError?: string
  }
  | { status: 'error'; message: string }
