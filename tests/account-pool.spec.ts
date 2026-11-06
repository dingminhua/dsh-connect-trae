import { describe, expect, it } from 'vitest'
import type { TraeCredential } from '../src/auth.ts'
import type { TraeModelInfo } from '../src/catalog.ts'
import {
  MODEL_BUSY_COOLDOWN_MS,
  POOL_UNKNOWN_COOLDOWN_MS,
  billableMembers,
  createLatestWins,
  effectiveMembersOf,
  exclusionOf,
  outcomeIsCredential,
  outcomeIsModelScoped,
  outcomeOfVerdict,
  pickAccount,
  pickFreeModel,
  poolKeyOfPanel,
  rankPool,
  resolveTargetModel,
  type TraePoolMember,
  type TraePoolProbe,
} from '../src/account-pool.ts'
import { probeUpdatesOf, type TraePoolTestRow } from '../src/account-pool-run.ts'
import { mergePoolProbe } from '../src/account-pool-store.ts'
import {
  checkinAllAccounts,
  testAllAccounts,
  POOL_BATCH_GAP_MS,
  type TraePoolRunnerDeps,
} from '../src/account-pool-run.ts'
import { parseUpstreamResetAt } from '../src/reset-time.ts'
import { TRAE_ACCOUNT_ID_RE, isTraeAccountId, traeAccountId } from '../src/auth.ts'

const NOW = 1_700_000_000_000

const credential: TraeCredential = {
  accessToken: 'eyJhbGciOiJSUzI1NiJ9.signature',
  userId: 'uid',
  accountName: 'demo-user',
  host: 'https://api.trae.cn',
  expiresAtMs: NOW + 60_000,
  edition: 'solo',
  source: 'desktop',
}

function member(
  id: string,
  overrides: Partial<TraePoolMember> & { credits?: TraePoolMember['credits'] } = {},
): TraePoolMember {
  return { account: { id, accountName: id }, ...overrides }
}

function probe(overrides: Partial<TraePoolProbe> & Pick<TraePoolProbe, 'outcome'>): TraePoolProbe {
  return { atMs: NOW, ...overrides }
}

describe('exclusionOf', () => {
  it('keeps an untested account a candidate', () => {
    expect(exclusionOf(undefined, NOW)).toBeUndefined()
  })

  it('keeps a successful measurement a candidate', () => {
    expect(exclusionOf(probe({ outcome: 'ok' }), NOW)).toBeUndefined()
  })

  it('never excludes an account for a content-policy refusal', () => {
    // A policy rejection is a fact about ONE REQUEST, not about the account.
    expect(exclusionOf(probe({ outcome: 'policy-rejected' }), NOW)).toBeUndefined()
  })

  it('excludes a rejected credential and a gated plan permanently', () => {
    expect(exclusionOf(probe({ outcome: 'credential-rejected' }), NOW)).toBe('credential-rejected')
    expect(exclusionOf(probe({ outcome: 'plan-gated' }), NOW)).toBe('plan-gated')
    expect(exclusionOf(probe({ outcome: 'not-found' }), NOW)).toBe('not-found')
  })

  it('lets a transient outcome back in once its fallback cooldown elapses', () => {
    const measured = probe({ outcome: 'rate-limited' })
    expect(exclusionOf(measured, NOW)).toBe('rate-limited')
    expect(exclusionOf(measured, NOW + POOL_UNKNOWN_COOLDOWN_MS)).toBeUndefined()
  })

  it('honours an upstream-stated recovery time over the fallback', () => {
    const measured = probe({ outcome: 'rate-limited', retryAtMs: NOW + 5_000 })
    expect(exclusionOf(measured, NOW + 1_000)).toBe('rate-limited')
    // Well before the half-hour fallback would have released it.
    expect(exclusionOf(measured, NOW + 5_000)).toBeUndefined()
  })

  it('cools a busy model on its own short clock, not the generic one', () => {
    const measured = probe({ outcome: 'model-busy' })
    expect(exclusionOf(measured, NOW + MODEL_BUSY_COOLDOWN_MS - 1)).toBe('model-busy')
    expect(exclusionOf(measured, NOW + MODEL_BUSY_COOLDOWN_MS)).toBeUndefined()
    expect(MODEL_BUSY_COOLDOWN_MS).toBeLessThan(POOL_UNKNOWN_COOLDOWN_MS)
  })

  it('treats an outcome this build does not know as unusable, never as healthy', () => {
    const unknown = { outcome: 'something-new', atMs: NOW } as unknown as TraePoolProbe
    expect(exclusionOf(unknown, NOW)).toBe('unusable')
  })
})

