// @vitest-environment jsdom
/**
 * The card's per-account daily check-in button, driven through a REAL click.
 *
 * WHY THIS FILE EXISTS — read before deleting or weakening it:
 * the claim route is the only place in this plugin that changes upstream
 * account state, so the card's side of it has to be verified against the
 * SHIPPED component rather than reasoned about. The check-in control now lives
 * in EACH CN account row (it claims for THAT account without moving the whole
 * binding), reading its state from the per-account status route. Three things
 * must hold, and each has a way of silently breaking:
 *
 *  1. each row claims for ITSELF: the POST carries the row's `accountId`, and
 *     per-row state powers the button — not one shared bound-account block;
 *  2. a row's button is disabled once today is claimed — off `checkedIn` OR
 *     `didCheckedIn`, because the upstream reports them separately and the
 *     official app treats either as done;
 *  3. clicking it POSTs the region-scoped claim path, and a refusal that comes
 *     back as HTTP 200 with `claimed: false` is SHOWN, not swallowed.
 *
 * The component is rendered from `src/client/TraeUsageCard.tsx`; assertions are
 * on the rendered state and on the requests that actually went out.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Primitives ships browser-only CSS modules (shiki, `anser`, `*.module.css`) that
// jsdom cannot transform. The card needs exactly one icon from it, so the package
// is stubbed wholesale — the card itself is still the shipped implementation.
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

/** A settings scope over a mutable document; the card only reads it here. */
function makeScope(initial: Record<string, unknown> = {}, writable = true) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  return {
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        value = { ...value, [field]: structuredClone(next) }
        for (const listener of listeners) listener()
      },
    },
  }
}

const ACCOUNT = { id: 'account-1', accountName: 'demo-user', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true }

/**
 * One signed-in CN document carrying the roster whose row holds the check-in
 * control under test. The check-in state itself comes from the per-account
 * status route (`accountStatus`), not from the usage document.
 */
function usageDocument(overrides: Record<string, unknown> = {}) {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [ACCOUNT],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 5879.63, available: 1620.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
    ...overrides,
  }
}

/**
 * Stub fetch for the card's three route families and record what was requested.
 * `accountStatus` is the per-account status route's answer for the row;
 * `claimAnswer` is the claim route's answer.
 */
function stubFetch(
  document: Record<string, unknown>,
  accountStatus?: Record<string, unknown> | ((accountId: string) => Record<string, unknown>),
  claimAnswer: { status?: number; body?: unknown } = {},
): { calls: { url: string; method: string; body?: string }[] } {
  const calls: { url: string; method: string; body?: string }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET', ...init?.method === 'POST' ? { body: String(init.body ?? '') } : {} })
    if (url.startsWith(TRAE_CHECKIN_PATH)) {
      return new Response(JSON.stringify(claimAnswer.body ?? { claimed: true, alreadyCheckedIn: false, code: 0, checkin: {} }), {
        status: claimAnswer.status ?? 200,
      })
    }
    if (url.startsWith(TRAE_ACCOUNT_STATUS_PATH)) {
      const asked = new URL(url, 'http://local').searchParams.get('accountId') ?? 'account-1'
      const answer = typeof accountStatus === 'function' ? accountStatus(asked) : accountStatus ?? { id: 'account-1' }
      return new Response(JSON.stringify(answer), { status: 200 })
    }
    if (url.startsWith(TRAE_USAGE_PATH)) return new Response(JSON.stringify(document), { status: 200 })
    throw new Error(`unexpected fetch: ${url}`)
  })
  return { calls }
}

/** Render the card already expanded, so the usage route fires immediately. */
async function renderOpen(scope: unknown): Promise<void> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  await waitFor(() => { expect(screen.getByText('demo-user')).toBeTruthy() })
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

/** A row's check-in button, or a failure naming what the card actually rendered. */
function rowCheckin(row: string): HTMLButtonElement {
  return within(accountRow(row)).getByRole('button', { name: /row\.checkin(ClaimWith|Claim|Claiming|Claimed|DeviceSpentShort)/ }) as HTMLButtonElement
}

