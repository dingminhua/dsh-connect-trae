// @vitest-environment jsdom
/**
 * The refresh-token countdown on the card.
 *
 * WHY THIS FILE EXISTS: the card has always told the user their access token
 * expires and that it renews automatically — which is true, and stays true,
 * right up until the REFRESH token lapses. At that moment automatic renewal
 * stops for good and the only recovery is signing in to Trae again. A user who
 * has read "auto-renewal" for months has no reason to expect that, and nothing
 * on the card warned them: the refresh expiry was parsed and stored by the Host
 * but never reached the browser at all.
 *
 * Three properties have to hold:
 *
 *  1. a HEALTHY refresh token adds no line — the card must not grow a
 *     permanent warning that users learn to ignore;
 *  2. an approaching one is shown BEFORE it lapses, in the warning tone, and
 *     names the deadline plus the days left;
 *  3. an already-lapsed one is shown as the error state, because at that point
 *     renewal really has stopped;
 *  4. an account with NO refresh expiry at all (a CLI token carries none) shows
 *     nothing rather than inventing a deadline.
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

function makeScope(initial: Record<string, unknown> = {}) {
  const value = structuredClone(initial)
  return {
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable: true }),
      subscribe: () => () => {},
      set: async () => true,
    },
  }
}

/** A CN document whose BOUND account carries the given refresh expiry. */
function usageDocument(refreshExpiresAtMs: number | undefined) {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'demo-user',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    ...refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs },
    region: 'cn',
    enabled: true,
    accounts: [{ id: 'account-1', accountName: 'demo-user', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, ...refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs }, selected: true }],
    models: [],
    enabledModelIds: [],
    credits: { total: 7500, consumed: 5_879.63, available: 1_620.37, workAvailable: 0, generalAvailable: 20.37, accounts: [] },
  }
}

function stubFetch(document: Record<string, unknown>): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith(TRAE_USAGE_PATH)) return new Response(JSON.stringify(document), { status: 200 })
    return new Response(JSON.stringify({ id: 'account-1' }), { status: 200 })
  })
}

async function renderOpen(scope: unknown): Promise<void> {
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  await waitFor(() => { expect(screen.getByRole('region', { name: 'row.accountsTitle' })).toBeTruthy() })
}

const DAY = 86_400_000

describe('refresh-token countdown on the card', () => {
  it('says nothing while the refresh token is far from lapsing', async () => {
    stubFetch(usageDocument(Date.now() + 200 * DAY))
    await renderOpen(makeScope().scope)
    expect(screen.queryByText(/row\.refreshTokenExpiring/)).toBeNull()
    expect(screen.queryByText(/row\.refreshTokenLapsed/)).toBeNull()
  })

  it('warns with the deadline and the days left once it is close', async () => {
    stubFetch(usageDocument(Date.now() + 10 * DAY))
    await renderOpen(makeScope().scope)
    const warning = screen.getByText(/row\.refreshTokenExpiring/)
    // Names both the deadline and how long is left, so the user can act on it.
    expect(warning.textContent).toContain('row.refreshTokenExpiring')
    expect(warning.textContent).toContain('expiresAt')
    expect(warning.textContent).toContain('days')
    // The warning tone, not the error tone: it has not lapsed yet.
    expect(warning.className).toContain('dsm-trae-refresh-warn-soon')
  })

  it('reports a lapsed refresh token as the error state', async () => {
    // The real failure this was written for: an expired credential whose access
    // token can no longer be renewed at all.
    stubFetch(usageDocument(Date.now() - 2 * DAY))
    await renderOpen(makeScope().scope)
    const warning = screen.getByText(/row\.refreshTokenLapsed/)
    expect(warning.className).toContain('dsm-trae-refresh-warn-lapsed')
    // It must be phrased as "renewal has stopped", not merely "expired": the
    // user needs to know the consequence, not just the date.
    expect(warning.textContent).toContain('row.refreshTokenLapsed')
  })

  it('invents no deadline when the credential carries no refresh expiry', async () => {
    // A CLI token has none. Rendering a fabricated date would be worse than
    // saying nothing, because the user would plan around it. The row still
    // renders (it is a real account) — only the countdown line is absent.
    stubFetch(usageDocument(undefined))
    await renderOpen(makeScope().scope)
    expect(screen.queryByText(/row\.refreshTokenExpiring/)).toBeNull()
    expect(screen.queryByText(/row\.refreshTokenLapsed/)).toBeNull()
    // The account itself is still listed, so "no line" is not "no account".
    expect(screen.getByText('demo-user')).toBeTruthy()
  })

  it('treats the boundary as "still running" on the last day', async () => {
    // One day left is inside the window, not lapsed: an off-by-one here would
    // tell a user their renewal had already stopped while it still worked.
    stubFetch(usageDocument(Date.now() + DAY / 2))
    await renderOpen(makeScope().scope)
    expect(screen.getByText(/row\.refreshTokenExpiring/)).toBeTruthy()
    expect(screen.queryByText(/row\.refreshTokenLapsed/)).toBeNull()
  })
})
