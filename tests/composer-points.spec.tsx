// @vitest-environment jsdom
/**
 * The composer credit readout is provider-scoped: it exists so that two
 * connector plugins do not fight over one shared row. These cases pin the
 * scoping decision, which is the whole reason the component exists.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ComposerPoints, TRAE_COMPOSER_PROVIDERS } from '../src/client/ComposerPoints.tsx'
import { ComposerPointsGate, selectedProviderOf } from '../src/client/ComposerPointsGate.tsx'
import { TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
import { en, zh } from '../src/client/locales.ts'
import { TRAE_CARD_CSS } from '../src/client/styles.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

const t = ((key: TraeSettingsKey) => key) as (key: TraeSettingsKey, params?: Record<string, unknown>) => string

/** The repository root, for the source-reading guards below. */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The REAL Chinese copy, with `{placeholders}` filled in.
 *
 * Needed wherever a case asserts on rendered TEXT rather than on a locale KEY:
 * with the key-returning `t` above, every label renders as its key and a
 * formatting regression inside a substituted value would be invisible.
 */
const realT = ((key: TraeSettingsKey, params?: Record<string, unknown>) => {
  const template = zh[key] ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
}) as (key: TraeSettingsKey, params?: Record<string, unknown>) => string

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/**
 * The three forward expiry buckets, as the notice reads them.
 *
 * Each is CUMULATIVE and NESTED (`within24h` ⊆ `within3d` ⊆ `within7d`), so a
 * bucket's figure is "everything lapsing within that horizon" — which is why
 * each tier's sentence stands on its own.
 */
interface ExpiryShape {
  within24h: { total: number; packs: number; earliestExpiresAtMs?: number }
  within3d: { total: number; packs: number; earliestExpiresAtMs?: number }
  within7d: { total: number; packs: number; earliestExpiresAtMs?: number }
  expired?: { total: number; packs: number }
}

/** One bucket shape: the reported pack expires `earliest` ms from now. */
function expiryShape(expiry: { earliest: number }): ExpiryShape {
  return {
    within24h: { total: 0, packs: 0 },
    within3d: { total: 164, packs: 1, earliestExpiresAtMs: expiry.earliest },
    within7d: { total: 164, packs: 1, earliestExpiresAtMs: expiry.earliest },
    expired: { total: 0, packs: 0 },
  }
}

/**
 * A CN usage document.
 *
 * `expiry` is injected only by the expiry cases: the component renders the
 * "earliest expiry" line ONLY when `credits.expiry` exists, and the default
 * document deliberately has none, so the other 20+ cases in this file keep a
 * panel with no expiry row at all.
 */
function usageDocument(general: number, expiry?: ExpiryShape): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    accounts: [
      { id: 'account-1', accountName: 'LaoDing', edition: 'cn', region: 'cn', source: 'dsh', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
      { id: 'account-2', accountName: 'Backup', edition: 'cn', region: 'cn', source: 'dsh', tokenExpiresAtMs: Date.now() + 3_600_000, selected: false },
    ],
    models: [],
    enabledModelIds: [],
    credits: {
      total: 7500, consumed: 0, available: general + 1111, workAvailable: 1777, generalAvailable: general, accounts: [],
      // The 7-day bucket is the one the issue reported: a pack expiring TOMORROW
      // still lands here, and `soonestExpiryOf` reads `within24h` first, so an
      // empty 24h bucket with a populated 7d bucket is the exact reported shape.
      ...expiry === undefined ? {} : { expiry },
    },
  }
}

/**
 * Stub both endpoints this component reads.
 *
 * There are two: the usage document (5-minute readout) and the account-credits
 * table (read on panel open). Answering both with the usage shape would give
 * the table `accounts: []` and leave it empty, so a test that asserts table
 * rows would fail for the wrong reason.
 */
function stubRoute(options: { expiryAt?: number; expiry?: ExpiryShape } = {}): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input)
    calls.push(url)
    const body = url.includes('/account-credits')
      ? {
          accounts: [
            { id: 'account-1', accountName: 'LaoDing', selected: true, generalAvailable: 3392 },
            { id: 'account-2', accountName: 'Backup', selected: false, generalAvailable: 1777 },
          ],
        }
      : usageDocument(3392, options.expiry !== undefined
        ? options.expiry
        : options.expiryAt === undefined ? undefined : expiryShape({ earliest: options.expiryAt }))
    return new Response(JSON.stringify(body), { status: 200 })
  })
  return { calls }
}

