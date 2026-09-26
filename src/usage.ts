import type { TraeCredential } from './auth.ts'
import { REGION_GATEWAYS, regionOfCredential } from './region.ts'

/**
 * Read-only Trae usage/credits client.
 *
 * CN sources the verified `api.trae.cn` pay/ug endpoints (see
 * `docs/USAGE_API_RESEARCH.md`); the international (ai) region is
 * subscription-based and reads `ide_user_pay_status` on its own gateway
 * (verified 2026-09-15, docs/INTL_SG_EVIDENCE.md §4). All queries are
 * read-only and do not consume Trae credits. The per-session consumption
 * detail table is deliberately not included: the endpoint returns no rows
 * for the current account, so we only expose what is actually retrievable.
 */

export const TRAE_PAY_BASE = 'https://api.trae.cn'

export interface TraeUsageOptions {
  credential(): Promise<TraeCredential | undefined>
  /**
   * Device identity of the credential's own installation, sent as
   * `x-device-id` on the check-in routes.
   *
   * The claim endpoint is the one WRITE in this client, and it is guarded
   * server-side by that header: with the same Authorization but no
   * `x-device-id`, the upstream answers HTTP 200 with business code `9004`
   * ("The submitted order parameters are incorrect") and grants nothing —
   * verified 2026-09-24 against a live CN account, where adding the header
   * flipped the same request to `code: 0` and the daily reward landed. The
   * official client sends it on every check-in call
   * (`main.js`'s `fb(headers)` sets `x-device-id` from `guaranteedDeviceId`).
   * Absent, the client still reads status; only the claim refuses.
   */
  deviceId?(): Promise<string | undefined>
  fetchImpl?: typeof fetch
  baseUrl?: string
  timeoutMs?: number
}

/**
 * Subscription/pay status of an international (ai) account, parsed from the
 * `ide_user_pay_status` answer. The international region has no Work-credit
 * packs, so this — not `snapshot` — is its usage surface.
 */
export interface TraePayStatus {
  isDollarUsageBilling: boolean
  hasPackage: boolean
  isPayFreshman: boolean
  inTrial: boolean
  trialEndTimeMs: number
  enableSoloLite: boolean
  enableSoloBuilder: boolean
  enableSoloCoder: boolean
  enableSoloWeb: boolean
  /** The fission (referral) program window and cap, when exposed. */
  fission?: { startTimeMs: number; expireTimeMs: number; maxUsage: number }
}

export interface TraeUsageSummary {
  totalAmount: number
  consumedAmount: number
  consumptionRatio: number
}

export interface TraeUsagePack {
  displayDesc: string
  entitlementId: string
  endTimeMs: number
  currency: number
  /** 0 = non-Work/general endpoint, 1 = Work endpoint. */
  availableEndpoint?: number
  creditsLimit?: number
  /** Credits consumed from this pack (`usage.credits_amount`). */
  consumedCredits?: number
}

export interface TraeUsageSnapshot {
  isCreditsBilling: boolean
  isDollarUsageBilling: boolean
  isPayFreshman: boolean
  inTrial: boolean
  trialEndTimeMs: number
  summary: TraeUsageSummary
  packs: TraeUsagePack[]
}

export interface TraeCheckinStatus {
  /**
   * Whether the account's REWARD PACK for today already exists. This is the
   * account-wide answer and it is the one that decides whether there is
   * anything left to claim: a day with `checkedIn: true` has already been paid
   * out, whichever device produced it.
   */
  checkedIn: boolean
  /** Reward for one check-in, as reported by the upstream (`credits`). */
  credits: number
  enabled: boolean
  /**
   * Whether THIS device's claim for today was already recorded. The upstream
   * keys this on the `x-device-id` the request carries — not on the account —
   * so it answers `true` for the device that claimed and `false` for the same
   * account and day read from any other device.
   *
   * Measured 2026-09-26 on a live CN account whose claim had succeeded minutes
   * earlier: `did_checked_in` was `true` with the claiming device id and
   * `false` with the header omitted, with a synthetic id, and with another
   * install's id. Repeating the read never flips it, so it is not "have I seen
   * you before" state either — only an actual claim sets it.
   *
   * It is therefore NOT a "today is done" signal on its own (claiming again
   * answers the upstream's own 9095 "该设备今日已参与签到" refusal); it is
   * evidence that this exact device is already accounted for, which is what
   * makes a claim safe to skip.
   */
  didCheckedIn: boolean
  /** Bonus credit granted on top of the base reward, when the upstream reports one. */
  extraCredits?: number
}

