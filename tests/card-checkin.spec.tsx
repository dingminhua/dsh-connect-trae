// @vitest-environment jsdom
/**
 * The card's daily check-in button, driven through a REAL click.
 *
 * WHY THIS FILE EXISTS — read before deleting or weakening it:
 * the claim route is the only place in this plugin that changes upstream
 * account state, so the card's side of it has to be verified against the
 * SHIPPED component rather than reasoned about. Three things must hold, and
 * each has a way of silently breaking:
 *
 *  1. the button is offered only when the Host says the activity is enabled;
 *  2. it is disabled once today is claimed — off `checkedIn` OR `didCheckedIn`,
 *     because the upstream reports them separately and the official app treats
 *     either as done;
 *  3. clicking it POSTs the region-scoped claim path, and a refusal that comes
 *     back as HTTP 200 with `claimed: false` is SHOWN, not swallowed.
 *
 * The component is rendered from `src/client/TraeUsageCard.tsx`; assertions are
 * on the rendered state and on the requests that actually went out.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Primitives ships browser-only CSS modules (shiki, `anser`, `*.module.css`) that
// jsdom cannot transform. The card needs exactly one icon from it, so the package
// is stubbed wholesale — the card itself is still the shipped implementation.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_CHECKIN_PATH, TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
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

/** One signed-in card document, with the check-in block under test. */
function usageDocument(checkin: Record<string, unknown> | undefined, overrides: Record<string, unknown> = {}) {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 5879.63, available: 1620.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
    ...checkin === undefined ? {} : { checkin },
    ...overrides,
  }
}

/**
 * Stub fetch for the card's two route families and record what was requested.
 * The usage route answers the given document; the claim route answers
 * `claimAnswer`.
 */
function stubFetch(
  document: Record<string, unknown>,
  claimAnswer: { status?: number; body?: unknown } = {},
): { calls: { url: string; method: string }[] } {
  const calls: { url: string; method: string }[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push({ url, method: init?.method ?? 'GET' })
    if (url.startsWith(TRAE_CHECKIN_PATH)) {
      return new Response(JSON.stringify(claimAnswer.body ?? { claimed: true, alreadyCheckedIn: false, code: 0, checkin: {} }), {
        status: claimAnswer.status ?? 200,
      })
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
  await waitFor(() => { expect(screen.getByText(/row\.checkinLabel/)).toBeTruthy() })
}

/** The check-in button, or a failure naming what the card actually rendered. */
function checkinButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /row\.checkin/ }) as HTMLButtonElement
}

