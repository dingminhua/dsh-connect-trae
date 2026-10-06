// @vitest-environment jsdom
/**
 * The sidebar credit line and its settings gate.
 *
 * Verifies the four runtime promises of feature 2:
 *  1. the gate renders NO row while `showPointsInMainUi` is off;
 *  2. on enable the first fetch is immediate (no 60s wait), then the periodic
 *     timer drives one fetch per SIDEBAR_POINTS_REFRESH_INTERVAL_MS;
 *  3. a failed refresh keeps the last known value and only flags the failure;
 *  4. unmount (switch off) clears the timer — no further fetches.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { SIDEBAR_POINTS_REFRESH_INTERVAL_MS, SidebarPoints } from '../src/client/SidebarPoints.tsx'
import { SidebarPointsGate } from '../src/client/SidebarPointsGate.tsx'
import { TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

/**
 * A CN usage document whose GENERAL bucket deliberately DIFFERS from the
 * aggregate `available` (issue #26 review).
 *
 * The line must show the general bucket, because that is the number the card
 * shows and the one the SOLO chat path spends; `available` is the upstream
 * aggregate and is not guaranteed to match. Making them differ here is what
 * stops a future edit from silently switching the line back to the aggregate
 * without a single test turning red.
 */
function cnUsageDocument(general: number, aggregate = general + 1111): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    accounts: [],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 7500 - general, available: aggregate, workAvailable: 0, generalAvailable: general, accounts: [] },
  }
}

/** Count fetches against the usage route. */
function stubRoute(handler: () => Response): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    calls.push(String(input))
    return handler()
  })
  return { calls }
}

function okResponse(): Response {
  return new Response(JSON.stringify(cnUsageDocument(4200)), { status: 200 })
}

describe('SidebarPoints', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('fetches immediately on mount and shows the credit line', async () => {
    const { calls } = stubRoute(okResponse)
    render(<SidebarPoints t={t} />)

    // Immediate fetch, addressed to the CN usage route.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe(withTraeRegion(TRAE_USAGE_PATH, 'cn'))
    await vi.waitFor(() => { expect(screen.getByText(/sidebar\.points/).textContent).toContain('4,200') })
  })

  it('starts the periodic timer only after the first fetch settles and clears it on unmount', async () => {
    const { calls } = stubRoute(okResponse)
    const rendered = render(<SidebarPoints t={t} />)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })

    await vi.advanceTimersByTimeAsync(SIDEBAR_POINTS_REFRESH_INTERVAL_MS)
    expect(calls).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(SIDEBAR_POINTS_REFRESH_INTERVAL_MS)
    expect(calls).toHaveLength(3)

    rendered.unmount()
    await vi.advanceTimersByTimeAsync(SIDEBAR_POINTS_REFRESH_INTERVAL_MS * 3)
    expect(calls).toHaveLength(3)
  })

  it('keeps the last value and flags the failure when a refresh fails', async () => {
    let attempt = 0
    const { calls } = stubRoute(() => {
      attempt += 1
      return attempt === 1 ? okResponse() : new Response(JSON.stringify({ error: 'boom' }), { status: 500 })
    })
    render(<SidebarPoints t={t} />)
    await vi.waitFor(() => { expect(screen.getByText(/sidebar\.points/).textContent).toContain('4,200') })

    await vi.advanceTimersByTimeAsync(SIDEBAR_POINTS_REFRESH_INTERVAL_MS)
    await vi.waitFor(() => { expect(screen.getByText(/sidebar\.refreshFailed/)).toBeTruthy() })
    // The previous numeric value is retained, not blanked on failure.
    expect(screen.getByText(/sidebar\.points/).textContent).toContain('4,200')
  })

  it('ignores refresh clicks while a fetch is already in flight', async () => {
    const calls: string[] = []
    let release: (() => void) | undefined
    vi.stubGlobal('fetch', async () => {
      calls.push('usage')
      await new Promise<void>(resolve => { release = resolve })
      return okResponse()
    })
    render(<SidebarPoints t={t} />)
    await vi.waitFor(() => { expect(calls).toHaveLength(1) })
    const button = screen.getByRole('button', { name: /sidebar\.refresh/ }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(calls).toHaveLength(1)
    release?.()
    await vi.waitFor(() => { expect(button.disabled).toBe(false) })
  })
})

describe('SidebarPointsGate', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  function makeScope(initial: boolean) {
    let value: unknown = { showPointsInMainUi: initial }
    const listeners = new Set<() => void>()
    return {
      scope: {
        getSnapshot: () => ({ status: 'ready', value, writable: true }),
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        set: async () => true,
      },
      setEnabled(next: boolean) {
        value = { showPointsInMainUi: next }
        for (const listener of listeners) listener()
      },
    }
  }

  it('shows the GENERAL bucket, not the upstream aggregate', async () => {
    // The fixture deliberately reports general=4200 and available=5311. The
    // line must read 4,200: the general bucket is what the card shows and what
    // the SOLO chat path spends, while `available` is an aggregate that need not
    // match either bucket.
    const { calls } = stubRoute(okResponse)
    render(<SidebarPoints t={t} />)
    await waitFor(() => { expect(screen.getByText(/4,200/)).toBeTruthy() })
    expect(screen.queryByText(/5,311/)).toBeNull()
    expect(calls[0]).toContain('/usage')
  })

  it('renders nothing while the sidebar is collapsed, and fetches nothing', async () => {
    // The shell squeezes the footer to a 56px rail instead of hiding it, so a
    // label + balance + button would ellipsise into "积…". A collapsed sidebar
    // is the normal working state, so the line must be absent there — and must
    // not start its fetch loop while absent.
    const { calls } = stubRoute(okResponse)
    const holder = makeScope(true)
    const { container } = render(<SidebarPointsGate t={t} settingsScope={holder.scope as never} wide={false} />)
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)

    // Expanding mounts it and the single fetch happens.
    render(<SidebarPointsGate t={t} settingsScope={holder.scope as never} wide={true} />)
    await waitFor(() => { expect(screen.getByText(/sidebar\.points/)).toBeTruthy() })
    expect(calls).toHaveLength(1)
  })

  it('refreshes on a five-minute cadence, not every minute', async () => {
    expect(SIDEBAR_POINTS_REFRESH_INTERVAL_MS).toBe(300_000)
  })

  it('renders nothing while off and mounts the line once enabled', async () => {
    const { calls } = stubRoute(okResponse)
    const holder = makeScope(false)
    render(<SidebarPointsGate t={t} settingsScope={holder.scope as never} />)
    expect(screen.queryByText(/sidebar\.points/)).toBeNull()
    expect(calls).toHaveLength(0)

    holder.setEnabled(true)
    await waitFor(() => { expect(screen.getByText(/sidebar\.points/)).toBeTruthy() })
    expect(calls).toHaveLength(1)

    holder.setEnabled(false)
    await waitFor(() => { expect(screen.queryByText(/sidebar\.points/)).toBeNull() })
  })
})