describe('rankPool', () => {
  it('puts every usable account ahead of every excluded one', () => {
    const ranked = rankPool([
      member('a', { probe: probe({ outcome: 'credential-rejected' }), credits: { total: 9_999, expiringSoon: 0 } }),
      member('b', { credits: { total: 1, expiringSoon: 0 } }),
    ], NOW)
    expect(ranked.map(row => row.account.id)).toEqual(['b', 'a'])
    expect(ranked[1]?.excludedBy).toBe('credential-rejected')
  })

  it('spends expiring credits before saving larger balances', () => {
    // workbuddy issue #70: ranking by total first made the expiry rule unreachable.
    const ranked = rankPool([
      member('rich-later', { credits: { total: 1_200, expiringSoon: 0 } }),
      member('lapsing-soon', {
        credits: { total: 196, expiringSoon: 100, nearestExpiryMs: NOW + 60_000 },
      }),
    ], NOW)
    expect(ranked.map(row => row.account.id)).toEqual(['lapsing-soon', 'rich-later'])
  })

  it('ranks an at-risk account ahead even when its expiring AMOUNT is smaller', () => {
    // Isolates `_expiring` (the soonest-lapse key) from `_expiringAmount`: both
    // accounts carry expiring credits, so the amount comparison alone would put
    // the 900-credit account first. Deleting the timestamp key makes this fail.
    const ranked = rankPool([
      member('more-but-later', {
        credits: { total: 5_000, expiringSoon: 900, nearestExpiryMs: NOW + 3 * 86_400_000 },
      }),
      member('less-but-sooner', {
        credits: { total: 10, expiringSoon: 5, nearestExpiryMs: NOW + 3_600_000 },
      }),
    ], NOW)
    expect(ranked.map(row => row.account.id)).toEqual(['less-but-sooner', 'more-but-later'])
  })

  it('puts an at-risk account first even when the other holds more TOTAL credit', () => {
    // Isolates `_atRisk` from the `score` fallback the way it bites in practice:
    // the savings account has far more credit overall, but none of it lapses,
    // while the small account's balance vanishes within the hour. Deleting the
    // at-risk key falls through to `score` and ranks `big-savings` first.
    //
    // The TIMESTAMP is what makes this case isolating, so it is asserted directly:
    // with `nearestExpiryMs` absent the "soonest lapses" key compares Infinity on
    // BOTH rows, falls through to the amount key (12 > 0) and rescues the order —
    // which is precisely how the first version of this suite let the at-risk rule
    // be deleted with every test still green.
    const ranked = rankPool([
      member('big-savings', { credits: { total: 9_000_000, expiringSoon: 0 } }),
      member('small-lapsing', {
        credits: { total: 12, expiringSoon: 12, nearestExpiryMs: NOW + 3_600_000 },
      }),
    ], NOW)
    expect(ranked.map(row => row.account.id)).toEqual(['small-lapsing', 'big-savings'])
    // A member with expiring credit but NO stated expiry still gets the at-risk
    // slot: the Infinity comparison is skipped (both sides undated) and the AMOUNT
    // decides, so the small undated balance wins over the much larger undated one.
    // This documents the fallback the assertion above leans on.
    const undated = rankPool([
      member('big-undated', { credits: { total: 9_000_000, expiringSoon: 0 } }),
      member('small-undated', { credits: { total: 12, expiringSoon: 12 } }),
    ], NOW)
    expect(undated.map(row => row.account.id)).toEqual(['small-undated', 'big-undated'])
  })

  it('among accounts with expiring credits, spends the soonest expiry first', () => {
    const ranked = rankPool([
      member('later', { credits: { total: 10, expiringSoon: 50, nearestExpiryMs: NOW + 7_200_000 } }),
      member('sooner', { credits: { total: 10, expiringSoon: 10, nearestExpiryMs: NOW + 600_000 } }),
    ], NOW)
    expect(ranked.map(row => row.account.id)).toEqual(['sooner', 'later'])
  })

  it('among accounts with nothing expiring, conserves the smallest balance', () => {
    const ranked = rankPool([
      member('small', { credits: { total: 5, expiringSoon: 0 } }),
      member('large', { credits: { total: 500, expiringSoon: 0 } }),
    ], NOW)
    expect(ranked.map(row => row.account.id)).toEqual(['large', 'small'])
  })

  it('breaks a full tie by freshest credential, then by id, so the order is total', () => {
    const ranked = rankPool([
      member('aaa', { credits: { total: 10, expiringSoon: 0 }, tokenExpiresAtMs: NOW + 1 }),
      member('bbb', { credits: { total: 10, expiringSoon: 0 }, tokenExpiresAtMs: NOW + 9 }),
    ], NOW)
    expect(ranked.map(row => row.account.id)).toEqual(['bbb', 'aaa'])
    const sameExpiry = rankPool([
      member('zzz', { credits: { total: 10, expiringSoon: 0 }, tokenExpiresAtMs: NOW + 1 }),
      member('aaa', { credits: { total: 10, expiringSoon: 0 }, tokenExpiresAtMs: NOW + 1 }),
    ], NOW)
    expect(sameExpiry.map(row => row.account.id)).toEqual(['aaa', 'zzz'])
  })

  it('ranks an unreadable balance as zero rather than as a full account', () => {
    const ranked = rankPool([
      member('unreadable'),
      member('known', { credits: { total: 1, expiringSoon: 0 } }),
    ], NOW)
    expect(ranked.map(row => row.account.id)).toEqual(['known', 'unreadable'])
  })
})