describe('selectedProviderOf', () => {
  it('reads the provider out of the projection', () => {
    expect(selectedProviderOf({ lastUsed: { provider: 'trae' } })).toBe('trae')
  })

  it('prefers `next` over `lastUsed`, because an unsent switch is what the composer shows', () => {
    expect(selectedProviderOf({
      lastUsed: { provider: 'workbuddy-global' },
      next: { provider: 'trae' },
    })).toBe('trae')
  })

  it('returns undefined for an absent, null or malformed projection', () => {
    expect(selectedProviderOf(undefined)).toBeUndefined()
    expect(selectedProviderOf({})).toBeUndefined()
    expect(selectedProviderOf({ lastUsed: null, next: null })).toBeUndefined()
    expect(selectedProviderOf({ lastUsed: { provider: '' } })).toBeUndefined()
    expect(selectedProviderOf({ lastUsed: { provider: 42 } })).toBeUndefined()
  })
})

/**
 * A settings scope stub carrying the composer-credit switch.
 *
 * `unwrapVolatileDeep` recurses through plain objects, so `{ showPointsInMainUi }`
 * is exactly the shape the gate reads.
 */
/**
 * A settings scope carrying the composer switch plus an initial document, and
 * recording every `set`.
 *
 * `initial` matters for the account switch: the panel writes the WHOLE `accounts`
 * field through the shared merge helper, so a test must start with a
 * `regions`-independent `accounts` map and assert what came out — only the
 * written region may change, and the other region's selection must survive.
 */
function makeScope(enabled: boolean | undefined, initial: Record<string, unknown> = {}): {
  scope: unknown
  writes: { field: string; value: unknown }[]
  setEnabled: (next: boolean | undefined) => void
} {
  let value: Record<string, unknown> = { ...initial, ...enabled === undefined ? {} : { showPointsInMainUi: enabled } }
  const listeners = new Set<() => void>()
  const writes: { field: string; value: unknown }[] = []
  const scope = {
    getSnapshot: () => ({ status: 'ready', value, writable: true }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async (field: string, next: unknown) => {
      writes.push({ field, value: next })
      value = { ...value, [field]: next }
      for (const listener of [...listeners]) listener()
      return true
    },
  }
  return {
    scope,
    writes,
    setEnabled: (next: boolean | undefined) => {
      value = { ...value, ...next === undefined ? { showPointsInMainUi: undefined } : { showPointsInMainUi: next } }
      for (const listener of [...listeners]) listener()
    },
  }
}

describe('ComposerPointsGate provider scoping', () => {
  it('renders nothing while ANOTHER provider is selected, and fetches nothing', () => {
    // The entire point: the shared composer row stays untouched for every
    // provider this plugin does not own. The switch is deliberately ON here —
    // with it off this case would pass for the WRONG reason and stop testing
    // the provider rule at all.
    const { calls } = stubRoute()
    const { scope } = makeScope(true)
    const { container } = render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'workbuddy-global' } })}
      />,
    )
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('renders nothing when the projection has not landed yet', () => {
    const { calls } = stubRoute()
    const { scope } = makeScope(true)
    const { container } = render(
      <ComposerPointsGate t={t} settingsScope={scope as never} useProjection={() => undefined} />,
    )
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('renders and fetches CN credits for the trae provider', async () => {
    const { calls } = stubRoute()
    const { scope } = makeScope(true)
    render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    expect(screen.getByText(/3,392/)).toBeTruthy()
    expect(calls[0]).toBe(withTraeRegion(TRAE_USAGE_PATH, 'cn'))
  })

  it('shows the PLAN for the INTERNATIONAL provider, not a balance', async () => {
    // The ai side is subscription-based: its usage document carries `payStatus`
    // and never `credits`. The readout used to render NOTHING here, which is the
    // asymmetry a user reported — while an international model was selected the
    // whole readout vanished. It now shows what that side actually has.
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input)
      calls.push(url)
      return new Response(JSON.stringify({
        status: 'signed-in',
        accountId: 'ai-1',
        accountName: 'LaoDing',
        tokenExpiresAtMs: Date.now() + 3_600_000,
        region: 'ai',
        accounts: [
          { id: 'ai-1', accountName: 'LaoDing', edition: 'sg', region: 'ai', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
        ],
        models: [],
        enabledModelIds: [],
        payStatus: { isDollarUsageBilling: true, hasPackage: false, inTrial: false, trialEndTimeMs: 0, payIdentity: 5, payIdentityStr: 'Pro' },
      }), { status: 200 })
    })
    const { scope } = makeScope(true)
    render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae-global' } })}
      />,
    )
    // The plan name, under the INTERNATIONAL product label — not "Trae CN".
    await waitFor(() => { expect(screen.getByText(/composer\.pointsGlobal/)).toBeTruthy() })
    expect(screen.getByText(/Pro/)).toBeTruthy()
    // And it read the AI region's document, not the CN one.
    expect(calls[0]).toBe(withTraeRegion(TRAE_USAGE_PATH, 'ai'))
  })

  it('owns BOTH provider routes, one per region', () => {
    expect(TRAE_COMPOSER_PROVIDERS).toEqual({ 'trae': 'cn', 'trae-global': 'ai' })
  })
})

