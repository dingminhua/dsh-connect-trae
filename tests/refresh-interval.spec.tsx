// @vitest-environment jsdom
/**
 * The automatic-refresh cadence — `Config.refreshIntervalMinutes`.
 *
 * WHY THIS FILE EXISTS. Before this setting, the plugin polled at TWO different
 * rates for the same two upstream routes: the card re-read its usage document
 * every 60 seconds, and the composer readout every 5 minutes. Which rate you got
 * depended on which surface you happened to be looking at, and neither could be
 * changed. The user asked for one cadence, settable in 「能力」, defaulting to 5
 * minutes, with 1 / 5 / 10 / 30 / 60 on offer.
 *
 * Four properties have to hold, and each fails silently on its own:
 *
 *  1. the READER: an absent field, or a value outside the offered set, reads as
 *     the default — an unrecognized value must never stop the refresh;
 *  2. the SCHEMA: the write path refuses a number that is not on offer, so a
 *     hand-edited document cannot smuggle in a cadence nobody chose;
 *  3. the CARD: the picker shows the stored value and writes the picked one
 *     through a verified write, and the poll period it uses is the picked one —
 *     not a constant;
 *  4. the COMPOSER READOUT: the SAME field drives it, so the two surfaces cannot
 *     drift back to two rates.
 *
 * The timer assertions use fake timers and count REQUESTS rather than inspecting
 * the interval, because "the timer has the right period" is not observable from
 * outside and a constant could still be wired to the wrong place.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  refreshIntervalMinutesOf,
  refreshIntervalMsOf,
  TRAE_REFRESH_INTERVAL_DEFAULT_MINUTES,
  TRAE_REFRESH_INTERVAL_MINUTES,
  TRAE_USAGE_PATH,
} from '../src/status-paths.ts'
import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { COMPOSER_POINTS_REFRESH_INTERVAL_MS, ComposerPoints } from '../src/client/ComposerPoints.tsx'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

/** A settings scope over a mutable section document, recording every write. */
function makeScope(initial: Record<string, unknown>, writable = true) {
  let value: Record<string, unknown> = { ...initial }
  const listeners = new Set<() => void>()
  const writes: { field: string; value: unknown }[] = []
  return {
    writes,
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        writes.push({ field, value: next })
        value = { ...value, [field]: next }
        for (const listener of listeners) listener()
        return true
      },
    },
  }
}

/** The cadence picker, by its own accessible name rather than by position. */
function intervalPicker(): HTMLSelectElement {
  const [box] = screen.getAllByRole('combobox', { name: /row\.refreshIntervalAria/ }) as HTMLSelectElement[]
  if (box === undefined) throw new Error('the refresh-interval picker is missing from the card')
  return box
}

function usageDocument(): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [{ id: 'account-1', accountName: 'demo-user', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true }],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 5_879.63, available: 1_620.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
  }
}

/** Serve the usage route, counting how often it was read. */
function stubUsage(): { reads: () => number } {
  let reads = 0
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/usage')) {
      reads += 1
      return new Response(JSON.stringify(usageDocument()), { status: 200 })
    }
    if (url.includes('account-status')) {
      return new Response(JSON.stringify({ id: 'account-1' }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }))
  return { reads: () => reads }
}

describe('the cadence reader', () => {
  it('offers exactly the five documented values', () => {
    // The list IS the setting's value domain: the schema validates against it and
    // the picker renders it, so a change here must be a deliberate product
    // decision rather than a drifting literal in two files.
    expect([...TRAE_REFRESH_INTERVAL_MINUTES]).toEqual([1, 5, 10, 30, 60])
    expect(TRAE_REFRESH_INTERVAL_DEFAULT_MINUTES).toBe(5)
  })

  it('defaults to five minutes when nothing is stored', () => {
    // The default is what makes the upgrade a no-op: 5 minutes is what the
    // composer readout already used, and what the README has always quoted.
    expect(refreshIntervalMinutesOf(undefined)).toBe(5)
    expect(refreshIntervalMinutesOf({})).toBe(5)
    expect(refreshIntervalMinutesOf({ showPointsInMainUi: true })).toBe(5)
    expect(refreshIntervalMsOf({})).toBe(5 * 60_000)
  })

  it('accepts every offered value', () => {
    for (const minutes of TRAE_REFRESH_INTERVAL_MINUTES) {
      expect(refreshIntervalMinutesOf({ refreshIntervalMinutes: minutes })).toBe(minutes)
      expect(refreshIntervalMsOf({ refreshIntervalMinutes: minutes })).toBe(minutes * 60_000)
    }
  })

  it('falls back to the default for a value the schema would have refused', () => {
    // A hand-edited file is the case this covers. Refusing to refresh would be
    // the worst answer: the readout would silently stop updating and the only
    // symptom would be numbers that quietly went stale.
    for (const stored of [0, 2, 7, 90, -5, '5', null, true, [], {}]) {
      expect(refreshIntervalMinutesOf({ refreshIntervalMinutes: stored })).toBe(5)
    }
  })

  it('reads through a live reference, the 0.1.7 delivery shape', () => {
    // Volatile fields arrive as `{get(): T}`; a reader that skipped the unwrap
    // would see an object, fall back to the default, and the setting would look
    // broken on exactly the host this plugin targets.
    expect(refreshIntervalMinutesOf({ refreshIntervalMinutes: { get: () => 30 } })).toBe(30)
  })
})