/** Result of claiming today's check-in reward. */
export interface TraeCheckinClaim {
  /** Whether the upstream accepted the claim (`code === 0`). */
  claimed: boolean
  /** Business code from the answer; `0` on success. */
  code: number
  /** Upstream message, verbatim but truncated — never token material. */
  message: string
}

export interface TraeActivityRule {
  activityId: string
  enabled: boolean
  activityType: number
  startTimeMs: number
  endTimeMs: number
  workExtra?: Record<string, unknown>
}

export interface TraeUsageView {
  snapshot: TraeUsageSnapshot
  checkin: TraeCheckinStatus
  activities: TraeActivityRule[]
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseUsageSnapshot(payload: Record<string, unknown>): TraeUsageSnapshot {
  const summaryRaw = payload['usage_summary'] as Record<string, unknown> | undefined
  const summary: TraeUsageSummary = {
    totalAmount: asNumber(summaryRaw?.['total_amount']) ?? 0,
    consumedAmount: asNumber(summaryRaw?.['consumed_amount']) ?? 0,
    consumptionRatio: asNumber(summaryRaw?.['consumption_ratio']) ?? 0,
  }
  const trial = payload['trial_status'] as Record<string, unknown> | undefined
  const packs: TraeUsagePack[] = []
  const rawPacks = Array.isArray(payload['user_entitlement_pack_list']) ? payload['user_entitlement_pack_list'] : []
  for (const raw of rawPacks) {
    if (typeof raw !== 'object' || raw === null) continue
    const pack = raw as Record<string, unknown>
    const base = pack['entitlement_base_info'] as Record<string, unknown> | undefined
    const quota = base?.['quota'] as Record<string, unknown> | undefined
    const usage = pack['usage'] as Record<string, unknown> | undefined
    const productExtra = base?.['product_extra'] as Record<string, unknown> | undefined
    const packageExtra = productExtra?.['package_extra'] as Record<string, unknown> | undefined
    const packageQuota = packageExtra?.['quota'] as Record<string, unknown> | undefined
    const creditsLimit = asNumber(packageQuota?.['credits_limit']) ?? asNumber(quota?.['credits_limit'])
    const consumedCredits = asNumber(usage?.['credits_amount'])
    const availableEndpoint = asNumber(base?.['available_endpoint'])
    packs.push({
      displayDesc: typeof pack['display_desc'] === 'string' ? pack['display_desc'] : '',
      entitlementId: typeof base?.['entitlement_id'] === 'string' ? base['entitlement_id'] : '',
      endTimeMs: asNumber(base?.['end_time']) ?? 0,
      currency: asNumber(base?.['currency']) ?? 0,
      ...availableEndpoint === undefined ? {} : { availableEndpoint },
      ...creditsLimit === undefined ? {} : { creditsLimit },
      ...consumedCredits === undefined ? {} : { consumedCredits },
    })
  }
  return {
    isCreditsBilling: payload['is_credits_billing'] === true,
    isDollarUsageBilling: payload['is_dollar_usage_billing'] === true,
    isPayFreshman: payload['is_pay_freshman'] === true,
    inTrial: trial?.['is_in_trial'] === true,
    trialEndTimeMs: asNumber(trial?.['trial_end_time']) ?? 0,
    summary,
    packs,
  }
}

/**
 * A client for the verified Trae usage/credits endpoints.
 *
 * Every method is read-only except {@link TraeUsageClient.claimCheckin}, which
 * claims the daily check-in reward — the one deliberate mutation, requested by
 * the user from the card and guarded before it is sent.
 */
export class TraeUsageClient {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string | undefined
  private readonly timeoutMs: number

  constructor(private readonly options: TraeUsageOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl
    this.timeoutMs = options.timeoutMs ?? 30_000
  }

  /** Region of the current credential; `cn` when unresolvable. */
  private async currentRegion(): Promise<'cn' | 'ai'> {
    const credential = await this.options.credential()
    return credential === undefined ? 'cn' : regionOfCredential(credential)
  }

