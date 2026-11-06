// @vitest-environment jsdom
/**
 * The card's two-phase first paint (issue #77).
 *
 * WHY THIS FILE EXISTS: the server can answer a thin document in milliseconds,
 * but that only helps if the CARD paints it before the expensive one lands. Three
 * properties have to hold, and each one is a way the fix can silently rot:
 *
 *  1. the account rows are on screen while the full document is STILL in flight —
 *     this is the reported bug, so it is asserted directly;
 *  2. before anything answers, the card says "loading", NOT "not signed in" —
 *     the old seeded placeholder told a signed-in user they were signed out for
 *     the whole wait;
 *  3. a late first paint never overwrites a full document already on screen —
 *     otherwise credits and check-in marks would flicker away every poll.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_ACCOUNT_STATUS_PATH, TRAE_USAGE_PATH } from '../src/status-paths.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

function makeScope() {
  let value: Record<string, unknown> = {}
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready', value, writable: true }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async (field: string, next: unknown) => {
      value = { ...value, [field]: next }
      for (const listener of listeners) listener()
    },
  }
}

const isUsage = (url: string): boolean => url.startsWith(TRAE_USAGE_PATH)
const isFast = (url: string): boolean => isUsage(url) && url.includes('detail=fast')
const isFull = (url: string): boolean => isUsage(url) && !url.includes('detail=fast')

/**
 * The thin document: everything needed to DRAW the rows, nothing measured.
 *
 * Deliberately carries no top-level `credits` and no per-row `credits` /
 * `checkedInToday`: those are exactly the fields the full document adds, and the
 * test below proves the card paints without them.
 */
function fastDocument(): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [{ id: 'account-1', accountName: 'demo-user', edition: 'solo', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true }],
    models: [{ id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', contextWindow: 168_000, maxTokens: 32_000 }],
    enabledModelIds: ['DeepSeek-V4-Flash'],
    pool: {
      enabled: true,
      checkinSupported: true,
      targetModelSource: 'free',
      targetModelId: 'DeepSeek-V4-Flash',
      probeInputTokens: 0,
      memberAccountIds: ['account-1'],
      effectiveMemberAccountIds: ['account-1'],
      accounts: [{ accountId: 'account-1', accountName: 'demo-user', current: true, member: true, reachable: true }],
      catalog: [{ id: 'DeepSeek-V4-Flash', name: 'DeepSeek-V4-Flash', contextWindow: 168_000, maxTokens: 32_000 }],
    },
  }
}

/** The full document: the thin one plus the measured figures. */
function fullDocument(): Record<string, unknown> {
  const base = fastDocument()
  return {
    ...base,
    credits: { total: 7500, consumed: 0, available: 20.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
    checkin: { checkedIn: true, enabled: true },
    pool: {
      ...(base.pool as Record<string, unknown>),
      // `generalAvailable` is the cell the row prints (the General bucket), which
      // is what distinguishes the applied full document from the thin one.
      accounts: [{ accountId: 'account-1', accountName: 'demo-user', credits: 20.37, generalAvailable: 20.37, current: true, member: true, reachable: true, checkedInToday: true }],
    },
  }
}

/** Install a fetch stub that answers every route the card asks for. */
function stubFetch(answer: (url: string) => Record<string, unknown>): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith(TRAE_ACCOUNT_STATUS_PATH)) return new Response(JSON.stringify({}), { status: 200 })
    if (isUsage(url)) return new Response(JSON.stringify(answer(url)), { status: 200 })
    return new Response(JSON.stringify({}), { status: 200 })
  })
  return { calls }
}

/** A gate a test opens to let held requests through. */
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => {}
  const promise = new Promise<void>(resolve => { open = resolve })
  return { promise, open }
}

/**
 * Hold every FULL usage request behind a gate, answering fast ones immediately.
 *
 * `stubFetch` installs its own global fetch, so it has to run FIRST; the holding
 * wrapper is installed on top of what it left behind.
 */
function holdFullRequests(): { calls: string[]; fullAttempts: string[]; release: () => void } {
  const held: string[] = []
  const release = gate()
  const base = stubFetch(() => fastDocument())
  const baseFetch = globalThis.fetch
  base.calls.length = 0
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (isFull(url)) {
      held.push(url)
      await release.promise
      // The full document, once the test lets it through.
      return new Response(JSON.stringify(fullDocument()), { status: 200 })
    }
    return baseFetch(input, init)
  })
  return { calls: base.calls, fullAttempts: held, release: release.open }
}

describe('the card paints the first document first (issue #77)', () => {
  it('shows the account rows while the full document is still in flight', async () => {
    const stub = holdFullRequests()
    render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)

    // The card starts collapsed; open it exactly like a user would.
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))

    // The rows are what the issue is about: they must be there BEFORE the
    // expensive document answers.
    await waitFor(() => { expect(screen.getByText('demo-user')).toBeTruthy() })
    expect(document.querySelector('.dsm-trae-pool')).not.toBeNull()
    // The signed-out guidance must NOT be shown: the user is signed in.
    expect(screen.queryByText('row.signedOutHint')).toBeNull()
    expect(screen.queryByText('row.accountsLoading')).toBeNull()
    // Both kinds of request were made: the fast one answered, the full one is held.
    expect(stub.calls.some(url => isFast(url))).toBe(true)
    expect(stub.fullAttempts.length).toBeGreaterThan(0)
  })

  it('says "loading" — not "not signed in" — before anything has answered', async () => {
    const held: string[] = []
    const open = gate()
    stubFetch(() => ({ status: 'signed-out', accounts: [] }))
    const baseFetch = globalThis.fetch
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      held.push(String(input))
      await open.promise
      return baseFetch(input, init)
    })
    render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))

    // Nothing has answered, so the only truthful word is "loading". Claiming the
    // user is signed out here was the visible half of issue #77.
    await waitFor(() => { expect(held.length).toBeGreaterThan(0) })
    expect(screen.getAllByText('row.accountsLoading').length).toBeGreaterThan(0)
    expect(screen.queryByText('row.signedOutHint')).toBeNull()

    open.open()
    // Once the answer is a genuine signed-out document, the guidance appears.
    await waitFor(() => { expect(screen.queryByText('row.signedOutHint')).toBeTruthy() })
    expect(screen.queryByText('row.accountsLoading')).toBeNull()
  })

  it('does not let a late first paint overwrite a full document', async () => {
    // Both documents answer immediately, but the fast one is the FIRST write and
    // the full one the second. The credit figure proves which document the card
    // ended up holding: only the full one carries one.
    const stub = stubFetch(url => isFast(url) ? fastDocument() : fullDocument())
    render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))

    await waitFor(() => { expect(screen.getByText('demo-user')).toBeTruthy() })
    // Wait until the full document has been requested AND applied.
    await waitFor(() => {
      const credits = document.querySelector('.dsm-trae-pool-credit-num')
      expect(credits?.textContent ?? '').toContain('20')
    })
    expect(stub.calls.some(url => isFast(url))).toBe(true)
    expect(stub.calls.some(url => isFull(url))).toBe(true)
  })
})
