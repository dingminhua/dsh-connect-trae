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
    accounts: [],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 0, available: general + 1111, workAvailable: 1777, generalAvailable: general, accounts: [] },
  }
}

function stubRoute(): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    calls.push(String(input))
    return new Response(JSON.stringify(usageDocument(3392)), { status: 200 })
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
function makeScope(enabled: boolean | undefined): {
  scope: unknown
  setEnabled: (next: boolean | undefined) => void
} {
  let value: Record<string, unknown> = enabled === undefined ? {} : { showPointsInMainUi: enabled }
  const listeners = new Set<() => void>()
  const scope = {
    getSnapshot: () => ({ status: 'ready', value, writable: true }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async () => true,
  }
  return {
    scope,
    setEnabled: (next: boolean | undefined) => {
      value = next === undefined ? {} : { showPointsInMainUi: next }
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

  it('renders and fetches international credits for the trae-global provider', async () => {
    const { calls } = stubRoute()
    const { scope } = makeScope(true)
    render(
      <ComposerPointsGate
        t={t}
        settingsScope={scope as never}
        useProjection={() => ({ lastUsed: { provider: 'trae-global' } })}
      />,
    )
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    expect(calls[0]).toBe(withTraeRegion(TRAE_USAGE_PATH, 'ai'))
  })

  it('owns exactly the two provider routes the host registers', () => {
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
    expect(screen.getByText(/composer\.workCredits/)).toBeTruthy()
    expect(screen.getByText(/composer\.generalCredits/)).toBeTruthy()
    expect(screen.getByText(/composer\.refresh/)).toBeTruthy()
    // The panel reports the ACCOUNT, not just a number: the row is a label and
    // a value, so the panel is where "whose credits are these" gets answered.
    expect(screen.getByText('LaoDing')).toBeTruthy()
    // The fixture carries workAvailable = 1,777; both buckets must be rendered
    // with their own figures, not collapsed into one.
    expect(screen.getByText('1,777')).toBeTruthy()
    expect(screen.getByText('3,392')).toBeTruthy()
  })
})