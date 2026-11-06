// @vitest-environment jsdom
/**
 * The card's international subscription status, shown in the ai account row.
 *
 * WHY THIS FILE EXISTS — read before deleting or weakening it:
 * issue #19 reported a Pro member seeing "No active package". The old row
 * judged the account on `has_package` ALONE, which answers "does a package
 * entitlement row exist", not "is this account on a paid plan". Trae publishes
 * the plan separately as `user_pay_identity_str`, and the card now reads it.
 *
 * Subscription lives in the international account row (per account, via the
 * status route), so these specs render the SHIPPED `TraeUsageCard` with an ai
 * roster and assert on the per-row verdict drawn. A future edit that quietly
 * drops the plan identity again fails here.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_ACCOUNT_STATUS_PATH, TRAE_USAGE_PATH, traePlanIsPaid, withTraeRegion } from '../src/status-paths.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

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

const AI_ACCOUNT = { id: 'account-1', accountName: 'demo-user', edition: 'sg', region: 'ai', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true }

/** One signed-in ai document carrying the roster whose row holds subscription. */
function payDocument(overrides: Record<string, unknown> = {}) {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'ai',
    enabled: true,
    accounts: [AI_ACCOUNT],
    models: [],
    enabledModelIds: [],
    credits: undefined,
    ...overrides,
  }
}

function stubFetch(document: Record<string, unknown>, payStatus: Record<string, unknown>): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith(TRAE_ACCOUNT_STATUS_PATH)) {
      return new Response(JSON.stringify({
        id: 'account-1',
        payStatus: {
          isDollarUsageBilling: true, hasPackage: false, isPayFreshman: false,
          inTrial: false, trialEndTimeMs: 0,
          enableSoloLite: false, enableSoloBuilder: false, enableSoloCoder: false, enableSoloWeb: false,
          ...payStatus,
        },
      }), { status: 200 })
    }
    if (url.startsWith(TRAE_USAGE_PATH)) return new Response(JSON.stringify(document), { status: 200 })
    throw new Error(`unexpected fetch: ${url}`)
  })
}