  /**
   * Pay base for the current credential's region. An explicit baseUrl (tests,
   * diagnostics) pins the endpoint; otherwise CN uses `api.trae.cn` and the
   * international region its own verified pay gateway.
   */
  private async payBase(): Promise<string> {
    return this.baseUrl ?? REGION_GATEWAYS[await this.currentRegion()].pay
  }

  /**
   * Device id for the check-in routes, or undefined when the machine's
   * installation identity cannot be read. Best-effort on purpose: a missing
   * identity must not break the read-only status query, which the upstream
   * answers with or without the header.
   */
  private async deviceIdHeader(): Promise<Record<string, string>> {
    try {
      const deviceId = await this.options.deviceId?.()
      return deviceId === undefined || deviceId === '' ? {} : { 'x-device-id': deviceId }
    } catch {
      return {}
    }
  }

  private async authedHeaders(): Promise<Record<string, string>> {
    const credential = await this.options.credential()
    if (credential === undefined || credential.accessToken === '') {
      throw new Error('Trae credential is not available; cannot query usage')
    }
    const origin = await this.currentRegion() === 'ai' ? 'https://www.trae.ai' : 'https://www.trae.cn'
    return {
      'Authorization': `Cloud-IDE-JWT ${credential.accessToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0',
      'Origin': origin,
      'Referer': `${origin}/`,
    }
  }

  private async post<T>(
    path: string,
    data: Record<string, unknown>,
    signal?: AbortSignal,
    extraHeaders: Record<string, string> = {},
  ): Promise<T> {
    const headers = { ...await this.authedHeaders(), ...extraHeaders }
    const response = await this.fetchImpl(`${await this.payBase()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: signal ?? AbortSignal.timeout(this.timeoutMs),
    })
    if (!response.ok) throw new Error(`Trae usage endpoint ${path} returned HTTP ${response.status}`)
    return await response.json() as T
  }

  /**
   * Subscription/pay status of an international (ai) account. The CN region
   * never calls this (its contract is unverified there); the ai region uses
   * this instead of the Work-credit `snapshot`.
   */
  async payStatus(signal?: AbortSignal): Promise<TraePayStatus> {
    const region = await this.currentRegion()
    if (region !== 'ai') throw new Error('Trae pay status is only available for the international (ai) region')
    const payload = await this.post<Record<string, unknown>>('/trae/api/v1/pay/ide_user_pay_status', {}, signal)
    const flag = (key: string): boolean => payload[key] === true
    const trial = typeof payload['trial_status'] === 'object' && payload['trial_status'] !== null
      ? payload['trial_status'] as Record<string, unknown>
      : {}
    const fissionStart = asNumber(payload['solo_fission_start_time'])
    const fissionExpire = asNumber(payload['solo_fission_expire_time'])
    const fissionMax = asNumber(payload['solo_fission_max_usage'])
    return {
      isDollarUsageBilling: flag('is_dollar_usage_billing'),
      hasPackage: flag('has_package'),
      isPayFreshman: flag('is_pay_freshman') || flag('is_pay_freshman_v2'),
      inTrial: trial['is_in_trial'] === true,
      trialEndTimeMs: asNumber(trial['trial_end_time']) ?? 0,
      enableSoloLite: flag('enable_solo_lite'),
      enableSoloBuilder: flag('enable_solo_builder'),
      enableSoloCoder: flag('enable_solo_coder'),
      enableSoloWeb: flag('enable_solo_web'),
      ...fissionStart === undefined || fissionExpire === undefined || fissionMax === undefined ? {} : {
        fission: { startTimeMs: fissionStart, expireTimeMs: fissionExpire, maxUsage: fissionMax },
      },
    }
  }

  /**
   * The Work-credit endpoints are CN-only. The international region is
   * subscription-based and must read {@link payStatus} instead; guarding here
   * keeps the card's degraded `creditsError` message diagnosable rather than
   * letting an ai credential hit an unverified path on its pay gateway.
   */
  private async requireCnRegion(method: string): Promise<void> {
    if (await this.currentRegion() !== 'cn') {
      throw new Error(`Trae ${method} is only available for the CN region; the international (ai) region uses payStatus`)
    }
  }

