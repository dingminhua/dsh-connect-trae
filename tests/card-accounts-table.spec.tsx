// @vitest-environment jsdom
/**
 * The card's account block — the table that replaced the account dropdown.
 *
 * WHY THIS FILE EXISTS: a machine can hold several Trae sign-ins, and the ONE
 * thing the card has to get right is which account a click binds. A dropdown
 * could only ever show the account already chosen; the table shows the roster.
 * Three properties have to hold, and each has a way of breaking silently:
 *
 *  1. the row the plugin is bound to is MARKED, and its own action is not
 *     offered (a disabled "switch to the account you are on" is noise, and an
 *     enabled one is a wasted settings write);
 *  2. switching writes ONLY that region's slot: the sibling region's pick is
 *     carried through, so switching the CN account never rebinds the
 *     international one (this plugin serves both at once — issue #11);
 *  3. each row carries its OWN account status — the CN check-in button / reward
 *     and the balances it needs, and (on ai) the subscription verdict. These
 *     are fetched per account from the status route, so one account's read
 *     failure never takes the roster (or another row) down.
 *
 * It also pins that check-in lives PER ROW, never as a sweep: Trae allows one
 * check-in per DEVICE per day, so a "do it for every account" sweep could only
 * ever produce a refusal per account after the first. Each row gets its own
 * claim button (which claims for THAT account only), but there is no bulk
 * "claim for every account" control anywhere.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Primitives ships browser-only CSS modules that jsdom cannot transform; the
// card needs exactly one icon from it.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_ACCOUNT_STATUS_PATH, TRAE_CHECKIN_PATH, TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
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
  { id: 'account-1', accountName: 'demo-user', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
  { id: 'account-2', accountName: 'SecondCN', edition: 'solo', region: 'cn', source: 'cli', tokenExpiresAtMs: Date.now() + 7_200_000, selected: false },
]

/** A signed-in CN document carrying the roster under test. */
function usageDocument(overrides: Record<string, unknown> = {}) {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: ACCOUNTS,
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 5_879.63, available: 1_620.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
    ...overrides,
  }
}

/** Map account id → per-account status for the status route. */
type StatusCatalog = Record<string, Record<string, unknown>>

/**
 * Stub the card's routes and record what was requested. `statusCatalog` is what
 * the per-account status route answers per account; `statusStatus` lets a test
 * make the route fail for every account.
 */
function stubFetch(
  document: Record<string, unknown>,
  statusCatalog?: StatusCatalog,
  statusStatus = 200,
): { calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url.startsWith(TRAE_ACCOUNT_STATUS_PATH)) {
      if (statusStatus !== 200) return new Response(JSON.stringify({ error: 'gateway' }), { status: statusStatus })
      const id = new URL(url, 'http://localhost').searchParams.get('accountId')
      const state = statusCatalog?.[id ?? ''] ?? { id }
      return new Response(JSON.stringify(state), { status: 200 })
    }
    if (url.startsWith(TRAE_CHECKIN_PATH)) {
      return new Response(JSON.stringify({ claimed: true, alreadyCheckedIn: false, code: 0, checkin: {} }), { status: 200 })
    }
    if (url.startsWith(TRAE_USAGE_PATH)) return new Response(JSON.stringify(document), { status: 200 })
    throw new Error(`unexpected fetch: ${url}`)
  })
  return { calls }
}

/** Render the card expanded and wait for the account table to exist. */
async function renderOpen(scope: unknown): Promise<void> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  await waitFor(() => { expect(screen.getByRole('region', { name: 'row.accountsTitle' })).toBeTruthy() })
}

/** The account block, so its buttons are never confused with the model block's. */
function accountBlock(): HTMLElement {
  return screen.getByRole('region', { name: 'row.accountsTitle' })
}

/**
 * One account row, by the account name it renders.
 *
 * The row is a grid `div[role=row]`, not a `<li>`: the account block became a
 * TABLE (header row + one grid row per account) to match the sibling
 * dsh-connect-workbuddy card, whose fixed tracks are what stop the columns
 * drifting with their own content.
 */
function accountRow(name: string): HTMLElement {
  return within(accountBlock()).getByText(name).closest('.dsm-trae-account-row') as HTMLElement
}

