// @vitest-environment jsdom
/**
 * Issue #66, browser half.
 *
 * TWO properties, both about what the user is TOLD:
 *
 *  1. a signed-out panel that holds a US credential says so — the Host excludes
 *     that credential from billing, and without the notice the panel reads as
 *     "not signed in" on a machine the user knows is signed in (the re-login
 *     loop in the report);
 *  2. a failed route shows the SERVER's message, not `HTTP 401`. The card used
 *     to throw away the body, so the Host's explanation never reached the user
 *     and a wrong-gateway 401 was indistinguishable from a plugin crash.
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

function makeScope(): unknown {
  const value: Record<string, unknown> = {}
  return {
    getSnapshot: () => ({ status: 'ready', value, writable: true }),
    subscribe: () => () => {},
    set: async () => true,
  }
}

async function renderOpen(): Promise<void> {
  render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  await waitFor(() => { expect(screen.getByRole('region', { name: 'row.accountsTitle' })).toBeTruthy() })
}

describe('US region notice on the card (issue #66)', () => {
  it('names a US credential instead of claiming nobody is signed in', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith(TRAE_USAGE_PATH)) {
        return new Response(JSON.stringify({
          status: 'signed-out',
          accounts: [],
          enabled: true,
          unsupportedRegion: { region: 'us', accounts: ['US User'] },
        }), { status: 200 })
      }
      return new Response('{}', { status: 200 })
    })
    await renderOpen()
    expect(screen.getByText('row.unsupportedRegionTitle')).toBeTruthy()
    expect(screen.getByText('row.unsupportedRegionHint')).toBeTruthy()
    expect(screen.getByText('US User')).toBeTruthy()
  })

  it('shows the server error text of a failed status read, not a bare status code', async () => {
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = String(input)
      if (url.startsWith(TRAE_USAGE_PATH)) {
        return new Response(JSON.stringify({ error: 'SOLO remote models returned HTTP 401', code: 'authentication' }), { status: 401 })
      }
      return new Response('{}', { status: 200 })
    })
    await renderOpen()
    await waitFor(() => {
      expect(screen.getByText('SOLO remote models returned HTTP 401')).toBeTruthy()
    })
    expect(screen.queryByText('HTTP 401')).toBeNull()
  })
})