describe('ComposerPointsGate switch', () => {
  it('renders NOTHING when the switch is off, even for this plugin own model', () => {
    // Restored in 2.13.3: the composer row is shared, so the readout is opt-in.
    const { calls } = stubRoute()
    const { scope } = makeScope(false)
    const { container } = render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('treats an ABSENT switch as off, so a not-yet-populated scope shows nothing', () => {
    // The host default is false; a scope that has not landed must not flash the
    // row into the shared toolbar.
    const { calls } = stubRoute()
    const { scope } = makeScope(undefined)
    const { container } = render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('renders nothing when no settings scope was injected at all', () => {
    const { calls } = stubRoute()
    const { container } = render(
      <ComposerPointsGate t={t} useProjection={() => ({ lastUsed: { provider: 'trae' } })} />,
    )
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('follows the switch: turning it on appears, turning it off leaves NOTHING', async () => {
    // The card's checkbox writes the field; the readout follows the committed
    // snapshot rather than needing a remount.
    stubRoute()
    const { scope, setEnabled } = makeScope(false)
    const { container } = render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    expect(container.innerHTML).toBe('')

    setEnabled(true)
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })

    setEnabled(false)
    await waitFor(() => { expect(screen.queryByText(/composer\.points/)).toBeNull() })
    expect(container.innerHTML).toBe('')
  })
})

describe('ComposerPoints readout', () => {
  it('shows the GENERAL bucket, not the upstream aggregate', async () => {
    // Fixture reports general=3392 and available=4503; the row must read 3,392.
    stubRoute()
    render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/3,392/)).toBeTruthy() })
    expect(screen.queryByText(/4,503/)).toBeNull()
  })

  it('renders nothing when given a provider this plugin does not own', async () => {
    // Renders the readout DIRECTLY with a foreign provider. Without this case the
    // ownership guard is untested: the gate already filters, so both its own
    // guard and the component's would survive deletion unnoticed.
    const { calls } = stubRoute()
    const { container } = render(<ComposerPoints t={t} provider="workbuddy-global" region="cn" />)
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('separates label and value with a middle dot, and carries no unit word', async () => {
    // The row is shared and narrow: "Trae CN · 3,392", matching the model seat
    // beside it ("DeepSeek-V4.1-Flash · x0.08"). Pinned because both halves are
    // easy to lose in a refactor — a space instead of the dot, or the unit word
    // creeping back in.
    stubRoute()
    render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/3,392/)).toBeTruthy() })
    const text = screen.getByText(/3,392/).textContent ?? ''
    expect(text).toBe('composer.points · 3,392')
    expect(text).not.toMatch(/积分|credits/i)
  })

  it('the SHIPPED copy says "Trae CN" with no unit word, in both languages', () => {
    // Asserted against the real locale tables, not the key-returning test `t`:
    // with a fake `t` the rendered label is the KEY, so a unit word creeping
    // back into the real strings would never turn a test red.
    expect(zh['composer.points']).toBe('Trae CN')
    expect(en['composer.points']).toBe('Trae CN')
    expect(zh['composer.points']).not.toMatch(/积分/)
    expect(en['composer.points']).not.toMatch(/credits/i)
  })

  it('renders the REAL Chinese copy as "Trae CN · 3,392"', async () => {
    stubRoute()
    render(<ComposerPoints t={realT} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/3,392/)).toBeTruthy() })
    expect(screen.getByText(/3,392/).textContent).toBe('Trae CN · 3,392')
  })

  it('renders the earliest expiry with its DATE, not just a clock time', async () => {
    // Issue #71. `formatClock` renders only hh:mm, so a pack expiring TOMORROW at
    // 23:59 read as "Earliest: 23:59" — a full day earlier than the truth, in the
    // one sentence whose entire job is "how long do I have left". The card already
    // rendered the SAME locale key (`row.expiryEarliest`) through `formatDateTime`,
    // so one key had two granularities in one plugin. Both now go through
    // `formatDateTime`; this case is the guard the suite was missing entirely (no
    // expiry assertion existed anywhere before it).
    const expiryAt = Date.UTC(2026, 9, 31, 23, 59)
    stubRoute({ expiryAt })
    render(<ComposerPoints t={realT} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/3,392/)).toBeTruthy() })
    // `realT` renders the shipped copy, so the trigger is named "Trae CN · 3,392"
    // — not the locale key the key-returning `t` would produce.
    fireEvent.click(screen.getByRole('button', { name: /Trae CN/ }))
    await waitFor(() => { expect(document.querySelector('[role="dialog"]')).not.toBeNull() })

    const detail = document.querySelector('.dsm-trae-expiry-detail')?.textContent ?? ''
    // Still the same locale key, so the copy is unchanged — only the value's
    // granularity moved.
    expect(detail).toContain(zh['row.expiryEarliest'].split('{time}')[0]?.trim() ?? '')

    // The presence of a DATE is the whole point. `formatDateTime` is the exact
    // function the card already used for this same key, so asserting against it
    // is asserting the two surfaces agree.
    const expected = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(expiryAt))
    expect(detail).toContain(expected)
    // A date is rendered; a bare clock time is not (`23:59` alone was the bug).
    expect(detail).toMatch(/\d{4}/)

    // Negative control: the exact string the OLD code produced must be absent.
    const oldRendering = zh['row.expiryEarliest'].replace('{time}',
      new Date(expiryAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    expect(detail).not.toBe(oldRendering)
  })

  it('keeps the same-day refresh stamp as a bare clock time', async () => {
    // The fix must not overreach: `composer.lastRefresh` is "now" by
    // construction, always the same day, and widens the foot of a narrow panel
    // if it gains a date. It legitimately uses `formatClock`; only expiry moved.
    stubRoute({ expiryAt: Date.UTC(2026, 9, 31, 23, 59) })
    render(<ComposerPoints t={realT} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/3,392/)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /Trae CN/ }))
    await waitFor(() => { expect(document.querySelector('[role="dialog"]')).not.toBeNull() })

    const foot = document.querySelector('.dsm-trae-composer-panel-foot')?.textContent ?? ''
    // A bare hh:mm carries no year and no slash-separated date.
    expect(foot).toMatch(/\d{1,2}:\d{2}/)
    expect(foot).not.toMatch(/\d{4}/)
  })

  it('closes the panel on Escape', async () => {
    // The panel is portaled to document.body with no focus trap, so keyboard
    // dismissal is the only way out for a keyboard user; without this listener
    // the panel is a keyboard trap.
    stubRoute()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    fireEvent.click(container.querySelector('button.dsm-trae-composer-points-trigger') as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByText(/composer\.panelTitle/)).toBeTruthy() })

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await waitFor(() => { expect(screen.queryByText(/composer\.panelTitle/)).toBeNull() })
  })

  it('the row is one clickable trigger with NO refresh button; refresh lives in the panel', async () => {
    // The composer row is shared and must stay narrow: it is a single trigger,
    // and the refresh action is behind the click (in the anchored panel), like
    // the neighbouring Expert control.
    stubRoute()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    const trigger = container.querySelector('button.dsm-trae-composer-points-trigger')
    expect(trigger).not.toBeNull()
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog')
    // The only button in the row is the trigger itself.
    expect(container.querySelectorAll('button')).toHaveLength(1)
    expect(screen.queryByText(/composer\.refresh/)).toBeNull()

    // Clicking opens the panel, which carries the account, both buckets and the
    // refresh button.
    fireEvent.click(trigger as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByText(/composer\.panelTitle/)).toBeTruthy() })
    expect(screen.getByText(/composer\.account/)).toBeTruthy()
    expect(screen.getByText(/composer\.generalCredits/)).toBeTruthy()
    expect(screen.getByText(/composer\.refresh/)).toBeTruthy()
    // The panel is a TABLE of accounts, not a property list: every account in
    // the region gets a row, and the one figure per row is the general balance.
    expect(screen.getByText('LaoDing')).toBeTruthy()
    expect(screen.getByText('Backup')).toBeTruthy()
    // The bound account's figure, and the other account's — distinct numbers,
    // so "two rows showing the same number" cannot pass unnoticed.
    expect(screen.getByText('3,392')).toBeTruthy()
    expect(screen.getByText('1,777')).toBeTruthy()
    // Work credits were dropped from the panel on purpose (general only).
    expect(screen.queryByText(/composer\.workCredits/)).toBeNull()
  })
})

