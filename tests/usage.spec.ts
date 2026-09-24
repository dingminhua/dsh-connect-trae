import { describe, expect, it } from 'vitest'
import { TraeUsageClient, type TraeUsageOptions } from '../src/usage.ts'
import type { TraeCredential } from '../src/auth.ts'

const credential: TraeCredential = {
  accessToken: 'eyJhbGciOiJSUzI1NiJ9.signature',
  userId: 'uid',
  host: 'https://api.trae.cn',
  expiresAtMs: Date.now() + 1000,
  edition: 'solo',
  source: 'desktop',
}

function makeClient(json: () => Record<string, unknown>): { client: TraeUsageClient; urls: string[]; bodies: Record<string, unknown>[] } {
  const urls: string[] = []
  const bodies: Record<string, unknown>[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input))
    bodies.push(JSON.parse(String(init?.body ?? '{}')))
    return new Response(JSON.stringify(json()), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  const options: TraeUsageOptions = { credential: async () => credential, fetchImpl, baseUrl: 'https://api.trae.cn' }
  return { client: new TraeUsageClient(options), urls, bodies }
}

describe('TraeUsageClient', () => {
  it('parses the web_user_ent_usage snapshot', async () => {
    const { client, urls, bodies } = makeClient(() => ({
      is_credits_billing: true,
      is_dollar_usage_billing: false,
      is_pay_freshman: true,
      trial_status: { is_eligible_for_trial: false, is_in_trial: false, trial_end_time: 1785835060 },
      usage_summary: { consumed_amount: 5879.63, consumption_ratio: 0.7839506666666667, total_amount: 7500 },
      user_entitlement_pack_list: [
        {
          display_desc: '老用户福利',
          entitlement_base_info: {
            entitlement_id: '326737122050',
            end_time: 1788340660,
            currency: 1,
            available_endpoint: 1,
            quota: { credits_limit: 2000 },
            product_extra: { package_extra: { quota: { credits_limit: 2000 } } },
          },
          usage: { credits_amount: 2000 },
        },
        {
          display_desc: '签到奖励',
          entitlement_base_info: {
            entitlement_id: 'checkin_20260820_x',
            end_time: 1789837484,
            currency: 1,
            available_endpoint: 0,
            product_extra: { package_extra: { quota: { credits_limit: 200 } } },
          },
          usage: { credits_amount: 179.6288 },
        },
      ],
    }))
    const snapshot = await client.snapshot()
    expect(urls[0]).toBe('https://api.trae.cn/trae/api/v2/pay/web_user_ent_usage')
    expect(bodies[0]).toEqual({ require_usage: true })
    expect(snapshot.isCreditsBilling).toBe(true)
    expect(snapshot.summary).toEqual({ totalAmount: 7500, consumedAmount: 5879.63, consumptionRatio: 0.7839506666666667 })
    expect(snapshot.packs).toHaveLength(2)
    expect(snapshot.packs[0]).toMatchObject({ displayDesc: '老用户福利', availableEndpoint: 1, creditsLimit: 2000, consumedCredits: 2000 })
    expect(snapshot.packs[1]).toMatchObject({ displayDesc: '签到奖励', availableEndpoint: 0, creditsLimit: 200, consumedCredits: 179.6288 })
  })

  it('parses check-in status', async () => {
    const { client, urls } = makeClient(() => ({ checked_in: true, code: 0, credits: 200, enable: true }))
    const status = await client.checkinStatus()
    expect(urls[0]).toBe('https://api.trae.cn/trae/api/v2/ug/checkin_credits/status')
    expect(status).toEqual({ checkedIn: true, credits: 200, enabled: true, didCheckedIn: false })
  })

  it('carries did_checked_in and extra_credits off the live check-in answer', async () => {
    // The real CN answer (captured 2026-09-24) reports four fields the card
    // needs: `enable` gates the button, `did_checked_in` keeps an
    // already-claimed day disabled, and `extra_credits` is the bonus that
    // rides on top of the base reward.
    const { client } = makeClient(() => ({
      checked_in: true,
      code: 0,
      credits: 150,
      did_checked_in: true,
      enable: true,
      extra_credits: 50,
      message: 'success',
    }))
    const status = await client.checkinStatus()
    expect(status).toEqual({ checkedIn: true, credits: 150, enabled: true, didCheckedIn: true, extraCredits: 50 })
  })

  it('omits extraCredits when the upstream reports none', async () => {
    // `0` must read as absent rather than as a real bonus, so the card never
    // renders "+0".
    const { client } = makeClient(() => ({ checked_in: false, credits: 200, enable: true, extra_credits: 0 }))
    const status = await client.checkinStatus()
    expect(status).not.toHaveProperty('extraCredits')
  })

  it('claims the daily check-in with the installation device id', async () => {
    // The claim is refused with business code 9004 unless `x-device-id` is
    // present (verified against the live endpoint 2026-09-24), so the header
    // is part of the contract rather than an optional flourish.
    const seen: Record<string, string>[] = []
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>)
      return new Response(JSON.stringify({ code: 0, message: 'success' }), { status: 200 })
    }
    const client = new TraeUsageClient({
      credential: async () => credential,
      deviceId: async () => 'device-abc',
      fetchImpl,
      baseUrl: 'https://api.trae.cn',
    })
    const claim = await client.claimCheckin()
    expect(claim).toEqual({ claimed: true, code: 0, message: 'success' })
    expect(seen[0]?.['x-device-id']).toBe('device-abc')
  })

  it('reports a business refusal instead of throwing', async () => {
    // HTTP 200 + non-zero code is how the upstream refuses (e.g. 9004 when the
    // device header is missing). That is a business answer, not a transport
    // fault, so it must surface as `claimed: false` for the card to explain.
    const fetchImpl = async () => new Response(JSON.stringify({
      code: 9004,
      message: 'The submitted order parameters are incorrect. Please try placing the order again',
    }), { status: 200 })
    const client = new TraeUsageClient({ credential: async () => credential, fetchImpl, baseUrl: 'https://api.trae.cn' })
    const claim = await client.claimCheckin()
    expect(claim.claimed).toBe(false)
    expect(claim.code).toBe(9004)
    expect(claim.message).toContain('order parameters')
  })

  it('still reads check-in status when the device id cannot be resolved', async () => {
    // Identity resolution is best-effort: a machine whose storage layout we
    // cannot read must still get the read-only status, and only the claim is
    // then expected to be refused upstream.
    const seen: Record<string, string>[] = []
    const fetchImpl = async (_input: string | URL | Request, init?: RequestInit) => {
      seen.push(init?.headers as Record<string, string>)
      return new Response(JSON.stringify({ checked_in: false, credits: 150, enable: true }), { status: 200 })
    }
    const failing = new TraeUsageClient({
      credential: async () => credential,
      deviceId: async () => { throw new Error('no identity') },
      fetchImpl,
      baseUrl: 'https://api.trae.cn',
    })
    await expect(failing.checkinStatus()).resolves.toMatchObject({ checkedIn: false })
    expect(seen[0]?.['x-device-id']).toBeUndefined()

    const empty = new TraeUsageClient({
      credential: async () => credential,
      deviceId: async () => '',
      fetchImpl,
      baseUrl: 'https://api.trae.cn',
    })
    await expect(empty.checkinStatus()).resolves.toMatchObject({ checkedIn: false })
    expect(seen[1]?.['x-device-id']).toBeUndefined()
  })

  it('refuses to claim on the international region', async () => {
    // The `/trae/api/v2/ug/*` family does not exist on the ai gateways, so the
    // client refuses before spending a request on a known 404.
    const client = new TraeUsageClient({
      credential: async () => ({ ...credential, edition: 'sg' as const, host: 'https://api-sg-central.trae.ai' }),
      fetchImpl: async () => { throw new Error('should not fetch') },
    })
    await expect(client.claimCheckin()).rejects.toThrow(/only available for the CN region/)
  })

  it('parses activity rules', async () => {
    const { client } = makeClient(() => ({
      commercial_activities: [
        { Enabled: true, activity_id: 'new_user_credits', activity_type: 102, end_time_ms: 1798646400000, start_time_ms: 1785427200000, work_extra: { general_credits: 2000, work_credits: 2000 } },
        { Enabled: false, activity_id: 'off', activity_type: 99, end_time_ms: 0, start_time_ms: 0 },
      ],
    }))
    const activities = await client.activities()
    expect(activities).toHaveLength(2)
    expect(activities[0]).toMatchObject({ activityId: 'new_user_credits', enabled: true, workExtra: { general_credits: 2000, work_credits: 2000 } })
    expect(activities[1]!.enabled).toBe(false)
  })

  it('aggregates view across snapshot, check-in, and activities', async () => {
    let call = 0
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      call += 1
      if (url.endsWith('/web_user_ent_usage')) return new Response(JSON.stringify({ usage_summary: { total_amount: 7500, consumed_amount: 5879.63, consumption_ratio: 0.78 }, user_entitlement_pack_list: [] }), { status: 200 })
      if (url.endsWith('/checkin_credits/status')) return new Response(JSON.stringify({ checked_in: false, credits: 0, enable: true }), { status: 200 })
      return new Response(JSON.stringify({ commercial_activities: [] }), { status: 200 })
    }
    const client = new TraeUsageClient({ credential: async () => credential, fetchImpl, baseUrl: 'https://api.trae.cn' })
    const view = await client.view()
    expect(call).toBe(3)
    expect(view.snapshot.summary.totalAmount).toBe(7500)
    expect(view.checkin.checkedIn).toBe(false)
    expect(view.activities).toEqual([])
  })

  it('throws when the credential is missing', async () => {
    const fetchImpl = async () => { throw new Error('should not fetch') }
    const client = new TraeUsageClient({ credential: async () => undefined, fetchImpl, baseUrl: 'https://api.trae.cn' })
    await expect(client.snapshot()).rejects.toThrow('credential is not available')
  })

  it('throws on a non-2xx response', async () => {
    const fetchImpl = async () => new Response('boom', { status: 500 })
    const client = new TraeUsageClient({ credential: async () => credential, fetchImpl, baseUrl: 'https://api.trae.cn' })
    await expect(client.snapshot()).rejects.toThrow('HTTP 500')
  })
})