describe('pickAccount', () => {
  it('returns the first usable member, and nothing when every member is excluded', () => {
    expect(pickAccount([
      member('excluded', { probe: probe({ outcome: 'credential-rejected' }), credits: { total: 99, expiringSoon: 0 } }),
    ], NOW)).toBeUndefined()
    expect(pickAccount([member('ok', { credits: { total: 1, expiringSoon: 0 } })], NOW)?.id).toBe('ok')
  })
})

describe('effectiveMembersOf', () => {
  it('keeps the order the caller asked for and drops ids with no local sign-in', () => {
    expect(effectiveMembersOf(['c', 'ghost', 'a'], new Set(['a', 'c']))).toEqual(['c', 'a'])
  })

  it('is empty when every saved id is a ghost', () => {
    expect(effectiveMembersOf(['x'], new Set())).toEqual([])
  })
})

describe('billableMembers', () => {
  const member = (id: string): TraePoolMember => ({
    account: { id, accountName: id },
    credits: { total: 0, expiringSoon: 0 },
  })

  it('keeps only what the user opted into, in the store order', () => {
    const members = [member('a'), member('b'), member('c')]
    // The saved order is the user's; the ANSWER follows the roster so the table
    // and the router list accounts the same way.
    expect(billableMembers(members, ['c', 'a']).map(row => row.account.id)).toEqual(['a', 'c'])
  })

  it('drops accounts that already failed this request', () => {
    const members = [member('a'), member('b')]
    expect(billableMembers(members, ['a', 'b'], ['a']).map(row => row.account.id)).toEqual(['b'])
  })

  it('bills nobody when the opt-in list is empty', () => {
    // An enabled pool with no members is NOT "everybody": silently billing all of
    // them is how a user's explicit opt-in turns into an implicit one.
    expect(billableMembers([member('a'), member('b')], [])).toEqual([])
  })

  it('drops saved ids that no longer have a local sign-in', () => {
    expect(billableMembers([member('a')], ['a', 'ghost']).map(row => row.account.id)).toEqual(['a'])
  })
})