describe('TraeUsageCard daily check-in', () => {
  it('offers the claim button and labels the daily reward', async () => {
    stubFetch(usageDocument({ checkedIn: false, didCheckedIn: false, credits: 150, enabled: true, extraCredits: 50 }))
    const { scope } = makeScope()
    await renderOpen(scope)

    const button = checkinButton()
    expect(button.textContent).toBe('row.checkinClaim')
    expect(button.disabled).toBe(false)
    // The base reward AND the bonus are both shown, so the day's payout is not
    // understated as 150 when the upstream actually grants 200.
    expect(screen.getByText(/row\.checkinReward:.*150 \+ 50/)).toBeTruthy()
  })

  it('POSTs the region-scoped claim path on a real click', async () => {
    const document = usageDocument({ checkedIn: false, didCheckedIn: false, credits: 150, enabled: true })
    const { calls } = stubFetch(document)
    const { scope } = makeScope()
    await renderOpen(scope)

    fireEvent.click(checkinButton())

    await waitFor(() => { expect(calls.some(call => call.url === withTraeRegion(TRAE_CHECKIN_PATH, 'cn'))).toBe(true) })
    const claim = calls.find(call => call.url.startsWith(TRAE_CHECKIN_PATH))
    expect(claim?.method).toBe('POST')
    expect(claim?.url).toBe('/plugins/dsh-connect-trae/checkin?region=cn')
  })

  it('disables the button once today is claimed', async () => {
    stubFetch(usageDocument({ checkedIn: true, didCheckedIn: true, credits: 150, enabled: true }))
    const { scope } = makeScope()
    await renderOpen(scope)

    const button = checkinButton()
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('row.checkinClaimed')
  })

  it('does not call a device-spent day "claimed today"', async () => {
    // Measured 2026-09-26: `did_checked_in` is keyed on the DEVICE
    // (`x-device-id`), not on the account. After switching accounts on one
    // machine the status reads `checked_in: false, did_checked_in: true`: the
    // machine's daily check-in is spent, but the newly selected account was
    // never rewarded. The card must keep the button disabled (a claim could
    // only be refused with 9095) while saying what actually happened — the old
    // copy said "今日已领取", which was the reported bug.
    stubFetch(usageDocument({ checkedIn: false, didCheckedIn: true, credits: 150, enabled: true }))
    const { scope } = makeScope()
    await renderOpen(scope)

    const button = checkinButton()
    expect(button.disabled).toBe(true)
    expect(button.textContent).toBe('row.checkinClaim')
    expect(screen.getByText('row.checkinDeviceSpent')).toBeTruthy()
    expect(screen.queryByText(/row\.checkinDoneHint/)).toBeNull()
  })

  it('shows "claimed today" only when the ACCOUNT was paid', async () => {
    stubFetch(usageDocument({ checkedIn: true, didCheckedIn: true, credits: 150, enabled: true }))
    const { scope } = makeScope()
    await renderOpen(scope)

    expect(checkinButton().disabled).toBe(true)
    expect(checkinButton().textContent).toBe('row.checkinClaimed')
    expect(screen.queryByText('row.checkinDeviceSpent')).toBeNull()
  })

  it('explains a device-spent refusal from the route instead of "failed"', async () => {
    // The route answers 9095 as `deviceCheckedIn` rather than as an error, so
    // the card must render the device explanation and NOT the generic
    // "签到失败" line — otherwise a rule of the upstream reads as a plugin bug.
    stubFetch(
      usageDocument({ checkedIn: false, didCheckedIn: false, credits: 150, enabled: true }),
      { body: { claimed: false, alreadyCheckedIn: false, deviceCheckedIn: true, code: 9095, message: '当前设备今日已经签到，请明日再来哦～' } },
    )
    const { scope } = makeScope()
    await renderOpen(scope)

    fireEvent.click(checkinButton())

    await waitFor(() => { expect(screen.getByText('row.checkinDeviceSpent')).toBeTruthy() })
    expect(screen.queryByText(/row\.checkinError/)).toBeNull()
  })

  it('hides the button and explains itself when the activity is disabled', async () => {
    stubFetch(usageDocument({ checkedIn: false, didCheckedIn: false, credits: 0, enabled: false }))
    const { scope } = makeScope()
    await renderOpen(scope)

    expect(checkinButton().disabled).toBe(true)
    expect(screen.getByText('row.checkinDisabled')).toBeTruthy()
  })

  it('renders no check-in block at all when the Host sends none', async () => {
    // The international region has no check-in surface, so the Host omits the
    // block; the card must not invent a button that cannot work.
    stubFetch(usageDocument(undefined, { region: 'ai', credits: undefined, payStatus: { hasPackage: true, inTrial: false, trialEndTimeMs: 0, isDollarUsageBilling: false, isPayFreshman: false, enableSoloLite: false, enableSoloBuilder: false, enableSoloCoder: false, enableSoloWeb: false } }))
    const { scope } = makeScope()
    render(<TraeUsageCard t={t} settingsScope={scope as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await waitFor(() => { expect(screen.getByText(/row\.subscriptionLabel/)).toBeTruthy() })

    expect(screen.queryByText(/row\.checkinLabel/)).toBeNull()
  })

  it('shows a business refusal instead of swallowing it', async () => {
    // A refusal arrives as HTTP 200 with `claimed: false` and the upstream's
    // code (9004 = the request was rejected). Rendering nothing there would
    // leave the user clicking a button that silently does nothing.
    stubFetch(
      usageDocument({ checkedIn: false, didCheckedIn: false, credits: 150, enabled: true }),
      { body: { claimed: false, alreadyCheckedIn: false, code: 9004, message: 'The submitted order parameters are incorrect.' } },
    )
    const { scope } = makeScope()
    await renderOpen(scope)

    fireEvent.click(checkinButton())

    await waitFor(() => { expect(screen.getByText(/row\.checkinError:.*9004/)).toBeTruthy() })
  })

  it('reports a transport failure on the claim route', async () => {
    stubFetch(
      usageDocument({ checkedIn: false, didCheckedIn: false, credits: 150, enabled: true }),
      { status: 500, body: { error: 'upstream exploded' } },
    )
    const { scope } = makeScope()
    await renderOpen(scope)

    fireEvent.click(checkinButton())

    await waitFor(() => { expect(screen.getByText(/row\.checkinError:.*upstream exploded/)).toBeTruthy() })
  })
})
