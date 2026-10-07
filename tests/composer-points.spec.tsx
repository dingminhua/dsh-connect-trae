// @vitest-environment jsdom
/**
 * The composer credit readout is provider-scoped: it exists so that two
 * connector plugins do not fight over one shared row. These cases pin the
 * scoping decision, which is the whole reason the component exists.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { ComposerPoints, TRAE_COMPOSER_PROVIDERS } from '../src/client/ComposerPoints.tsx'
import { ComposerPointsGate, selectedProviderOf } from '../src/client/ComposerPointsGate.tsx'
import { TRAE_USAGE_PATH, withTraeRegion } from '../src/status-paths.ts'
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
    credits: { total: 7500, consumed: 0, available: general + 1111, workAvailable: 0, generalAvailable: general, accounts: [] },
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

describe('ComposerPointsGate provider scoping', () => {
  it('renders nothing while ANOTHER provider is selected, and fetches nothing', () => {
    // The entire point: the shared composer row stays untouched for every
    // provider this plugin does not own.
    const { calls } = stubRoute()
    const { container } = render(
      <ComposerPointsGate t={t} useProjection={() => ({ lastUsed: { provider: 'workbuddy-global' } })} />,
    )
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('renders nothing when the projection has not landed yet', () => {
    const { calls } = stubRoute()
    const { container } = render(<ComposerPointsGate t={t} useProjection={() => undefined} />)
    expect(container.innerHTML).toBe('')
    expect(calls).toHaveLength(0)
  })

  it('renders and fetches CN credits for the trae provider', async () => {
    const { calls } = stubRoute()
    render(<ComposerPointsGate t={t} useProjection={() => ({ lastUsed: { provider: 'trae' } })} />)
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    expect(screen.getByText(/3,392/)).toBeTruthy()
    expect(calls[0]).toBe(withTraeRegion(TRAE_USAGE_PATH, 'cn'))
  })

  it('renders and fetches international credits for the trae-global provider', async () => {
    const { calls } = stubRoute()
    render(<ComposerPointsGate t={t} useProjection={() => ({ lastUsed: { provider: 'trae-global' } })} />)
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    expect(calls[0]).toBe(withTraeRegion(TRAE_USAGE_PATH, 'ai'))
  })

  it('owns exactly the two provider routes the host registers', () => {
    expect(TRAE_COMPOSER_PROVIDERS).toEqual({ 'trae': 'cn', 'trae-global': 'ai' })
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

  it('carries exactly one control: the refresh icon', async () => {
    // The composer row is shared, so the readout must stay a value plus a single
    // icon button — no label button, no second action.
    stubRoute()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
    const buttons = Array.from(container.querySelectorAll('button'))
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.getAttribute('aria-label')).toMatch(/composer\.refresh/)
  })
})