describe('pickFreeModel / resolveTargetModel', () => {
  const catalog: TraeModelInfo[] = [
    { id: 'paid', name: 'Paid', creditMultiplier: 3 },
    { id: 'free-small', name: 'Free small', creditMultiplier: 0, contextWindow: 32_000 },
    { id: 'free-large', name: 'Free large', creditMultiplier: 0, contextWindow: 200_000 },
  ]

  it('never treats a missing creditMultiplier as free', () => {
    // The CN static fallback catalog carries no multiplier at all.
    expect(pickFreeModel([{ id: 'unknown', name: 'Unknown' }])).toBeUndefined()
  })

  it('picks the largest free model by context window', () => {
    expect(pickFreeModel(catalog)?.id).toBe('free-large')
  })

  it('honours a saved preferred model, paid or not', () => {
    expect(resolveTargetModel(catalog, 'paid')).toEqual({ modelId: 'paid', source: 'preferred' })
  })

  it('falls back to the free model when nothing is saved', () => {
    expect(resolveTargetModel(catalog, undefined)).toEqual({ modelId: 'free-large', source: 'free' })
    expect(resolveTargetModel(catalog, '')).toEqual({ modelId: 'free-large', source: 'free' })
  })

  it('reports a saved model the catalog no longer offers as stale, and hands out no id', () => {
    const target = resolveTargetModel(catalog, 'retired')
    expect(target.source).toBe('stale')
    expect(target.staleModelId).toBe('retired')
    // Absent on purpose: every existing guard refuses on a missing id.
    expect(target.modelId).toBeUndefined()
  })

  it('reports none when the panel offers no free model', () => {
    expect(resolveTargetModel([{ id: 'paid', name: 'Paid', creditMultiplier: 2 }], undefined)).toEqual({ source: 'none' })
  })
})

describe('createLatestWins', () => {
  it('marks the older generation stale as soon as a newer one begins', () => {
    const guard = createLatestWins<'cn'>()
    const first = guard.begin('cn')
    expect(first()).toBe(false)
    const second = guard.begin('cn')
    // The slow caller that resumes after a newer begin() must bail.
    expect(first()).toBe(true)
    expect(second()).toBe(false)
  })

  it('keys panels independently, because cn and enterprise billing never share a slot', () => {
    const guard = createLatestWins<'cn' | 'enterprise'>()
    const cn = guard.begin('cn')
    const enterprise = guard.begin('enterprise')
    expect(cn()).toBe(false)
    expect(enterprise()).toBe(false)
  })
})

describe('outcomeOfVerdict', () => {
  it('maps every probe verdict onto the pool vocabulary', () => {
    expect(outcomeOfVerdict('available')).toBe('ok')
    expect(outcomeOfVerdict('auth')).toBe('credential-rejected')
    expect(outcomeOfVerdict('gated')).toBe('plan-gated')
    expect(outcomeOfVerdict('rate_limited')).toBe('rate-limited')
    expect(outcomeOfVerdict('unsupported')).toBe('not-found')
  })

  it('falls through to failed, so a new upstream verdict is never silently healthy', () => {
    expect(outcomeOfVerdict('brand-new-verdict')).toBe('failed')
  })

  it('scopes model-shaped outcomes to the model and credential outcomes to the sign-in', () => {
    expect(outcomeIsModelScoped('not-found')).toBe(true)
    expect(outcomeIsModelScoped('model-busy')).toBe(true)
    expect(outcomeIsModelScoped('credential-rejected')).toBe(false)
    expect(outcomeIsCredential('credential-rejected')).toBe(true)
    expect(outcomeIsCredential('ok')).toBe(false)
  })
})

describe('poolKeyOfPanel', () => {
  it('gives enterprise its own bucket, since a personal pass says nothing about the tenant gate', () => {
    expect(poolKeyOfPanel('cn')).toBe('cn')
    expect(poolKeyOfPanel('enterprise')).toBe('enterprise')
    expect(poolKeyOfPanel('ai')).toBe('ai')
  })
})

describe('account id guard', () => {
  it('accepts exactly what traeAccountId emits', () => {
    const id = traeAccountId(credential)
    expect(TRAE_ACCOUNT_ID_RE.test(id)).toBe(true)
    expect(isTraeAccountId(id)).toBe(true)
  })

  it('refuses traversal and malformed ids', () => {
    for (const bad of ['../../etc/passwd', 'abc', 'ABCDEF01234567890123456', '', 'x'.repeat(24), undefined, 42]) {
      expect(isTraeAccountId(bad)).toBe(false)
    }
  })
})

describe('parseUpstreamResetAt', () => {
  it('reads the zh form with an explicit offset', () => {
    const atMs = parseUpstreamResetAt('配额将在 2026-10-19 10:00:00 UTC+8 重置')
    expect(atMs).toBe(Date.UTC(2026, 9, 19, 2, 0, 0))
  })

  it('reads the en form', () => {
    const atMs = parseUpstreamResetAt('Rate limit resets at 2026-10-19 10:00:00 UTC+8')
    expect(atMs).toBe(Date.UTC(2026, 9, 19, 2, 0, 0))
  })

  it('returns undefined when no time is stated, rather than guessing one', () => {
    // Trae's measured 4011/4008 bodies name no time at all.
    expect(parseUpstreamResetAt('too many requests')).toBeUndefined()
    expect(parseUpstreamResetAt("We're sorry, your requests have exceeded the rate limit. Please wait and try again later.")).toBeUndefined()
  })

  it('refuses a stamp with no explicit zone instead of assuming the host zone', () => {
    expect(parseUpstreamResetAt('将在 2026-10-19 10:00:00 重置')).toBeUndefined()
  })
})