describe('the account rows in the card', () => {
  it('lists every detected account with its product and source', async () => {
    stubFetch(usageDocument())
    const { scope } = makeScope()
    await renderOpen(scope)

    // The header row plus one row per account: the header is what makes the
    // tracks a TABLE the eye can read DOWN, so its presence is part of the
    // contract rather than chrome to be tolerated.
    const rows = within(accountBlock()).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(rows[0]?.className).toContain('dsm-trae-account-row-head')
    expect(accountRow('demo-user')).toBeTruthy()
    expect(accountRow('SecondCN')).toBeTruthy()

    // The raw `edition` token used to be all the user got: "solo" told them
    // nothing about which product the credential came from (issue #25).
    expect(accountRow('SecondCN').textContent).toContain('row.editionSolo')
    expect(accountRow('SecondCN').textContent).toContain('row.sourceCli')
    expect(accountRow('demo-user').textContent).toContain('row.sourceDesktop')
    // The region is NOT repeated beside the edition: "国内版 · 国内 · 桌面端"
    // said the same thing twice, which is exactly the noise that was removed.
    expect(accountRow('demo-user').textContent).not.toContain('row.regionCn')
  })

  it('marks the bound account and does not offer it an action', async () => {
    stubFetch(usageDocument())
    const { scope } = makeScope()
    await renderOpen(scope)

    const current = accountRow('demo-user')
    expect(current.className).toContain('dsm-trae-account-row-current')
    expect(current.textContent).toContain('row.accountCurrentBadge')

    const other = accountRow('SecondCN')
    expect(other.className).not.toContain('dsm-trae-account-row-current')

    // The bound row offers NO switch: it is already the one in use, and a
    // disabled copy of the badge sitting next to the badge said nothing.
    expect(within(current).queryByRole('button', { name: 'row.accountSwitch' })).toBeNull()
    expect((within(other).getByRole('button', { name: 'row.accountSwitch' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('switches to a clicked account, writing only its own region slot', async () => {
    // The international tab already points at its own account: switching the CN
    // one must carry that slot through untouched, not clear it.
    stubFetch(usageDocument())
    const holder = makeScope({ accounts: { ai: 'account-sg' } })
    await renderOpen(holder.scope)

    const action = within(accountRow('SecondCN')).getByRole('button', { name: 'row.accountSwitch' })
    fireEvent.click(action)

    await vi.waitFor(() => { expect(holder.writes.length).toBeGreaterThan(0) })
    expect(holder.writes[0]).toEqual({ field: 'accounts', value: { ai: 'account-sg', cn: 'account-2' } })
  })

  it('loads a per-account status (including balance) for each row, one read per account', async () => {
    // Balances (and the CN check-in state) now arrive per row from the status
    // route when the table shows, and each account is read exactly once.
    const { calls } = stubFetch(usageDocument(), {
      'account-1': { id: 'account-1', credits: { total: 7500, consumed: 5879.63, available: 1620.37, workAvailable: 0, generalAvailable: 20.37 } },
      'account-2': { id: 'account-2', credits: { total: 2000, consumed: 0, available: 2000, workAvailable: 0, generalAvailable: 1_234.56 } },
    })
    const { scope } = makeScope()
    await renderOpen(scope)

    await vi.waitFor(() => { expect(accountRow('SecondCN').textContent).toMatch(/1,235/) })
    expect(accountRow('demo-user').textContent).toMatch(/row\.accountBalance:.*20/)
    const reads = calls.filter(call => call.url.startsWith(TRAE_ACCOUNT_STATUS_PATH))
    // Two accounts → two per-account status reads, region-scoped like the rest.
    expect(reads).toHaveLength(2)
    for (const read of reads) expect(read.url).toContain(withTraeRegion(TRAE_ACCOUNT_STATUS_PATH, 'cn') + '&accountId=')
  })

  it('keeps a row visible without a figure when its status read fails', async () => {
    stubFetch(usageDocument(), undefined, 502)
    const { scope } = makeScope()
    await renderOpen(scope)

    // The roster is untouched by a failed per-account status: the row stays and
    // both accounts are still switchable — no error banner, no empty table.
    expect(accountRow('SecondCN')).toBeTruthy()
    expect(accountRow('demo-user')).toBeTruthy()
  })

  it('gives every CN account row its OWN claim button, and none to a bulk sweep', async () => {
    // Trae's rule, verified live 2026-10-11: `did_checked_in` is keyed on the
    // DEVICE, so after the first account claims, every further account on this
    // machine answers 9095. A "check in every account" button could therefore
    // only ever fail after the first one — so there is deliberately none. Each
    // row instead carries its own button that claims for THAT account only.
    stubFetch(usageDocument(), {
      'account-1': { id: 'account-1', checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true, extraCredits: 50 } },
      'account-2': { id: 'account-2', checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true, extraCredits: 50 } },
    })
    const { scope } = makeScope()
    await renderOpen(scope)

    await waitFor(() => { expect(screen.getAllByRole('button', { name: /row\.checkinClaimWith/ })).toHaveLength(2) })
    // They live INSIDE their own rows — never a single control for the roster.
    expect(within(accountRow('demo-user')).getByRole('button', { name: /row\.checkinClaimWith/ })).toBeTruthy()
    expect(within(accountRow('SecondCN')).getByRole('button', { name: /row\.checkinClaimWith/ })).toBeTruthy()
  })
})

describe('the stale-binding hint', () => {
  /**
   * The hint fires when Trae itself signed in somewhere else and the plugin's
   * binding did not follow (issue #29). It has two ways of being useless, and it
   * shipped with both:
   *
   *  - it named only the APP's account and called the other one "the previous
   *    account", so the reader still had to go hunting the roster to learn which
   *    account the plugin was on — the exact errand the hint exists to save;
   *  - it said "Trae is CURRENTLY signed in to X" while the roster badges a
   *    different row "in use", so the two "current" claims read as a
   *    contradiction and the sentence looked meaningless.
   *
   * Naming both accounts fixes both: the sentence is self-contained, and
   * "in use" (the plugin's binding) no longer competes with "signed in" (the
   * app's login) because each is attached to a named account.
   */
  /**
   * A signed-out panel is NOT an empty panel.
   *
   * The Host answers a signed-out region WITH the roster it found: that is how
   * "your bound account's token cannot be refreshed" reaches the card, and why
   * the reason and the rows arrive in the same response. The card used to keep
   * only the reason — the table rendered on `status === 'signed-in'` alone — so
   * a dead binding produced a message with no rows under it, and the one press
   * that fixes it (bind this other account) did not exist on screen.
   *
   * This is the shape of the 2026-10-18 report ("accounts can no longer be
   * refreshed at all"): the roster was there the whole time and the card was
   * dropping it.
   */
  it('still lists the roster when the bound account cannot be used', async () => {
    stubFetch(usageDocument({
      status: 'signed-out',
      accountId: undefined,
      accountName: undefined,
      tokenExpiresAtMs: undefined,
      credits: undefined,
      message: 'trae: token refresh failed and access token is expired',
    }))
    const holder = makeScope()
    await renderOpen(holder.scope)

    // The reason stays where the card has always put it (its own line under the
    // table), because it is the only thing that says WHY.
    expect(screen.getByText(/token refresh failed and access token is expired/)).toBeTruthy()

    // …and the rows stay with it: header plus both accounts.
    const rows = within(accountBlock()).getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(accountRow('demo-user')).toBeTruthy()

    // The bound account is still named as the bound one — the roster's own
    // `selected` flag is the only source for that when the document carries no
    // `accountId` — and it still offers no redundant action.
    expect(accountRow('demo-user').className).toContain('dsm-trae-account-row-current')
    expect(within(accountRow('demo-user')).queryByRole('button', { name: 'row.accountSwitch' })).toBeNull()

    // The OTHER row is the way out, and it has to actually work: one press
    // rebinds the slot to an account that is still usable.
    const action = within(accountRow('SecondCN')).getByRole('button', { name: 'row.accountSwitch' })
    expect((action as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(action)

    await vi.waitFor(() => { expect(holder.writes.length).toBeGreaterThan(0) })
    expect(holder.writes[0]).toEqual({ field: 'accounts', value: { cn: 'account-2' } })
  })
})