describe('TraeUsageCard daily check-in', () => {
  it('offers a check-in button in the account row, naming the payout on the button', async () => {
    stubFetch(usageDocument(), { id: 'account-1', checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true, extraCredits: 50 } })
    const { scope } = makeScope()
    await renderOpen(scope)

    const button = rowCheckin('demo-user')
    // The day's base reward rides ON the button: the row states the payout
    // without a second line of caption text beside it.
    expect(button.textContent).toBe('row.checkinClaimWith:{"reward":"150"}')
    expect(button.disabled).toBe(false)
  })

  it('POSTs the region-scoped claim path carrying the row account on a real click', async () => {
    const { calls } = stubFetch(
      usageDocument(),
      { id: 'account-1', checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true } },
    )
    const { scope } = makeScope()
    await renderOpen(scope)

    fireEvent.click(rowCheckin('demo-user'))

    await waitFor(() => { expect(calls.some(call => call.url === withTraeRegion(TRAE_CHECKIN_PATH, 'cn'))).toBe(true) })
    const claim = calls.find(call => call.url.startsWith(TRAE_CHECKIN_PATH))
    expect(claim?.method).toBe('POST')
    expect(claim?.url).toBe('/plugins/dsh-connect-trae/checkin?region=cn')
    // The claim is FOR this row's account — the binding is never moved.
    expect(claim?.body).toContain('account-1')
  })

  it('replaces the button with the outcome once today is claimed', async () => {
    // A disabled "已领取" button can never fire again; it just repeats the
    // state in grey. The cell says what happened instead.
    stubFetch(usageDocument(), { id: 'account-1', checkin: { checkedIn: true, didCheckedIn: true, credits: 150, enabled: true } })
    const { scope } = makeScope()
    await renderOpen(scope)

    expect(within(accountRow('demo-user')).queryByRole('button', { name: /row\.checkin/ })).toBeNull()
    expect(within(accountRow('demo-user')).getByText('row.poolCheckedIn')).toBeTruthy()
  })

  it('stops every row once THIS machine spent its check-in on another account', async () => {
    // Trae keys the daily claim to x-device-id: 9095 refuses the second account
    // from the same machine. The flag therefore belongs to the panel, not the
    // row — the old per-account reading left the other row's button enabled and
    // invited a click that could only be refused.
    const other = { ...ACCOUNT, id: 'account-2', accountName: '老二', selected: false }
    stubFetch(
      usageDocument({ accounts: [ACCOUNT, other] }),
      accountId => accountId === 'account-1'
        ? { id: accountId, checkin: { checkedIn: true, didCheckedIn: true, credits: 150, enabled: true } }
        : { id: accountId, checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true } },
    )
    const { scope } = makeScope()
    await renderOpen(scope)
    await waitFor(() => { expect(screen.getByText('老二')).toBeTruthy() })
    const spentRow = accountRow('老二')
    expect(within(spentRow).queryByRole('button', { name: /row\.checkin/ })).toBeNull()
    expect(within(spentRow).getByText('row.poolDeviceUsed')).toBeTruthy()
  })

  it('does not call a device-spent day "claimed today"', async () => {
    // Measured 2026-09-26: `did_checked_in` is keyed on the DEVICE
    // (`x-device-id`), not on the account. After switching accounts on one
    // machine the status reads `checked_in: false, did_checked_in: true`: the
    // machine's daily check-in is spent, but this account was never rewarded.
    // The row must keep the button disabled (a claim could only be refused with
    // 9095) while saying what actually happened — the old copy said "今日已领取",
    // which was the reported bug.
    stubFetch(usageDocument(), { id: 'account-1', checkin: { checkedIn: false, didCheckedIn: true, credits: 150, enabled: true } })
    const { scope } = makeScope()
    await renderOpen(scope)

    const row = accountRow('demo-user')
    expect(within(row).queryByRole('button', { name: /row\.checkin/ })).toBeNull()
    // Not "已签到": this account was never paid, only the machine was spent.
    expect(within(row).getByText('row.poolDeviceUsed')).toBeTruthy()
    expect(within(row).queryByText('row.poolCheckedIn')).toBeNull()
  })

  it('shows "claimed today" only when the ACCOUNT was paid', async () => {
    stubFetch(usageDocument(), { id: 'account-1', checkin: { checkedIn: true, didCheckedIn: true, credits: 150, enabled: true } })
    const { scope } = makeScope()
    await renderOpen(scope)

    const row = accountRow('demo-user')
    expect(within(row).getByText('row.poolCheckedIn')).toBeTruthy()
    // A paid account must never carry the device-spent wording.
    expect(within(row).queryByText('row.poolDeviceUsed')).toBeNull()
  })

  it('explains a device-spent refusal from the route instead of "failed"', async () => {
    // The route answers 9095 as `deviceCheckedIn` rather than as an error, so
    // the card must render the device explanation and NOT the generic
    // "签到失败" line — otherwise a rule of the upstream reads as a plugin bug.
    stubFetch(
      usageDocument(),
      { id: 'account-1', checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true } },
      { body: { claimed: false, alreadyCheckedIn: false, deviceCheckedIn: true, code: 9095, message: '当前设备今日已经签到，请明日再来哦～' } },
    )
    const { scope } = makeScope()
    await renderOpen(scope)

    fireEvent.click(rowCheckin('demo-user'))

    await waitFor(() => { expect(within(accountRow('demo-user')).getByText('row.poolDeviceUsed')).toBeTruthy() })
    expect(within(accountRow('demo-user')).queryByRole('button', { name: /row\.checkin/ })).toBeNull()
    expect(within(accountBlock()).queryByText(/row\.checkinError/)).toBeNull()
  })

  it('disables the button and notes itself when the activity is disabled', async () => {
    stubFetch(usageDocument(), { id: 'account-1', checkin: { checkedIn: false, didCheckedIn: false, credits: 0, enabled: false } })
    const { scope } = makeScope()
    await renderOpen(scope)

    expect(rowCheckin('demo-user').disabled).toBe(true)
  })

  it('shows no check-in button when the roster is empty', async () => {
    // With no account rows there is no check-in control (it lives per account),
    // matching the old behaviour for a region whose Host omits the surface.
    stubFetch(usageDocument({ accounts: [] }))
    const { scope } = makeScope()
    render(<TraeUsageCard t={t} settingsScope={scope as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await waitFor(() => { expect(accountBlock()).toBeTruthy() })

    expect(within(accountBlock()).queryByRole('button', { name: /row\.checkin/ })).toBeNull()
  })

  it('shows a business refusal instead of swallowing it', async () => {
    // A refusal arrives as HTTP 200 with `claimed: false` and the upstream's
    // code (9004 = the request was rejected). Rendering nothing there would
    // leave the user clicking a button that silently does nothing.
    stubFetch(
      usageDocument(),
      { id: 'account-1', checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true } },
      { body: { claimed: false, alreadyCheckedIn: false, code: 9004, message: 'The submitted order parameters are incorrect.' } },
    )
    const { scope } = makeScope()
    await renderOpen(scope)

    fireEvent.click(rowCheckin('demo-user'))

    await waitFor(() => { expect(within(accountBlock()).getByText(/row\.checkinError:.*9004/)).toBeTruthy() })
  })

  it('claims for the ONE row clicked only — never a per-account sweep', async () => {
    // Trae allows ONE claim per device per day (verified 2026-10-11 on a live
    // CN account), so sweeping every account would only produce a 9095 refusal
    // after the first. Each row therefore has its OWN claim button, but a click
    // sends exactly one POST for that row's account and never fans out.
    const document = usageDocument({
      accounts: [
        ACCOUNT,
        { id: 'account-2', accountName: 'SecondCN', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: false },
      ],
    })
    const { calls } = stubFetch(
      document,
      {
        id: 'account-1',
        checkin: { checkedIn: false, didCheckedIn: false, credits: 100, enabled: true },
      },
    )
    const { scope } = makeScope()
    await renderOpen(scope)

    fireEvent.click(rowCheckin('demo-user'))

    await waitFor(() => { expect(calls.some(call => call.url.startsWith(TRAE_CHECKIN_PATH))).toBe(true) })
    const claims = calls.filter(call => call.url.startsWith(TRAE_CHECKIN_PATH))
    expect(claims).toHaveLength(1)
    expect(claims[0]).toMatchObject({ method: 'POST', url: withTraeRegion(TRAE_CHECKIN_PATH, 'cn') })
    expect(claims[0]?.body).toContain('account-1')
  })

  it('reports a transport failure on the claim route', async () => {
    stubFetch(
      usageDocument(),
      { id: 'account-1', checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true } },
      { status: 500, body: { error: 'upstream exploded' } },
    )
    const { scope } = makeScope()
    await renderOpen(scope)

    fireEvent.click(rowCheckin('demo-user'))

    await waitFor(() => { expect(within(accountBlock()).getByText(/row\.checkinError:.*upstream exploded/)).toBeTruthy() })
  })

  /**
   * Trae spends the DEVICE's daily check-in, so one claim changes what every
   * other row may do: the siblings go from "check in" to "device already used".
   * Refreshing only the claimed row left them advertising a claim that could
   * only come back 9095 — a roster of live buttons of which exactly one could
   * work. This pins the sweep: the claim must re-read the siblings too, so the
   * server's own `didCheckedIn` decides rather than the card guessing.
   */
  it('re-reads the OTHER rows after a claim, not just the one clicked', async () => {
    const roster = [
      { id: 'account-1', accountName: 'demo-user', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
      { id: 'account-2', accountName: 'SecondCN', edition: 'cn', region: 'cn', source: 'cli', tokenExpiresAtMs: Date.now() + 7_200_000, selected: false },
    ]
    const statusReads: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith(TRAE_CHECKIN_PATH)) {
        return new Response(JSON.stringify({ claimed: true, alreadyCheckedIn: false, code: 0, checkin: {} }), { status: 200 })
      }
      if (url.startsWith(TRAE_ACCOUNT_STATUS_PATH)) {
        const id = new URL(url, 'http://localhost').searchParams.get('accountId') ?? ''
        statusReads.push(id)
        return new Response(JSON.stringify({ id, checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true } }), { status: 200 })
      }
      if (url.startsWith(TRAE_USAGE_PATH)) return new Response(JSON.stringify(usageDocument({ accounts: roster })), { status: 200 })
      throw new Error(`unexpected fetch: ${url}`)
    })
    const { scope } = makeScope()
    await renderOpen(scope)
    await waitFor(() => { expect(statusReads).toContain('account-2') })

    // Count only what the claim itself triggers.
    statusReads.length = 0
    fireEvent.click(rowCheckin('demo-user'))

    await waitFor(() => { expect(statusReads).toContain('account-2') })
    expect(statusReads).toContain('account-1')
  })
})