describe('mergePoolProbe', () => {
  it('keeps a still-future recovery time from the previous measurement', () => {
    const merged = mergePoolProbe(
      probe({ outcome: 'rate-limited', retryAtMs: NOW + 60_000 }),
      probe({ outcome: 'failed', atMs: NOW + 1_000 }),
    )
    expect(merged.retryAtMs).toBe(NOW + 60_000)
  })

  it('drops a recovery time that has already passed', () => {
    const merged = mergePoolProbe(
      probe({ outcome: 'rate-limited', retryAtMs: NOW }),
      probe({ outcome: 'failed', atMs: NOW + 1_000 }),
    )
    expect(merged.retryAtMs).toBeUndefined()
  })

  it('lets the update state its own recovery time', () => {
    const merged = mergePoolProbe(
      probe({ outcome: 'rate-limited', retryAtMs: NOW + 60_000 }),
      probe({ outcome: 'rate-limited', atMs: NOW + 1_000, retryAtMs: NOW + 9_000 }),
    )
    expect(merged.retryAtMs).toBe(NOW + 9_000)
  })

  it('inherits the account name but never the measured model', () => {
    const merged = mergePoolProbe(
      probe({ outcome: 'ok', accountName: 'demo-user', modelId: 'old-model' }),
      probe({ outcome: 'ok', atMs: NOW + 1_000 }),
    )
    expect(merged.accountName).toBe('demo-user')
    expect(merged.modelId).toBeUndefined()
  })
})

describe('probeUpdatesOf', () => {
  const row = (overrides: Partial<TraePoolTestRow> & Pick<TraePoolTestRow, 'outcome'>): TraePoolTestRow => ({
    accountId: 'a'.repeat(24),
    accountName: 'demo-user',
    modelId: 'free-large',
    detail: 'detail',
    ...overrides,
  })

  it('records a measurement, stamped once for the batch', () => {
    const updates = probeUpdatesOf([row({ outcome: 'available' })], NOW)
    const stored = updates['a'.repeat(24)]
    expect(stored?.outcome).toBe('ok')
    expect(stored?.atMs).toBe(NOW)
    expect(stored?.source).toBe('test-batch')
    expect(stored?.modelId).toBe('free-large')
  })

  it('does not remember a row that never reached the model', () => {
    // A missing credential says nothing about the account's quota, so recording it
    // would exclude a possibly-perfect account.
    const updates = probeUpdatesOf([
      row({ outcome: 'auth', detail: 'no stored credential for this account' }),
    ], NOW)
    expect(updates).toEqual({})
  })

  it('still remembers a genuinely rejected credential', () => {
    const updates = probeUpdatesOf([row({ outcome: 'auth', detail: 'token rejected upstream' })], NOW)
    expect(Object.values(updates)[0]?.outcome).toBe('credential-rejected')
  })
})