describe('the account table and account switching', () => {
  it('reads the per-account table only when the panel is OPEN', async () => {
    // One upstream read per account is paid on demand, never on the 5-minute
    // cycle: a healthy balance must not pay for a table nobody is looking at.
    const { calls } = stubRoute()
    const { scope } = makeScope(true)
    render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    expect(calls.filter(url => url.includes('/account-credits'))).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /composer\.points/ }))
    await waitFor(() => { expect(screen.getByText(/composer\.panelTitle/)).toBeTruthy() })
    await waitFor(() => {
      expect(calls.filter(url => url.includes('/account-credits')).length).toBeGreaterThan(0)
    })
  })

  it('disables the CURRENT account row and leaves the others switchable', async () => {
    stubRoute()
    const { scope } = makeScope(true)
    render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /composer\.points/ }))
    await waitFor(() => { expect(screen.getByText(/composer\.panelTitle/)).toBeTruthy() })

    const switches = screen.getAllByRole('button', { name: /composer\.switchTo/ }) as HTMLButtonElement[]
    expect(switches).toHaveLength(2)
    // The bound account is marked current: clicking it would be a no-op write.
    expect(switches[0]?.disabled).toBe(true)
    expect(switches[1]?.disabled).toBe(false)
  })

  it('switches by writing the shared accounts field, preserving the other region', async () => {
    // The field is also written by the card. Writing ONLY the target region
    // would drop the international selection — the reason both writers go
    // through the same merge helper.
    stubRoute()
    const holder = makeScope(true, { accounts: { cn: 'account-1', ai: 'keep-me' } })
    render(
      <ComposerPointsGate
        t={t}
        settingsScope={holder.scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /composer\.points/ }))
    await waitFor(() => { expect(screen.getByText(/composer\.panelTitle/)).toBeTruthy() })

    const other = (screen.getAllByRole('button', { name: /composer\.switchTo/ }) as HTMLButtonElement[])
      .find(button => button.disabled === false)
    // A guard rather than `toBeDefined()`: `expect` does not narrow types, and
    // clicking `undefined` would be a silent no-op that still passes.
    if (other === undefined) throw new Error('expected a switchable account row')
    fireEvent.click(other)

    await waitFor(() => { expect(holder.writes).toHaveLength(1) })
    expect(holder.writes[0]?.field).toBe('accounts')
    expect(holder.writes[0]?.value).toEqual({ cn: 'account-2', ai: 'keep-me' })
  })

  it('falls back to the usage document when the table omits the BOUND account', async () => {
    // The table request legitimately omits a figure it could not read. The
    // trigger on the same screen already shows the bound account's balance, so
    // the row must agree with it — a dash beside a number answers the same
    // question twice and differently. This is the live failure that shipped in
    // 2.14.0: the bound account's stored token is expired, the pure lookup
    // returns it as-is, and every other account read fine.
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/account-credits')) {
        return new Response(JSON.stringify({
          accounts: [
            { id: 'account-1', accountName: 'LaoDing', selected: true },
            { id: 'account-2', accountName: 'Backup', selected: false, generalAvailable: 1777 },
          ],
        }), { status: 200 })
      }
      return new Response(JSON.stringify(usageDocument(3392)), { status: 200 })
    })
    const { scope } = makeScope(true)
    render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /composer\.points/ }))
    await waitFor(() => { expect(screen.getByText(/composer\.panelTitle/)).toBeTruthy() })

    expect(screen.getByText('3,392')).toBeTruthy()
    expect(screen.getByText('1,777')).toBeTruthy()
    expect(screen.queryByText('—')).toBeNull()
  })

  it('does not write at all when the current account is pressed', async () => {
    stubRoute()
    const holder = makeScope(true, { accounts: { cn: 'account-1' } })
    render(
      <ComposerPointsGate
        t={t}
        settingsScope={holder.scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae' } })}
      />,
    )
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /composer\.points/ }))
    await waitFor(() => { expect(screen.getByText(/composer\.panelTitle/)).toBeTruthy() })

    const current = (screen.getAllByRole('button', { name: /composer\.switchTo/ }) as HTMLButtonElement[])
      .find(button => button.disabled === true)
    if (current === undefined) throw new Error('expected the current account row')
    fireEvent.click(current)
    expect(holder.writes).toHaveLength(0)
  })
})

