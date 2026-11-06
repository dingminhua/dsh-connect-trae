// @vitest-environment jsdom
/**
 * The card's 「刷新账号与 Token」 press — what it WRITES, not just what it shows.
 *
 * WHY THIS FILE EXISTS: a refresh reported "找到 1 个账号 · 仍绑定 demo-user" while
 * the settings document kept `accounts.cn` EMPTY. The route's `selected` flag
 * answers "which account is in use", and when no binding was ever saved the
 * store answers with its DETECTED default (whatever the Trae app is signed in
 * to). Reading that flag as "already saved, nothing to do" made the press a
 * no-op on exactly the machines that needed it — a fresh install, or a Trae
 * sign-in the plugin had not recorded — so the card showed the account as bound
 * while the binding lived only in memory, and the next store rebuild
 * (restart, or a Trae sign-in change) re-defaulted somewhere else.
 *
 * The invariant these specs pin: after a refresh, the account the card DISPLAYS
 * as in use is the account the settings document RECORDS. Showing one and
 * saving nothing is the bug, and it is invisible in a screenshot — which is why
 * it needs a test rather than a review.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_ACCOUNT_STATUS_PATH, TRAE_ACCOUNTS_REFRESH_PATH, TRAE_USAGE_PATH } from '../src/status-paths.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

/** A settings scope over a mutable document, recording every write. */
function makeScope(initial: Record<string, unknown> = {}, writable = true) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  const writes: { field: string; value: unknown }[] = []
  return {
    writes,
    snapshot: () => value,
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        writes.push({ field, value: structuredClone(next) })
        value = { ...value, [field]: structuredClone(next) }
        for (const listener of listeners) listener()
      },
    },
  }
}

const ACCOUNTS = [
  { id: 'account-1', accountName: 'demo-user', edition: 'sg', region: 'ai', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
]

/** A signed-in document for the international region. */
function aiDocument(overrides: Record<string, unknown> = {}) {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'ai',
    enabled: true,
    accounts: ACCOUNTS,
    models: [],
    enabledModelIds: [],
    credits: undefined,
    ...overrides,
  }
}

/**
 * Stub the routes; `accounts` is what the REFRESH route answers.
 *
 * The refresh answer is given separately from the usage document on purpose:
 * they come from different places upstream, and the bug being pinned is the
 * card acting on one while believing the other.
 */
function stubFetch(
  accounts: { id: string; accountName?: string; selected: boolean }[],
  document: Record<string, unknown> = aiDocument(),
): { calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url.startsWith(TRAE_ACCOUNTS_REFRESH_PATH)) return new Response(JSON.stringify({ accounts }), { status: 200 })
    if (url.startsWith(TRAE_ACCOUNT_STATUS_PATH)) return new Response(JSON.stringify({ id: 'account-1' }), { status: 200 })
    if (url.startsWith(TRAE_USAGE_PATH)) return new Response(JSON.stringify(document), { status: 200 })
    throw new Error(`unexpected fetch: ${url}`)
  })
  return { calls }
}

/** Render the card on the international tab and wait for the account table. */
async function renderAi(scope: unknown): Promise<void> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  fireEvent.click(screen.getByRole('tab', { name: /row\.tabAi/ }))
  await waitFor(() => { expect(screen.getByText('demo-user')).toBeTruthy() })
}

/** The refresh button, inside the account block. */
function refreshButton(): HTMLElement {
  const block = screen.getByRole('region', { name: 'row.accountsTitle' })
  return within(block).getByRole('button', { name: /row\.accountsRescan|row\.refreshTokens|row\.accountsScanning/ }) as HTMLElement
}

describe('the refresh-accounts press persists what it displays', () => {
  it('SAVES the account the route reports as in use when nothing was bound yet', async () => {
    // The reported bug: `accounts` is EMPTY, the store still answers a
    // `selected` account (its detected default), and the old code treated that
    // as "already bound" and wrote nothing.
    const holder = makeScope({})
    stubFetch([{ id: 'account-1', accountName: 'demo-user', selected: true }])
    await renderAi(holder.scope)

    expect(holder.writes).toEqual([])
    fireEvent.click(refreshButton())

    await waitFor(() => { expect(holder.writes).toHaveLength(1) })
    expect(holder.writes[0]).toEqual({ field: 'accounts', value: { ai: 'account-1' } })
    // ...and it is on disk, not just in the write log.
    expect((holder.snapshot() as { accounts?: { ai?: string } }).accounts?.ai).toBe('account-1')
  })

  it('carries the OTHER region\'s binding through the write', async () => {
    // Both regions run at once (issue #11). A refresh of the international tab
    // must never drop the CN pick, or refreshing one side silently unbinds the
    // other. This is the same merge rule every other card write follows.
    const holder = makeScope({ accounts: { cn: 'cn-account-9' } })
    stubFetch([{ id: 'account-1', accountName: 'demo-user', selected: true }])
    await renderAi(holder.scope)

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(holder.writes).toHaveLength(1) })
    expect(holder.writes[0]?.value).toEqual({ cn: 'cn-account-9', ai: 'account-1' })
  })

  it('does not rewrite the document when the account is already the saved binding', async () => {
    // One press must not churn the settings document for nothing: an
    // unconditional write here would fire a `loader/volatile-update`, re-run
    // `applySelection`, and rebuild both stores on every click of a button that
    // changed nothing.
    const holder = makeScope({ accounts: { ai: 'account-1' } })
    stubFetch([{ id: 'account-1', accountName: 'demo-user', selected: true }])
    await renderAi(holder.scope)

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText(/row\.accountsRefreshed/)).toBeTruthy() })
    expect(holder.writes).toEqual([])
  })

  it('binds the row the route reports even when it flags none as in use', async () => {
    // No `selected: true` anywhere: the store gave no verdict this time. The
    // press still binds what it found — an account it can see is closer to the
    // truth than an id it cannot — but it must MERGE, never replace the map.
    const holder = makeScope({ accounts: { ai: 'account-7' } })
    stubFetch([{ id: 'account-1', accountName: 'demo-user', selected: false }])
    await renderAi(holder.scope)

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(holder.writes).toHaveLength(1) })
    expect(holder.writes[0]?.value).toEqual({ ai: 'account-1' })
  })

  it('writes nothing on a read-only scope, and still reports what it found', async () => {
    // A settings scope that refuses writes must not leave the card claiming a
    // save it could not perform.
    const holder = makeScope({}, false)
    stubFetch([{ id: 'account-1', accountName: 'demo-user', selected: true }])
    await renderAi(holder.scope)

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(screen.getByText(/row\.accountsRefreshed/)).toBeTruthy() })
    expect(holder.writes).toEqual([])
    // The note says "still bound", not "bound to" — the press did not save.
    expect(screen.getByText(/row\.accountsKept/)).toBeTruthy()
  })

  it('says so when the press actually moved the binding', async () => {
    // The note is the only feedback a silent write gets. It has to distinguish
    // "I saved this" from "this was already saved", which is the difference the
    // old wording collapsed into the same sentence.
    const holder = makeScope({})
    stubFetch([{ id: 'account-1', accountName: 'demo-user', selected: true }])
    await renderAi(holder.scope)

    fireEvent.click(refreshButton())
    await waitFor(() => { expect(holder.writes).toHaveLength(1) })
    expect(screen.getByText(/row\.accountsSaved/)).toBeTruthy()
    expect(screen.queryByText(/row\.accountsKept/)).toBeNull()
  })
})