describe('testAllAccounts', () => {
  function deps(overrides: Partial<TraePoolRunnerDeps> = {}): TraePoolRunnerDeps {
    return {
      async credentialFor() { return credential },
      async checkinStatusOf() { return { checkedIn: false, credits: 1, enabled: true, didCheckedIn: false } },
      async claimCheckinOf() { return { claimed: true, code: 0, message: '' } },
      chatFor() {
        return async () => ({ text: 'ok' }) as never
      },
      wait: async () => {},
      ...overrides,
    }
  }

  it('runs one probe per account and reports each row as it lands', async () => {
    const seen: string[] = []
    const rows = await testAllAccounts(
      [{ accountId: 'a'.repeat(24), accountName: 'A' }, { accountId: 'b'.repeat(24), accountName: 'B' }],
      'free-large',
      async (_chat, _credential, id) => ({ id, verdict: 'available', detail: 'ok' }),
      deps(),
      row => seen.push(row.accountName),
    )
    expect(rows.map(row => row.accountName)).toEqual(['A', 'B'])
    // Streaming exists so a slow member cannot look like a dead button.
    expect(seen).toEqual(['A', 'B'])
  })

  it('pauses between accounts so a batch is not a request burst', async () => {
    const waits: number[] = []
    await testAllAccounts(
      [{ accountId: 'a'.repeat(24), accountName: 'A' }, { accountId: 'b'.repeat(24), accountName: 'B' }],
      'free-large',
      async (_chat, _credential, id) => ({ id, verdict: 'available', detail: 'ok' }),
      deps({ wait: async ms => { waits.push(ms) } }),
    )
    expect(waits).toEqual([POOL_BATCH_GAP_MS])
  })

  it('keeps going after one account fails, because each account has its own credential', async () => {
    const firstCredential = credential
    const rows = await testAllAccounts(
      [{ accountId: 'a'.repeat(24), accountName: 'A' }, { accountId: 'b'.repeat(24), accountName: 'B' }],
      'free-large',
      // The probe signature is (chatFor, credential, modelId) — the MODEL id, not
      // the account id. Accounts are told apart by the credential the runner
      // resolved, which is the same handle a real probe would chat through.
      async (_chat, credential, modelId) => credential === firstCredential
        ? { id: modelId, verdict: 'auth' as const, detail: 'rejected' }
        : { id: modelId, verdict: 'available' as const, detail: 'ok' },
      deps({
        async credentialFor(accountId) {
          return accountId === 'a'.repeat(24) ? firstCredential : { ...credential, userId: 'other' }
        },
      }),
    )
    expect(rows.map(row => row.outcome)).toEqual(['auth', 'available'])
  })

  it('reports a missing credential as a row instead of throwing', async () => {
    const rows = await testAllAccounts(
      [{ accountId: 'a'.repeat(24), accountName: 'A' }],
      'free-large',
      async (_chat, _credential, id) => ({ id, verdict: 'available', detail: 'ok' }),
      deps({ credentialFor: async () => undefined }),
    )
    expect(rows[0]?.outcome).toBe('auth')
    expect(rows[0]?.detail).toContain('no stored credential')
  })
})

describe('checkinAllAccounts', () => {
  const targets = [
    { accountId: 'a'.repeat(24), accountName: 'A' },
    { accountId: 'b'.repeat(24), accountName: 'B' },
  ]

  function deps(overrides: Partial<TraePoolRunnerDeps> = {}): TraePoolRunnerDeps {
    return {
      async credentialFor() { return credential },
      async checkinStatusOf() { return { checkedIn: false, credits: 1, enabled: true, didCheckedIn: false } },
      async claimCheckinOf() { return { claimed: true, code: 0, message: '' } },
      chatFor() {
        return async () => ({ text: 'ok' }) as never
      },
      wait: async () => {},
      ...overrides,
    }
  }

  it('claims each account and reports the credit it earned', async () => {
    const rows = await checkinAllAccounts(targets, deps())
    expect(rows.map(row => row.status)).toEqual(['claimed', 'claimed'])
    expect(rows[0]?.credit).toBe(1)
  })

  it('does not re-claim an account already checked in today', async () => {
    let claims = 0
    const rows = await checkinAllAccounts(targets, deps({
      checkinStatusOf: async () => ({ checkedIn: true, credits: 1, enabled: true, didCheckedIn: false }),
      claimCheckinOf: async () => { claims += 1; return { claimed: true, code: 0, message: '' } },
    }))
    expect(claims).toBe(0)
    expect(rows.map(row => row.status)).toEqual(['already', 'already'])
  })

  it('stops the run on a device-level refusal, since every later account would be refused too', async () => {
    // 9095 is a fact about this MACHINE, not about the account.
    let claims = 0
    const rows = await checkinAllAccounts(targets, deps({
      claimCheckinOf: async () => {
        claims += 1
        return { claimed: false, code: 9095, message: 'device already claimed today' }
      },
    }))
    expect(claims).toBe(1)
    expect(rows.map(row => row.status)).toEqual(['device-already', 'device-already'])
  })

  it('reports a per-account failure without aborting the batch', async () => {
    const rows = await checkinAllAccounts(targets, deps({
      claimCheckinOf: async () => { throw new Error('upstream 500') },
    }))
    expect(rows.every(row => row.status === 'failed')).toBe(true)
  })
})
