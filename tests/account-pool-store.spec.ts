import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  dropTraePoolProbe,
  mergePoolProbe,
  readTraePoolProbes,
  writeTraePoolProbes,
} from '../src/account-pool-store.ts'
import type { TraePoolProbe } from '../src/account-pool.ts'
import { traeWebPool, type TraePoolDeps, type TraeUsageRouteOptions } from '../src/web-status.ts'
import type { TraeModelInfo } from '../src/catalog.ts'
import type { TraePanel } from '../src/region.ts'

const NOW = 1_700_000_000_000
const A = 'a'.repeat(24)
const B = 'b'.repeat(24)

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'trae-pool-'))
  process.env['DSH_HOME'] = home
})

afterEach(async () => {
  delete process.env['DSH_HOME']
  await rm(home, { recursive: true, force: true })
})

describe('the pool probe store', () => {
  it('reports an empty map for a store that was never written', async () => {
    expect(await readTraePoolProbes('cn')).toEqual({})
  })

  it('round-trips a measurement and keeps it private to the user', async () => {
    await writeTraePoolProbes('cn', { [A]: { outcome: 'ok', atMs: NOW, source: 'test-batch', modelId: 'free' } })
    expect(await readTraePoolProbes('cn')).toMatchObject({ [A]: { outcome: 'ok', atMs: NOW } })
    // File permission bits are POSIX-only; Windows exposes no meaningful mode, so
    // asserting 0o600 there fails on a property the platform cannot hold.
    if (process.platform !== 'win32') {
      const mode = (await stat(join(home, '.trae-pool.cn.json'))).mode & 0o777
      // The file never holds credentials, but it is still per-user state.
      expect(mode).toBe(0o600)
    }
  })

  it('merges rather than replaces, so a partial batch cannot erase earlier knowledge', async () => {
    await writeTraePoolProbes('cn', { [A]: { outcome: 'ok', atMs: NOW } })
    await writeTraePoolProbes('cn', { [B]: { outcome: 'out-of-credit', atMs: NOW + 1 } })
    const probes = await readTraePoolProbes('cn')
    expect(Object.keys(probes).sort()).toEqual([A, B])
  })

  it('keeps each panel in its own file, since enterprise is measured separately', async () => {
    await writeTraePoolProbes('cn', { [A]: { outcome: 'ok', atMs: NOW } })
    expect(await readTraePoolProbes('enterprise')).toEqual({})
    await writeTraePoolProbes('enterprise', { [B]: { outcome: 'plan-gated', atMs: NOW } })
    expect(Object.keys(await readTraePoolProbes('cn'))).toEqual([A])
  })

  it('reads an unparsable file as "nothing measured" instead of throwing', async () => {
    await writeFile(join(home, '.trae-pool.cn.json'), '{ not json', 'utf8')
    expect(await readTraePoolProbes('cn')).toEqual({})
  })

  it('ignores a file written by a different store version', async () => {
    await writeFile(
      join(home, '.trae-pool.cn.json'),
      JSON.stringify({ version: 99, probes: { [A]: { outcome: 'ok', atMs: NOW } } }),
      'utf8',
    )
    expect(await readTraePoolProbes('cn')).toEqual({})
  })

  it('heals a missing retryAtMs from the message the upstream was stored with', async () => {
    // Existing records can state a time in prose; the reader repairs them so every
    // consumer sees the same answer.
    const resetMs = Date.UTC(2026, 9, 19, 2, 0, 0)
    await writeTraePoolProbes('cn', {
      [A]: { outcome: 'rate-limited', atMs: NOW, message: '将在 2026-10-19 10:00:00 UTC+8 重置' },
    })
    expect((await readTraePoolProbes('cn'))[A]?.retryAtMs).toBe(resetMs)
  })

  it('never attaches a countdown to a healthy account', async () => {
    await writeTraePoolProbes('cn', {
      [A]: { outcome: 'ok', atMs: NOW, message: '将在 2026-10-19 10:00:00 UTC+8 重置' },
    })
    expect((await readTraePoolProbes('cn'))[A]?.retryAtMs).toBeUndefined()
  })

  it('drops one measurement and leaves the rest', async () => {
    await writeTraePoolProbes('cn', {
      [A]: { outcome: 'ok', atMs: NOW },
      [B]: { outcome: 'rate-limited', atMs: NOW },
    })
    await dropTraePoolProbe('cn', A)
    expect(Object.keys(await readTraePoolProbes('cn'))).toEqual([B])
  })

  it('serializes a concurrent drop and write instead of losing the write', async () => {
    // A drop is a read-modify-write. When its read happened OUTSIDE the write
    // lock, a batch landing between that read and the write was discarded by
    // the drop's stale snapshot. The store cannot say WHICH of two concurrent
    // intentions wins, but the loser must never erase the winner: after both
    // settle, the file holds a consistent result of one full operation after
    // the other — never a patchwork of a pre-lock read and a post-lock write.
    await writeTraePoolProbes('cn', { [A]: { outcome: 'ok', atMs: NOW } })
    await Promise.all([
      dropTraePoolProbe('cn', A),
      writeTraePoolProbes('cn', { [B]: { outcome: 'ok', atMs: NOW } }),
      writeTraePoolProbes('cn', { [A]: { outcome: 'rate-limited', atMs: NOW + 1 } }),
    ])
    const after = await readTraePoolProbes('cn')
    
    // `A` ended deleted OR re-measured — both are legitimate orders — but the
    // third writer's measurement of `B` can never be the casualty either way.
    expect(after[B]).toMatchObject({ outcome: 'ok', atMs: NOW })
    const dropped = after[A] === undefined
    if (!dropped) expect(after[A]).toMatchObject({ outcome: 'rate-limited' })
  })

  it('stores no credential material', async () => {
    await writeTraePoolProbes('cn', { [A]: { outcome: 'ok', atMs: NOW } })
    const raw = await readFile(join(home, '.trae-pool.cn.json'), 'utf8')
    for (const secret of ['accessToken', 'refreshToken', 'eyJ']) expect(raw.includes(secret)).toBe(false)
  })
})