describe('the expiry ladder picks the tightest bucket that has credit', () => {
  /**
   * Open the composer panel and read the expiry notice's headline sentence.
   *
   * The notice renders EXACTLY ONE tier, so the headline is the whole story:
   * which bucket was chosen, and how much credit it claims.
   */
  async function headlineOf(expiry: ExpiryShape): Promise<string> {
    stubRoute({ expiry })
    const { container } = render(<ComposerPoints t={realT} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/3,392/)).toBeTruthy() })
    fireEvent.click(screen.getByRole('button', { name: /Trae CN/ }))
    await waitFor(() => { expect(document.querySelector('[role="dialog"]')).not.toBeNull() })
    const notice = document.querySelector('.dsm-trae-expiry')
    expect(notice).not.toBeNull()
    return notice?.textContent ?? ''
  }

  const at = (days: number): number => Date.now() + days * 86_400_000

  it('reports the 24-hour tier when credit lapses inside a day', async () => {
    // The urgent tier outranks everything else, even when a wider bucket also
    // has credit in it.
    const text = await headlineOf({
      within24h: { total: 100, packs: 1, earliestExpiresAtMs: at(0.5) },
      within3d: { total: 300, packs: 2, earliestExpiresAtMs: at(0.5) },
      within7d: { total: 700, packs: 3, earliestExpiresAtMs: at(0.5) },
    })
    expect(text).toContain('24 小时内过期')
    // The 24-hour bucket's own figure — not the wider bucket's.
    expect(text).toContain('100')
    expect(text).not.toContain('700')
  })

  it('reports the 3-DAY tier when credit lapses in one to three days', async () => {
    // THE CASE THIS TIER EXISTS FOR: before it, a pack expiring in two days
    // was reported as "within 7 days" — true, but three times too coarse to
    // plan around, in the one sentence whose job is "how long do I have left".
    const text = await headlineOf({
      within24h: { total: 0, packs: 0 },
      within3d: { total: 200, packs: 1, earliestExpiresAtMs: at(2) },
      within7d: { total: 600, packs: 2, earliestExpiresAtMs: at(2) },
    })
    expect(text).toContain('3 天内过期')
    expect(text).toContain('200')
    expect(text).not.toContain('600')
  })

  it('reports the 7-day tier only when nothing lapses sooner', async () => {
    const text = await headlineOf({
      within24h: { total: 0, packs: 0 },
      within3d: { total: 0, packs: 0 },
      within7d: { total: 600, packs: 2, earliestExpiresAtMs: at(5) },
    })
    expect(text).toContain('7 天内过期')
    expect(text).toContain('600')
  })

  it('names the soonest expiry of the tier it chose', async () => {
    // The 3-day tier has its own soonest time, and it is the one to show: a
    // pack inside that band is what the reader is planning around.
    //
    // The buckets are NESTED, so their soonest times are nested too — the
    // fixture keeps them consistent (the 3-day bucket's soonest is also the
    // 7-day bucket's), exactly as the upstream summary produces them.
    const soonest = at(1.5)
    const text = await headlineOf({
      within24h: { total: 0, packs: 0 },
      within3d: { total: 200, packs: 1, earliestExpiresAtMs: soonest },
      within7d: { total: 600, packs: 2, earliestExpiresAtMs: soonest },
    })
    const expected = new Intl.DateTimeFormat(undefined, {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(new Date(soonest))
    expect(text).toContain(expected)
  })

  it('the 3-day tier reports its OWN bucket, so the figure stands alone', async () => {
    // Cumulative buckets, one tier shown at a time: "200 credit lapses within 3
    // days" is TRUE of that bucket on its own terms, and the reader is never
    // asked to add two figures together. This is why the tier reports
    // `within3d.total` rather than a remainder the 24-hour tier subtracted.
    const text = await headlineOf({
      within24h: { total: 0, packs: 0 },
      within3d: { total: 200, packs: 1, earliestExpiresAtMs: at(2) },
      within7d: { total: 600, packs: 2, earliestExpiresAtMs: at(2) },
    })
    // The tier's own pack count, not the widest bucket's.
    expect(text).toContain('（1 个套餐）')
    expect(text).not.toContain('（2 个套餐）')
  })
})