/** Render the card expanded, switch to the ai tab, and wait for the account row. */
async function renderArtificialAccount(): Promise<void> {
  const { scope } = makeScope()
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  fireEvent.click(screen.getByRole('tab', { name: /row\.tabAi/ }))
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

describe('traePlanIsPaid', () => {
  it('treats only the exact Free identity as unpaid', () => {
    expect(traePlanIsPaid('Free')).toBe(false)
    expect(traePlanIsPaid('free')).toBe(false)
    expect(traePlanIsPaid('  Free  ')).toBe(false)
    expect(traePlanIsPaid(undefined)).toBe(false)
    expect(traePlanIsPaid('')).toBe(false)
    expect(traePlanIsPaid('Pro')).toBe(true)
    // An unrecognised tier is NOT "Free": understating a paid plan is the more
    // damaging error, and it is the one issue #19 hit.
    expect(traePlanIsPaid('Pro+')).toBe(true)
    expect(traePlanIsPaid('Trial')).toBe(true)
  })
})

/**
 * The international tab's subscription verdict, rendered in the account row.
 *
 * WHY THERE IS NO BOX SPEC ANY MORE — read before re-adding one:
 * the card used to draw a standalone 「订阅状态」 box below the account table,
 * repeating the bound account's plan. The table's 额度 column renders the same
 * verdict per account, so the box was a SECOND renderer of one value — and a
 * second renderer is exactly what drifts (`plan-text.ts` exists to prevent it).
 * It was removed by request. The roster row is now the ONLY surface for the
 * subscription, and the spec below is what keeps it honest.
 */
describe('TraeUsageCard subscription row (ai)', () => {
  it('shows a member as subscribed from the plan identity alone', async () => {
    // has_package stays false, exactly as the reporter's account behaved.
    stubFetch(payDocument(), { hasPackage: false, payIdentity: 5, payIdentityStr: 'Pro' })
    await renderArtificialAccount()

    // The row names the plan ON its balance line — one verdict, one line, no
    // separate subscription block beside the roster.
    await waitFor(() => { expect(within(accountRow('demo-user')).getByText('row.planTier:{"tier":"Pro"}')).toBeTruthy() })
    expect(within(accountRow('demo-user')).queryByText('row.noPackage')).toBeNull()
  })

  it('still reports a package entitlement without a plan identity', async () => {
    stubFetch(payDocument(), { hasPackage: true })
    await renderArtificialAccount()

    // Without a tier string the row renders the bare subscribed label; what
    // matters is that it is on and does not claim "no package".
    await waitFor(() => { expect(within(accountRow('demo-user')).getByText('row.subscribed')).toBeTruthy() })
    expect(within(accountRow('demo-user')).queryByText('row.noPackage')).toBeNull()
  })

  it('names the free tier instead of only saying there is no package', async () => {
    stubFetch(payDocument(), { hasPackage: false, payIdentity: 0, payIdentityStr: 'Free' })
    await renderArtificialAccount()

    await waitFor(() => { expect(within(accountRow('demo-user')).getByText('row.noPackage')).toBeTruthy() })
    expect(within(accountRow('demo-user')).queryByText('row.subscribed')).toBeNull()
  })

  it('reads the subscription through the region-scoped per-account status route', async () => {
    stubFetch(payDocument(), { hasPackage: true, payIdentity: 5, payIdentityStr: 'Pro' })
    const { scope } = makeScope()
    const readUrls: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith(TRAE_ACCOUNT_STATUS_PATH)) { readUrls.push(url); return new Response(JSON.stringify({ id: 'account-1' }), { status: 200 }) }
      if (url.startsWith(TRAE_USAGE_PATH)) return new Response(JSON.stringify(payDocument()), { status: 200 })
      throw new Error(`unexpected fetch: ${url}`)
    })
    render(<TraeUsageCard t={t} settingsScope={scope as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    fireEvent.click(screen.getByRole('tab', { name: /row\.tabAi/ }))
    await waitFor(() => { expect(screen.getByText('demo-user')).toBeTruthy() })

    // The row's subscription is read from the per-account status route, and the
    // read is region-scoped to ai exactly like every other route on this card.
    expect(readUrls.length).toBe(1)
    expect(readUrls[0]).toContain(withTraeRegion(TRAE_ACCOUNT_STATUS_PATH, 'ai') + '&accountId=')
  })
})

/**
 * The standalone 「订阅状态」 box is GONE, and this is what keeps it gone.
 *
 * The box restated the bound account's plan, which the 额度 column of the
 * 「当前使用」 row directly above it already renders from the same source. Only
 * the row may carry the verdict now — a box that reappears here would be the
 * second renderer `plan-text.ts` exists to rule out, and it would once again
 * disagree with the row the moment either read changed shape.
 */
describe('TraeUsageCard has no standalone subscription box (ai)', () => {
  it('does not render a 订阅状态 box on the international tab', async () => {
    stubFetch(payDocument(), { hasPackage: false, payIdentity: 0, payIdentityStr: 'Free' })
    await renderArtificialAccount()

    // The plan IS on screen — in the row's 额度 cell, and nowhere else.
    await waitFor(() => { expect(within(accountRow('demo-user')).getByText('row.noPackage')).toBeTruthy() })
    expect(screen.queryByText('row.subscriptionLabel')).toBeNull()
    expect(screen.queryByText('row.payStatusUnknown')).toBeNull()
  })

  it('does not render the box even when the plan read fails', async () => {
    // The box's other two states (a labelled "not loaded" strip, an error
    // paragraph) must not survive the removal either: a failed read leaves the
    // row without a figure, which `rowValue` already handles by rendering
    // nothing, and it must not resurrect the box in a degraded form.
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith(TRAE_ACCOUNT_STATUS_PATH)) return new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
      if (url.startsWith(TRAE_USAGE_PATH)) return new Response(JSON.stringify(payDocument()), { status: 200 })
      throw new Error(`unexpected fetch: ${url}`)
    })
    await renderArtificialAccount()

    expect(screen.queryByText('row.subscriptionLabel')).toBeNull()
    expect(screen.queryByText('row.payStatusUnknown')).toBeNull()
  })
})