describe('traeWebPool', () => {
  // `traeWebPool` stamps Date.now(), so fixtures must be dated against the real
  // clock: a fixed epoch would leave every cooldown in the past, which reads as
  // "usable" and would silently defeat the exclusion cases.
  const NOW = Date.now()
  const catalog: TraeModelInfo[] = [
    { id: 'paided', name: 'Paid', creditMultiplier: 4 },
    { id: 'free', name: 'Free', creditMultiplier: 0, contextWindow: 128_000 },
  ]

  function deps(overrides: Partial<TraePoolDeps> = {}): TraePoolDeps {
    return {
      preferences: () => ({ enabled: true, memberAccountIds: [A, B] }),
      members: async () => [
        { account: { id: A, accountName: 'A' }, credits: { total: 5, expiringSoon: 0 }, probe: { outcome: 'ok', atMs: NOW } },
        { account: { id: B, accountName: 'B' }, credits: { total: 50, expiringSoon: 0 }, probe: { outcome: 'ok', atMs: NOW } },
      ],
      catalog: () => catalog,
      currentAccountId: async () => A,
      checkinSupported: () => true,
      // The listed roster: what this machine can reach. A saved id absent from
      // here is a ghost, which is exactly the case the card must not claim.
      otherAccounts: async () => [
        { id: A, accountName: 'A' },
        { id: B, accountName: 'B' },
      ],
      ...overrides,
    } as TraePoolDeps
  }

  const panel: TraePanel = 'cn'
  // `traeWebPool` reads the pool bag off the ROUTE options — the same object the
  // HTTP route receives — so the fixture has to look like one.
  const routeOf = (pool: TraePoolDeps): TraeUsageRouteOptions => ({ pool }) as unknown as TraeUsageRouteOptions
  /** `traeWebPool` answers undefined only when the route has no pool bag at all. */
  const docOf = async (bag: TraePoolDeps) => {
    const doc = await traeWebPool(routeOf(bag), panel)
    if (doc === undefined) throw new Error('expected a pool document')
    return doc
  }

  it('reports the saved probe size, and 0 when the field was never touched', async () => {
    // The card needs a number to show in the select; an absent field means the
    // historical minimal probe, not "whatever the last default was".
    expect((await docOf(deps())).probeInputTokens).toBe(0)
    expect((await docOf(deps({ preferences: () => ({ enabled: true, memberAccountIds: [A], probeInputTokens: 30_000 }) }))).probeInputTokens).toBe(30_000)
    // A hand-edited negative value must not become a negative padding.
    expect((await docOf(deps({ preferences: () => ({ enabled: true, memberAccountIds: [A], probeInputTokens: -3 }) }))).probeInputTokens).toBe(0)
  })

  it('ranks members best-first and marks the one currently billed', async () => {
    const pool = await docOf(deps())
    // Nothing is expiring, so the larger balance leads — conserving the small one.
    expect(pool.accounts.map(row => row.accountId)).toEqual([B, A])
    expect(pool.accounts.find(row => row.current)?.accountId).toBe(A)
    expect(pool.enabled).toBe(true)
  })

  it('shows a saved member that has no local sign-in as a NON-member ghost', async () => {
    // A ghost cannot be tested or checked in, so it must not render as a member —
    // otherwise the card would promise a batch over an account nothing reaches.
    const ghost = 'c'.repeat(24)
    const pool = await docOf(deps({
      preferences: () => ({ enabled: true, memberAccountIds: [A, ghost] }),
      // The ghost is in nobody's roster: its desktop sign-in is gone.
      members: async () => [
        { account: { id: A, accountName: 'A' }, credits: { total: 5, expiringSoon: 0 } },
      ],
      otherAccounts: async () => [{ id: A, accountName: 'A' }],
    }))
    const ghostRow = pool.accounts.find(row => row.accountId === ghost)
    // Kept as a MEMBER (the user checked it) but marked unreachable, so the card
    // can show it, label it, and offer to remove it — a filtered row would leave
    // the saved list permanently dirty with nothing on screen to explain it.
    expect(ghostRow?.member).toBe(true)
    expect(ghostRow?.reachable).toBe(false)
    expect(pool.accounts.find(row => row.accountId === A)?.reachable).toBe(true)
    expect(pool.effectiveMemberAccountIds).toEqual([A])
    // The SAVED list is reported verbatim: the card must be able to show what the
    // user asked for, not silently drop it.
    expect(pool.memberAccountIds).toEqual([A, ghost])
    // No name was ever measured for this ghost, so the row falls back to the id
    // rather than to an empty cell — a blank row reads as a broken COPY of an
    // account, which is exactly what it must not look like.
    expect(ghostRow?.accountName).toBe(ghost)
  })

  it('reports noCandidate when every member is excluded, because traffic then falls back', async () => {
    const pool = await docOf(deps({
      members: async () => [
        { account: { id: A, accountName: 'A' }, credits: { total: 0, expiringSoon: 0 }, probe: { outcome: 'out-of-credit', atMs: NOW, retryAtMs: NOW + 3_600_000 } },
        { account: { id: B, accountName: 'B' }, credits: { total: 0, expiringSoon: 0 }, probe: { outcome: 'out-of-credit', atMs: NOW, retryAtMs: NOW + 3_600_000 } },
      ],
      otherAccounts: async () => [],
    }))
    expect(pool.noCandidate).toBe('out-of-credit')
  })

  it('reports empty only when the pool has no members at all', async () => {
    const pool = await docOf(deps({
      preferences: () => ({ enabled: true, memberAccountIds: [] }),
      members: async () => [],
    }))
    expect(pool.noCandidate).toBe('empty')
  })

  it('says nothing about candidates while the pool is switched off', async () => {
    const pool = await docOf(deps({
      preferences: () => ({ enabled: false, memberAccountIds: [] }),
      members: async () => [],
    }))
    expect(pool.enabled).toBe(false)
    expect(pool.noCandidate).toBeUndefined()
  })

  it('resolves the target model from the catalog and reports where it came from', async () => {
    expect((await docOf(deps())).targetModelId).toBe('free')
    expect((await docOf(deps())).targetModelSource).toBe('free')
    const preferred = await docOf(deps({
      preferences: () => ({ enabled: true, memberAccountIds: [A], targetModelId: 'paided' }),
    }))
    expect(preferred.targetModelId).toBe('paided')
    expect(preferred.targetModelSource).toBe('preferred')
  })

  it('reports a retired target model as stale and hands the card no id to run', async () => {
    const stale = await docOf(deps({
      preferences: () => ({ enabled: true, memberAccountIds: [A], targetModelId: 'retired' }),
    }))
    expect(stale.targetModelSource).toBe('stale')
    expect(stale.staleTargetModelId).toBe('retired')
    expect(stale.targetModelId).toBeUndefined()
  })

  it('only claims check-in support when the panel supports it and a runner exists', async () => {
    expect((await docOf(deps())).checkinSupported).toBe(false)
    expect((await docOf(deps({ checkin: async () => [] }))).checkinSupported).toBe(true)
  })

  it('degrades to a pool with no check-in data instead of failing the whole document', async () => {
    const pool = await docOf(deps({
      checkinState: async () => { throw new Error('upstream down') },
      memberNames: async () => { throw new Error('upstream down') },
      currentAccountId: async () => { throw new Error('upstream down') },
    }))
    expect(pool.accounts.every(row => row.checkedInToday === undefined)).toBe(true)
    expect(pool.accounts.every(row => row.current === false)).toBe(true)
  })

  it('projects the General bucket, which is what a SOLO chat can actually spend', async () => {
    const pool = await docOf(deps({
      members: async () => [
        {
          account: { id: A, accountName: 'A' },
          credits: { total: 7, generalAvailable: 7, workAvailable: 900, expiringSoon: 3, nearestExpiryMs: NOW + 1 },
        },
      ],
    }))
    const row = pool.accounts[0]
    expect(row?.generalAvailable).toBe(7)
    expect(row?.workAvailable).toBe(900)
    expect(row?.expiringSoon).toBe(3)
  })
})

