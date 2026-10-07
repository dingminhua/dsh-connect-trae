// @vitest-environment jsdom
/**
 * The composer credit readout is provider-scoped: it exists so that two
 * connector plugins do not fight over one shared row. These cases pin the
 * scoping decision, which is the whole reason the component exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ComposerPoints, TRAE_COMPOSER_PROVIDERS } from '../src/client/ComposerPoints.tsx'
import { ComposerPointsGate, selectedProviderOf } from '../src/client/ComposerPointsGate.tsx'
import { TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
import { en, zh } from '../src/client/locales.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

const t = ((key: TraeSettingsKey) => key) as (key: TraeSettingsKey, params?: Record<string, unknown>) => string

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function usageDocument(general: number): Record<string, unknown> {
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
    credits: { total: 7500, consumed: 0, available: general + 1111, workAvailable: 1777, generalAvailable: general, accounts: [] },
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
function stubRoute(): { calls: string[] } {
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
      : usageDocument(3392)
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

  it('renders nothing for the INTERNATIONAL provider, and fetches nothing', async () => {
    // Not a provider-scoping choice but a data one: the Host builds the `ai`
    // usage document from `payStatus` and never sets `credits` on it, because
    // that side is subscription-based. Rendering here would put the hardcoded
    // "Trae CN" label beside a dash. The switch being ON proves this is the
    // region rule deciding, not the switch.
    const { calls } = stubRoute()
    const { scope } = makeScope(true)
    const { container } = render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae-global' } })}
      />,
    )
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('owns exactly the ONE provider route that has a balance to show', () => {
    expect(TRAE_COMPOSER_PROVIDERS).toEqual({ 'trae': 'cn' })
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
    const realT = ((key: TraeSettingsKey, params?: Record<string, unknown>) => {
      const template = zh[key] ?? key
      return params === undefined
        ? template
        : template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''))
    }) as (key: TraeSettingsKey, params?: Record<string, unknown>) => string
    stubRoute()
    render(<ComposerPoints t={realT} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/3,392/)).toBeTruthy() })
    expect(screen.getByText(/3,392/).textContent).toBe('Trae CN · 3,392')
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