describe('region-scoped usage surface', () => {
  const intlCredential: TraeCredential = {
    accessToken: 'token', userId: 'intl-uid', host: 'https://growsg-normal.trae.ai', userRegion: 'SG',
    expiresAtMs: Date.now() + 86_400_000, edition: 'solo-sg', source: 'desktop',
  }

  it('reads the ai subscription status from its own gateway and parses it', async () => {
    const urls: string[] = []
    const origins: string[] = []
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      urls.push(url)
      origins.push(((init?.headers as Record<string, string>)['Origin']) ?? '')
      return new Response(JSON.stringify({
        is_dollar_usage_billing: true, has_package: true, is_pay_freshman_v2: true,
        trial_status: { is_in_trial: true, trial_end_time: 1789000000000 },
        enable_solo_lite: true, enable_solo_builder: false, enable_solo_coder: true, enable_solo_web: false,
        solo_fission_start_time: 1755000000000, solo_fission_expire_time: 1798000000000, solo_fission_max_usage: 30,
      }), { status: 200 })
    }
    const client = new TraeUsageClient({ credential: async () => intlCredential, fetchImpl })
    const status = await client.payStatus()
    expect(urls).toEqual(['https://growsg-normal.trae.ai/trae/api/v1/pay/ide_user_pay_status'])
    expect(origins).toEqual(['https://www.trae.ai'])
    expect(status).toMatchObject({
      isDollarUsageBilling: true, hasPackage: true, isPayFreshman: true,
      inTrial: true, trialEndTimeMs: 1789000000000,
      enableSoloLite: true, enableSoloBuilder: false, enableSoloCoder: true, enableSoloWeb: false,
      fission: { startTimeMs: 1755000000000, expireTimeMs: 1798000000000, maxUsage: 30 },
    })
  })

  it('guards the CN-only Work-credit methods with a diagnosable error on ai', async () => {
    const client = new TraeUsageClient({ credential: async () => intlCredential, fetchImpl: async () => { throw new Error('should not fetch') } })
    await expect(client.snapshot()).rejects.toThrow(/only available for the CN region/)
    await expect(client.checkinStatus()).rejects.toThrow(/only available for the CN region/)
    await expect(client.activities()).rejects.toThrow(/only available for the CN region/)
  })

  it('guards payStatus for CN credentials', async () => {
    const client = new TraeUsageClient({ credential: async () => credential, fetchImpl: async () => { throw new Error('should not fetch') } })
    await expect(client.payStatus()).rejects.toThrow(/only available for the international/)
  })
})