describe('the card and the composer panel share ONE expiry ladder', () => {
  /**
   * The guard for the CLASS of defect 4.6.7 shipped.
   *
   * The card's account panel and this composer panel render the SAME locale
   * keys (`row.expiryWarning*`, `row.expiryEarliest`) from the SAME upstream
   * buckets. When each carried its own ladder, they drifted: the card said
   * `2026/10/31 23:59` and the panel said `23:59`, from one key — a full day
   * apart, with no test failing.
   *
   * Both now call `./expiry-ladder.ts`, so the tier cannot be chosen twice.
   * This case pins that STRUCTURAL fact: the two surfaces must not name a
   * tier bucket themselves. A tier added to one surface only would show up
   * here, because that surface would read a bucket the ladder does not read.
   */
  it('neither surface reads a tier bucket on its own', () => {
    // Reading the sources, not the DOM: the rule is about WHICH buckets each
    // surface looks at, and only the source says that.
    const read = (relative: string): string => readFileSync(join(root, 'src', 'client', relative), 'utf8')
    const panel = read('ComposerPoints.tsx')
    const card = read('TraeAccountPanel.tsx')

    for (const [name, source] of [['ComposerPoints.tsx', panel], ['TraeAccountPanel.tsx', card]] as const) {
      // No surface may read a tier's buckets directly: the ladder owns that.
      for (const bucket of ['within24h', 'within3d', 'within7d', 'expired']) {
        expect(
          source.includes(`expiry.${bucket}`),
          `${name} reads expiry.${bucket} directly — the tier must be chosen by expiry-ladder.ts, so the card and the panel cannot drift`,
        ).toBe(false)
      }
      // Both must go through the shared ladder.
      expect(source, `${name} must import the shared expiry ladder`).toContain("from './expiry-ladder.ts'")
    }
  })
})

