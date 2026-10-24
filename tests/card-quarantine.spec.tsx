// @vitest-environment jsdom
/**
 * The QUARANTINE NOTICE: a credential copy that was found unreadable and kept
 * aside instead of being erased.
 *
 * Why this needs its own file — the notice answers a question the rest of the
 * card cannot: "where did the account I remember go?". Issue #56 is that
 * question, and the answer was invisible: the plugin had kept the bytes, but
 * the only way to learn that was to browse DSH's home directory and recognise
 * a `.corrupt-` file name.
 *
 * What these tests pin, and why each line matters:
 *
 *   DIAG       The diagnostics panel names the quarantined copy. That panel
 *              exists to be quoted into a bug report, so a lost account has to
 *              be quotable with it.
 *   SIGNED OUT The signed-out screen shows it too. This is the state a user
 *              lands in AFTER an account went missing — the diagnostics panel
 *              is unreachable there (a signed-out card renders no section
 *              strip), so a notice that lived only in that panel would never
 *              be seen by exactly the user who needs it.
 *   COUNT      The account count is printed when the copy can still be read
 *              as JSON, and OMITTED when it cannot — a torn copy has no
 *              countable rows, and a wrong count is worse than none.
 *   SILENT     A healthy machine shows nothing: no notice, no empty box.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

/** A stand-in settings scope over one mutable document. */
function makeScope(initial: Record<string, unknown> = {}) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ status: 'ready', value, writable: true }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: async (field: string, next: unknown) => {
      value = { ...value, [field]: structuredClone(next) }
      for (const listener of listeners) listener()
      return true
    },
  }
}

/** A signed-in CN document, trimmed to what these tests read. */
function usageOf(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'cn',
    enabled: true,
    accounts: [
      { id: 'account-1', accountName: 'LaoDing', edition: 'cn', region: 'cn', source: 'desktop', tokenExpiresAtMs: Date.now() + 3_600_000, selected: true },
    ],
    models: [{ id: 'glm-5.2', name: 'GLM 5.2', contextWindow: 200_000 }],
    enabledModelIds: ['glm-5.2'],
    ...overrides,
  }
}

/** Serve the usage route (and the per-account status route) from one stub. */
function stubFetch(document: Record<string, unknown>): void {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('account-status')) {
      return new Response(JSON.stringify({ id: 'account-1', checkin: { checkedIn: false, didCheckedIn: false, credits: 150, enabled: true } }), { status: 200 })
    }
    if (url.includes('/usage')) return new Response(JSON.stringify(document), { status: 200 })
    return new Response('{}', { status: 200 })
  }))
}

/** A panel by its id, matched by class plus id (see the sibling panel spec). */
function panel(id: 'accounts' | 'models' | 'diag'): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>('.dsm-trae-panel'))
    .find(element => element.id === `dsm-trae-panel-${id}`)
  if (found === undefined) throw new Error(`no panel dsm-trae-panel-${id}`)
  return found
}

function tab(id: 'accounts' | 'models' | 'diag'): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>('.dsm-trae-panels [role="tab"]'))
    .find(element => element.id === `dsm-trae-tab-${id}`)
  if (found === undefined) throw new Error(`no tab dsm-trae-tab-${id}`)
  return found
}

const QUARANTINE = {
  file: '/home/u/.dsh/.trae-auth.cn.json',
  quarantinedAs: '/home/u/.dsh/.trae-auth.cn.json.corrupt-2026-10-24T06-12-33-456Z',
  bytes: 2048,
  accounts: 2,
}

describe('the quarantine notice', () => {
  it('names the quarantined copy in the diagnostics panel', async () => {
    stubFetch(usageOf({ quarantined: [QUARANTINE] }))
    render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await screen.findByRole('tab', { name: 'row.panelAccounts' })
    fireEvent.click(tab('diag'))

    const text = panel('diag').textContent ?? ''
    expect(text).toContain('row.diagQuarantine')
    expect(text).toContain(QUARANTINE.quarantinedAs)
  })

  it('says "none" when nothing was quarantined', async () => {
    stubFetch(usageOf())
    render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await screen.findByRole('tab', { name: 'row.panelAccounts' })
    fireEvent.click(tab('diag'))

    const text = panel('diag').textContent ?? ''
    expect(text).toContain('row.diagQuarantineNone')
  })

  it('shows the notice on the signed-out screen, where a lost account lands', async () => {
    // The diagnostics panel is unreachable while signed out (that card renders
    // no section strip), so a notice that lived only there would never reach
    // the user who just lost an account.
    stubFetch({ status: 'signed-out', accounts: [], message: 'row.signedOutHint', searched: [], quarantined: [QUARANTINE] })
    render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await waitFor(() => { expect(screen.getByText('row.signedOutHint')).toBeTruthy() })

    const notice = document.querySelector('.dsm-trae-quarantine')
    expect(notice?.textContent ?? '').toContain('row.quarantineTitle')
    expect(notice?.textContent ?? '').toContain(QUARANTINE.quarantinedAs)
    // The count is printed when the copy can still be read as JSON…
    expect(notice?.textContent ?? '').toContain('row.quarantineAccounts:{"count":2}')
  })

  it('omits the account count for a copy that cannot be counted', async () => {
    // A torn copy has no countable rows. The notice then says the count is
    // unreadable instead of printing a zero, which would read as "no accounts
    // were lost" — the opposite of the truth.
    stubFetch({
      status: 'signed-out',
      accounts: [],
      message: 'row.signedOutHint',
      searched: [],
      quarantined: [{ file: QUARANTINE.file, quarantinedAs: QUARANTINE.quarantinedAs, bytes: 41 }],
    })
    render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await waitFor(() => { expect(screen.getByText('row.signedOutHint')).toBeTruthy() })

    const notice = document.querySelector('.dsm-trae-quarantine')
    expect(notice?.textContent ?? '').toContain('row.quarantineAccountsUnknown')
    expect(notice?.textContent ?? '').not.toContain('row.quarantineAccounts:')
  })

  it('stays silent on a healthy machine', async () => {
    stubFetch({ status: 'signed-out', accounts: [], message: 'row.signedOutHint', searched: [] })
    render(<TraeUsageCard t={t} settingsScope={makeScope() as never} />)
    fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
    await waitFor(() => { expect(screen.getByText('row.signedOutHint')).toBeTruthy() })

    expect(document.querySelector('.dsm-trae-quarantine')).toBeNull()
    expect(document.body.textContent ?? '').not.toContain('row.quarantineTitle')
  })
})