describe('the schema refuses a cadence that is not on offer', () => {
  it('accepts every offered value and fills the default when absent', async () => {
    const { Config } = await import('../src/index.ts')
    const { unwrapVolatileDeep } = await import('../src/status-paths.ts')
    for (const minutes of TRAE_REFRESH_INTERVAL_MINUTES) {
      const validated = unwrapVolatileDeep(Config({ refreshIntervalMinutes: minutes } as never)) as unknown as {
        refreshIntervalMinutes?: number
      }
      expect(validated.refreshIntervalMinutes).toBe(minutes)
    }
    const defaulted = unwrapVolatileDeep(Config({} as never)) as unknown as { refreshIntervalMinutes?: number }
    expect(defaulted.refreshIntervalMinutes).toBe(5)
  })

  it('rejects 7, and anything else off the list', async () => {
    // Refusing at write time is what keeps the picker's list and the stored
    // document from disagreeing — the reader's fallback then only ever has to
    // cover a file that never went through this schema.
    const { Config } = await import('../src/index.ts')
    expect(() => Config({ refreshIntervalMinutes: 7 } as never)).toThrow(/expected 1 \| 5 \| 10 \| 30 \| 60/)
    expect(() => Config({ refreshIntervalMinutes: 0 } as never)).toThrow(/expected 1 \| 5 \| 10 \| 30 \| 60/)
  })
})