  /** Total entitlements / credits and per-pack breakdown. */
  async snapshot(signal?: AbortSignal): Promise<TraeUsageSnapshot> {
    await this.requireCnRegion('usage snapshot')
    const payload = await this.post<Record<string, unknown>>('/trae/api/v2/pay/web_user_ent_usage', { require_usage: true }, signal)
    return parseUsageSnapshot(payload)
  }

  /**
   * Daily check-in status. Read-only, and answered with or without the device
   * header — the claim is what needs it.
   *
   * The read DOES carry the header whenever this installation has one, and
   * that is deliberate rather than incidental: `did_checked_in` is answered
   * per device, so omitting the header would make a device that already claimed
   * today look identical to one that never has (measured 2026-09-26, see
   * {@link TraeCheckinStatus.didCheckedIn}).
   */
  async checkinStatus(signal?: AbortSignal): Promise<TraeCheckinStatus> {
    await this.requireCnRegion('check-in status')
    const headers = await this.deviceIdHeader()
    const payload = await this.post<Record<string, unknown>>('/trae/api/v2/ug/checkin_credits/status', {}, signal, headers)
    const extraCredits = asNumber(payload['extra_credits'])
    return {
      checkedIn: payload['checked_in'] === true,
      credits: asNumber(payload['credits']) ?? 0,
      enabled: payload['enable'] !== false,
      didCheckedIn: payload['did_checked_in'] === true,
      ...extraCredits === undefined || extraCredits <= 0 ? {} : { extraCredits },
    }
  }

  /**
   * Claim today's check-in reward. The ONLY state-changing call in this client.
   *
   * The upstream is idempotent per Beijing day (verified 2026-09-24: repeating
   * the call on an already-claimed day answers `code: 0` while the entitlement
   * total stays byte-identical), so a double click cannot double-grant. The
   * card and its route still guard, because "cannot double-grant" is a property
   * of the upstream we verify rather than one we rely on.
   *
   * A business refusal arrives as HTTP 200 with a non-zero `code` — most often
   * `9004` when the request carries no `x-device-id`. That is reported as
   * `claimed: false` rather than thrown, so the caller can tell "the upstream
   * refused this" apart from "the request never arrived".
   */
  async claimCheckin(signal?: AbortSignal): Promise<TraeCheckinClaim> {
    await this.requireCnRegion('check-in claim')
    const headers = await this.deviceIdHeader()
    const payload = await this.post<Record<string, unknown>>('/trae/api/v2/ug/checkin_credits/claim', {}, signal, headers)
    const code = asNumber(payload['code']) ?? 0
    return {
      claimed: code === 0,
      code,
      message: typeof payload['message'] === 'string' ? payload['message'].slice(0, 200) : '',
    }
  }

  /** Rewards / activity rules. */
  async activities(signal?: AbortSignal): Promise<TraeActivityRule[]> {
    await this.requireCnRegion('activities')
    const payload = await this.post<Record<string, unknown>>('/trae/api/v2/ug/activity/info', {}, signal)
    const rawActivities = Array.isArray(payload['commercial_activities']) ? payload['commercial_activities'] : []
    const activities: TraeActivityRule[] = []
    for (const raw of rawActivities) {
      if (typeof raw !== 'object' || raw === null) continue
      const rule = raw as Record<string, unknown>
      activities.push({
        activityId: typeof rule['activity_id'] === 'string' ? rule['activity_id'] : '',
        enabled: rule['Enabled'] === true,
        activityType: asNumber(rule['activity_type']) ?? 0,
        startTimeMs: asNumber(rule['start_time_ms']) ?? 0,
        endTimeMs: asNumber(rule['end_time_ms']) ?? 0,
        ...rule['work_extra'] === undefined ? {} : { workExtra: rule['work_extra'] as Record<string, unknown> },
      })
    }
    return activities
  }

  /** Convenience: snapshot + check-in + activities in one call (best-effort, non-fatal on missing). */
  async view(signal?: AbortSignal): Promise<TraeUsageView> {
    const [snapshot, checkin, activities] = await Promise.all([
      this.snapshot(signal),
      this.checkinStatus(signal),
      this.activities(signal),
    ])
    return { snapshot, checkin, activities }
  }
}