describe('the card stylesheet covers every expiry tone the ladder can produce', () => {
  /**
   * The CARD's own stylesheet had no guard for the expiry tones.
   *
   * The composer panel's guard (in `composer-styles.spec.tsx`) checks the
   * classes the PANEL renders against `COMPOSER_POINTS_CSS`. The card renders
   * the same four tone classes from the same ladder, but against
   * `TRAE_CARD_CSS` — a different constant, with no equivalent check. So a
   * card-side rule could go missing and nothing would notice: the panel would
   * still be styled, and the card would quietly lose its tone.
   *
   * This checks the four tones exist as RULES, which is what "the card can show
   * this tier" requires. The card's notice is not rendered in a test, so this
   * is deliberately a stylesheet-level check rather than a DOM one.
   */
  it('defines all four expiry tones', () => {
    for (const tone of ['dsm-trae-expiry-soon', 'dsm-trae-expiry-days', 'dsm-trae-expiry-week', 'dsm-trae-expiry-lapsed']) {
      expect(
        TRAE_CARD_CSS.includes(`.${tone}{`) || TRAE_CARD_CSS.includes(`.${tone}:`),
        `the card stylesheet has no rule for ${tone}`,
      ).toBe(true)
    }
  })

  it('defines the shared expiry notice and detail rules too', () => {
    for (const name of ['dsm-trae-expiry', 'dsm-trae-expiry-detail']) {
      expect(
        TRAE_CARD_CSS.includes(`.${name}{`) || TRAE_CARD_CSS.includes(`.${name}:`),
        `the card stylesheet has no rule for ${name}`,
      ).toBe(true)
    }
  })
})