describe('the picker in the card', () => {
  /**
   * Expand the card and land on 能力, which is where the picker lives.
   *
   * The section split is load-bearing here: the card draws the account section
   * with `section: 'accounts'`, which SKIPS the preference block entirely, so a
   * picker assertion made from the default tab would fail for the right reason
   * (the control is not on that screen) and describe the wrong thing.
   */
  async function renderOpen(initial: Record<string, unknown>): Promise<ReturnType<typeof makeScope>> {
    stubUsage()
    const holder = makeScope(initial)
    render(<TraeUsageCard t={t} settingsScope={holder.scope as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await screen.findByRole('tab', { name: 'row.panelAccounts' })
    fireEvent.click(screen.getByRole('tab', { name: 'row.panelCapabilities' }))
    return holder
  }

  it('sits in the 能力 section, beside the other standing preferences', async () => {
    // The section's rule is "what the plugin may do on your behalf": a cadence
    // is one of those, and the account section is about who is serving.
    await renderOpen({})
    const caps = document.getElementById('dsm-trae-panel-capabilities')
    expect(caps?.querySelector('.dsm-trae-refresh-interval')).not.toBeNull()
    expect(document.getElementById('dsm-trae-panel-accounts')?.querySelector('.dsm-trae-refresh-interval')).toBeNull()
  })

  it('shows five minutes when nothing is stored', async () => {
    await renderOpen({})
    expect(intervalPicker().value).toBe('5')
  })

  it('shows the stored cadence', async () => {
    await renderOpen({ refreshIntervalMinutes: 30 })
    expect(intervalPicker().value).toBe('30')
  })

  it('writes the picked cadence, and only that field', async () => {
    const holder = await renderOpen({})
    fireEvent.change(intervalPicker(), { target: { value: '1' } })
    await waitFor(() => { expect(holder.writes.length).toBeGreaterThan(0) })
    expect(holder.writes).toEqual([{ field: 'refreshIntervalMinutes', value: 1 }])
    // The picker follows the committed document, so a write that reverted would
    // show here rather than leaving the control claiming a cadence nobody has.
    expect(intervalPicker().value).toBe('1')
  })

  it('refuses to write on a read-only scope', async () => {
    stubUsage()
    const holder = makeScope({}, false)
    render(<TraeUsageCard t={t} settingsScope={holder.scope as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await screen.findByRole('tab', { name: 'row.panelAccounts' })
    fireEvent.click(screen.getByRole('tab', { name: 'row.panelCapabilities' }))
    expect(intervalPicker().disabled).toBe(true)
    fireEvent.change(intervalPicker(), { target: { value: '60' } })
    expect(holder.writes).toHaveLength(0)
  })
})

describe('the card polls at the stored cadence', () => {
  it('re-reads usage once per interval, not once a minute', async () => {
    // The old behaviour was a hardcoded 60s. With 10 minutes stored, nothing may
    // be read at the one-minute mark and one read must land at ten — this is the
    // assertion that would have caught the constant still being wired in.
    vi.useFakeTimers()
    const host = stubUsage()
    render(<TraeUsageCard t={t} settingsScope={makeScope({ refreshIntervalMinutes: 10 }).scope as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const painted = host.reads()
    expect(painted).toBeGreaterThan(0)

    // Past the OLD 60s period, still short of the stored ten minutes.
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000) })
    expect(host.reads()).toBe(painted)

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000 + 1_000) })
    expect(host.reads()).toBe(painted + 1)
  })

  it('replaces the running timer when the cadence changes, leaving no second loop', async () => {
    // A cadence change must not leave the old interval ticking beside the new
    // one — that doubles the upstream reads and is invisible in the UI.
    vi.useFakeTimers()
    const host = stubUsage()
    const holder = makeScope({ refreshIntervalMinutes: 60 })
    render(<TraeUsageCard t={t} settingsScope={holder.scope as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fireEvent.click(screen.getByRole('tab', { name: 'row.panelCapabilities' }))
    const painted = host.reads()

    // Switch to one minute: the effect re-runs, so the 60-minute timer is gone.
    fireEvent.change(intervalPicker(), { target: { value: '1' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000 + 1_000) })
    // Exactly one read from the new cadence: two would mean the old timer is
    // still alive (it could not have fired yet anyway) or the effect mounted
    // twice without cleaning up.
    expect(host.reads()).toBe(painted + 1)
  })
})

describe('the composer readout shares the same cadence', () => {
  it('polls at the stored cadence instead of its own constant', async () => {
    // One field, two surfaces. A readout still on COMPOSER_POINTS_REFRESH_INTERVAL_MS
    // while the card uses the setting is the drift this pins against.
    vi.useFakeTimers()
    const host = stubUsage()
    const scope = makeScope({ refreshIntervalMinutes: 1 }).scope
    render(
      <ComposerPoints
        t={t}
        provider="trae"
        region="cn"
        settingsScope={scope as never}
      />,
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const painted = host.reads()
    expect(painted).toBeGreaterThan(0)

    // One minute — the stored cadence, far shorter than the old constant. This
    // single assertion is the one that would fail if the effect still used
    // COMPOSER_POINTS_REFRESH_INTERVAL_MS: at 60s that constant fires nothing.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000 + 100) })
    expect(host.reads()).toBe(painted + 1)

    // Two more minutes, i.e. one read per minute — bounded rather than exact:
    // the count across a long span depends on when the first fetch settled,
    // which is a scheduling detail, while "several reads, none of them waiting
    // for five minutes" is the property that matters.
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000) })
    expect(host.reads()).toBeGreaterThanOrEqual(painted + 3)
    expect(host.reads()).toBeLessThanOrEqual(painted + 4)
  })

  it('keeps its own default when rendered with no settings scope', async () => {
    // A test or a host that serves no settings surface still gets a readout;
    // the constant is the fallback, not a second source of truth.
    expect(COMPOSER_POINTS_REFRESH_INTERVAL_MS).toBe(TRAE_REFRESH_INTERVAL_DEFAULT_MINUTES * 60_000)
    vi.useFakeTimers()
    const host = stubUsage()
    render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const painted = host.reads()
    await act(async () => { await vi.advanceTimersByTimeAsync(COMPOSER_POINTS_REFRESH_INTERVAL_MS + 100) })
    expect(host.reads()).toBe(painted + 1)
    void TRAE_USAGE_PATH
  })
})
