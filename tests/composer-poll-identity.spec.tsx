// @vitest-environment jsdom
/**
 * The per-account status read must happen on OPEN, not on the poll cycle.
 *
 * `fetchAccountPlans` reads the roster out of the usage document. It used to
 * take that document as a `useCallback` DEPENDENCY — and every poll stores a
 * fresh object, so the callback got a new identity every five minutes. The
 * effect that calls it is keyed on that identity, so each poll re-ran it and
 * re-read every account's status one request at a time.
 *
 * Nothing failed. The extra reads are indistinguishable from the intended ones
 * in every existing assertion, because they hit the same URL and the same
 * fixture answers. The only observable difference is the COUNT across a poll,
 * which is what this file measures (m02675 found it by mutation, not by a red
 * test: deleting the account-credits re-read still passed because this loop was
 * quietly making the same request).
 */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { COMPOSER_POINTS_REFRESH_INTERVAL_MS, ComposerPoints } from '../src/client/ComposerPoints.tsx'
import { TRAE_ACCOUNT_STATUS_PATH, withTraeRegion } from '../src/status-paths.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

const t = ((key: TraeSettingsKey) => key) as (key: TraeSettingsKey, params?: Record<string, unknown>) => string

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

/** Two ai accounts, so a per-account read is two requests, not one. */
function stubAiHost(): { statusReads: () => number } {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    if (url.startsWith(TRAE_ACCOUNT_STATUS_PATH)) {
      return new Response(JSON.stringify({ payStatus: 'pro' }), { status: 200 })
    }
    if (url.includes('/account-credits')) {
      return new Response(JSON.stringify({ accounts: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({
      status: 'signed-in',
      accountId: 'account-1',
      accountName: 'Account 1',
      tokenExpiresAtMs: Date.now() + 3_600_000,
      region: 'ai',
      accounts: [
        { id: 'account-1', accountName: 'Account 1', region: 'ai', selected: true },
        { id: 'account-2', accountName: 'Account 2', region: 'ai', selected: false },
      ],
      models: [],
      enabledModelIds: [],
      payStatus: 'pro',
    }), { status: 200 })
  })
  return {
    statusReads: () => calls.filter(url => url.startsWith(TRAE_ACCOUNT_STATUS_PATH)).length,
  }
}

describe('a poll does not re-read every account status', () => {
  it('reads on open, and adds no reads when the five-minute poll fires', async () => {
    // Fake timers BEFORE render: the poll's `setInterval` is created inside the
    // component's first effect, and switching to fake timers afterwards leaves
    // that real interval running — the test would then "pass" by never firing
    // the poll at all, which is exactly the hole the mutation check exposed.
    vi.useFakeTimers()
    const host = stubAiHost()
    const { container } = render(
      <ComposerPoints t={t} provider="trae-global" region="ai" />,
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText(/composer\.pointsGlobal/)).toBeTruthy()

    // Open the panel: this is the read the design wants.
    const trigger = container.querySelector('.dsm-trae-composer-points-trigger') as HTMLButtonElement
    trigger.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(screen.getByText(/composer\.panelTitleGlobal/)).toBeTruthy()
    await vi.advanceTimersByTimeAsync(0)
    const afterOpen = host.statusReads()
    // One request per ai account in the roster.
    expect(afterOpen).toBe(2)

    // Now let the poll fire. The document is re-read; the roster is unchanged,
    // so NOTHING about the per-account status should be re-read.
    await vi.advanceTimersByTimeAsync(COMPOSER_POINTS_REFRESH_INTERVAL_MS + 100)

    expect(host.statusReads()).toBe(afterOpen)
  })
})
