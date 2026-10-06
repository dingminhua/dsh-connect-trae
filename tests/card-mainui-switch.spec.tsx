// @vitest-environment jsdom
/**
 * The plugin card's global "show credits in the DSH sidebar" switch.
 *
 * The switch is one top-level boolean (default off); clicking it must persist
 * `showPointsInMainUi` through the settings scope and the read-back must show
 * the new value. The CN usage document used here mirrors a live signed-in
 * account so the card body renders.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_USAGE_PATH } from '../src/status-paths.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

function signedInDocument(): Record<string, unknown> {
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
    credits: { total: 7500, consumed: 5879.63, available: 1620.37, workAvailable: 0, generalAvailable: 1620.37, accounts: [] },
  }
}

function stubUsage(initial: Record<string, unknown>) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    if (String(input).startsWith(TRAE_USAGE_PATH)) {
      return new Response(JSON.stringify(signedInDocument()), { status: 200 })
    }
    throw new Error(`unexpected fetch: ${String(input)}`)
  })
  return {
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable: true }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        value = { ...value, [field]: structuredClone(next) }
        for (const listener of listeners) listener()
        return true
      },
    },
  }
}

async function renderOpen(scope: unknown): Promise<void> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  await waitFor(() => { expect(screen.getByText('row.showPointsInMainUi')).toBeTruthy() })
}

describe('TraeUsageCard sidebar-credit switch', () => {
  it('renders the switch unchecked by default and persists a turn-on write', async () => {
    const { scope } = stubUsage({})
    await renderOpen(scope)

    const checkbox = screen.getByLabelText('row.showPointsInMainUi') as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    await waitFor(() => { expect(checkbox.checked).toBe(true) })
    expect((scope.getSnapshot().value as { showPointsInMainUi?: boolean }).showPointsInMainUi).toBe(true)

    fireEvent.click(checkbox)
    await waitFor(() => { expect(checkbox.checked).toBe(false) })
    expect((scope.getSnapshot().value as { showPointsInMainUi?: boolean }).showPointsInMainUi).toBe(false)
  })

  it('reflects a config that already had the switch on', async () => {
    const { scope } = stubUsage({ showPointsInMainUi: true })
    await renderOpen(scope)
    expect((screen.getByLabelText('row.showPointsInMainUi') as HTMLInputElement).checked).toBe(true)
  })
})