describe('traeWebPool token state', () => {
  const LATER = Date.now() + 3_600_000
  const SOONER = Date.now() - 1_000
  const panel: TraePanel = 'cn'
  const docOf = async (members: TraePoolDeps['members']) => {
    const bag = {
      preferences: () => ({ enabled: true, memberAccountIds: [A, B] }),
      members,
      catalog: () => [],
      checkinSupported: () => false,
      otherAccounts: async () => [{ id: A, accountName: 'A' }, { id: B, accountName: 'B' }],
    } as unknown as TraePoolDeps
    const doc = await traeWebPool({ pool: bag } as unknown as TraeUsageRouteOptions, panel)
    if (doc === undefined) throw new Error('expected a pool document')
    return doc
  }

  it('does not call a working account expired just because its stored token looked old', async () => {
    // A balance that answered means the read refreshed the token; flagging the row
    // would put 「登录已失效」 next to a number that is right there.
    const pool = await docOf(async () => [
      { account: { id: B, accountName: 'B' }, credits: { total: 7, expiringSoon: 0 }, tokenExpiresAtMs: SOONER },
    ])
    expect(pool.accounts.find(row => row.accountId === B)?.tokenExpired).toBeUndefined()
  })

  it('explains a dash caused by a lapsed sign-in instead of leaving it bare', async () => {
    const pool = await docOf(async () => [
      { account: { id: A, accountName: 'A' }, credits: { total: 5, expiringSoon: 0 }, tokenExpiresAtMs: LATER },
      { account: { id: B, accountName: 'B' }, tokenExpiresAtMs: SOONER },
    ])
    const lapsed = pool.accounts.find(row => row.accountId === B)
    const healthy = pool.accounts.find(row => row.accountId === A)
    expect(lapsed?.tokenExpired).toBe(true)
    // No balance was readable, so the row must not pretend it has credit either.
    expect(lapsed?.credits).toBeUndefined()
    expect(healthy?.tokenExpired).toBeUndefined()
  })
})
