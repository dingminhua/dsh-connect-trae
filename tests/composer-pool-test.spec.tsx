// @vitest-environment jsdom
/**
 * The pool test batch in the credit popover's header (m02091).
 *
 * The reported request: "设置左侧添加 刷新按钮，功能为测试玩家池账号". So the
 * button sits to the settings pill's LEFT and runs the account-pool TEST batch —
 * not a credits re-read, which is what the header's old refresh button did and
 * what nothing in this panel needs any more (the balance re-reads on open, on
 * every switch and every five minutes).
 *
 * Two things are being pinned, and they fail differently:
 *
 *  - The BUTTON's rules: it exists only when this panel has a pool, it drives the
 *    pool's `test` route, it reports what happened, and it never leaves the panel
 *    in a state where a press looks like it did nothing.
 *  - The FOLD: the route answers NDJSON with one `{row}` per account and then a
 *    `{rows}` summary repeating them. Getting that wrong is invisible in a single
 *    row and wrong by a factor of two in the summary line, so the counting is
 *    asserted directly.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComposerPoints } from '../src/client/ComposerPoints.tsx'
import { COMPOSER_POINTS_CSS } from '../src/client/styles.ts'
import { TRAE_POOL_PATH, withTraePoolAction } from '../src/status-paths.ts'
import { en, zh } from '../src/client/locales.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) => {
  if (params === undefined) return key
  return `${key}:${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')}`
}) as (key: TraeSettingsKey, params?: Record<string, unknown>) => string

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.querySelectorAll('.dsm-trae-composer-panel').forEach(node => { node.remove() })
})

/** The pool section the Host omits when the panel has no pool feature. */
function poolDocument(options: { accounts?: number; members?: number } = {}): Record<string, unknown> {
  const accounts = options.accounts ?? 2
  const members = options.members ?? accounts
  return {
    enabled: true,
    checkinSupported: true,
    targetModelId: 'deepseek-v4.1-flash',
    targetModelSource: 'preferred',
    probeInputTokens: 0,
    memberAccountIds: Array.from({ length: members }, (_, index) => `account-${index + 1}`),
    effectiveMemberAccountIds: Array.from({ length: members }, (_, index) => `account-${index + 1}`),
    memberNames: {},
    accounts: Array.from({ length: accounts }, (_, index) => ({
      accountId: `account-${index + 1}`,
      accountName: `Account ${index + 1}`,
      member: index < members,
      current: index === 0,
      reachable: true,
      generalAvailable: 100 + index,
    })),
  }
}

/**
 * Stub the three routes this panel can touch.
 *
 * `test` answers NDJSON by default, because that is what a current Host answers:
 * one `{row}` line per account, then a `{rows}` summary that repeats them. The
 * double-counting bug this file guards against only exists because of that
 * repetition, so the default fixture must reproduce it.
 */
function stubRoutes(options: {
  /** Omit the `pool` field entirely, as a Host without the feature does. */
  withoutPool?: boolean
  testLines?: string[]
  testStatus?: number
  onTest?: () => void
} = {}): { calls: string[] } {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    calls.push(`${init?.method ?? 'GET'} ${url}`)
    if (url.includes('/account-credits')) {
      return new Response(JSON.stringify({
        accounts: [
          { id: 'account-1', accountName: 'Account 1', selected: true, generalAvailable: 100 },
          { id: 'account-2', accountName: 'Account 2', selected: false, generalAvailable: 101 },
        ],
      }), { status: 200 })
    }
    if (url.startsWith(TRAE_POOL_PATH)) {
      options.onTest?.()
      const lines = options.testLines ?? [
        JSON.stringify({ row: { accountId: 'account-1', accountName: 'Account 1', modelId: 'deepseek-v4.1-flash', outcome: 'ok', detail: 'answered' } }),
        JSON.stringify({ row: { accountId: 'account-2', accountName: 'Account 2', modelId: 'deepseek-v4.1-flash', outcome: 'rate-limited', detail: 'slow down' } }),
        // The trailing summary repeats both rows. A fold that counts LINES
        // reports "4 of 2" here; the assertion below is what catches that.
        JSON.stringify({
          rows: [
            { accountId: 'account-1', accountName: 'Account 1', modelId: 'deepseek-v4.1-flash', outcome: 'ok', detail: 'answered' },
            { accountId: 'account-2', accountName: 'Account 2', modelId: 'deepseek-v4.1-flash', outcome: 'rate-limited', detail: 'slow down' },
          ],
        }),
      ]
      return new Response(lines.join('\n') + '\n', {
        status: options.testStatus ?? 200,
        headers: { 'content-type': 'application/x-ndjson' },
      })
    }
    const document: Record<string, unknown> = {
      status: 'signed-in',
      accountId: 'account-1',
      accountName: 'Account 1',
      tokenExpiresAtMs: Date.now() + 3_600_000,
      region: 'cn',
      accounts: [],
      models: [],
      enabledModelIds: [],
      credits: { total: 7500, consumed: 0, available: 4503, workAvailable: 0, generalAvailable: 100, accounts: [] },
    }
    if (options.withoutPool !== true) document['pool'] = poolDocument()
    return new Response(JSON.stringify(document), { status: 200 })
  })
  return { calls }
}

/** The test button, or null. */
const testButton = (): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>('button.dsm-trae-composer-panel-test')

const settingsButton = (): HTMLButtonElement | null =>
  document.body.querySelector<HTMLButtonElement>('button.dsm-trae-composer-panel-settings')

/** Open the popover and wait for the panel. */
async function openPanel(container: HTMLElement): Promise<void> {
  await waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
  fireEvent.click(container.querySelector('button.dsm-trae-composer-points-trigger') as HTMLButtonElement)
  await waitFor(() => { expect(document.querySelector('[role="dialog"]')).not.toBeNull() })
}

describe('the pool test button in the panel header', () => {
  it('is drawn when the panel has a pool, to the LEFT of the settings pill', async () => {
    stubRoutes()
    const { container } = render(
      <ComposerPoints t={t} provider="trae" region="cn" onOpenSettings={() => true} />,
    )
    await openPanel(container)

    const test = testButton()
    expect(test).not.toBeNull()
    expect(test?.textContent).toBe('composer.test')
    // POSITION IS THE REQUEST (m02091: "设置左侧"). Compared through the DOM
    // order of the shared wrapper, so a CSS-only reordering cannot satisfy it.
    const order = Array.from(
      document.querySelectorAll('.dsm-trae-composer-panel-actions button'),
    ).map(button => button.className)
    expect(order).toEqual(['dsm-trae-composer-panel-test', 'dsm-trae-composer-panel-settings'])
    // Both are in the same right-aligned wrapper, so they share one baseline.
    expect(test?.parentElement).toBe(settingsButton()?.parentElement)
  })

  it('is NOT drawn when the Host reports no pool for this panel', async () => {
    // `usage.pool` is absent on a Host that predates the feature, on an
    // unconfigured panel and on the enterprise tab. In every one of those the
    // route answers 503/409, so the button is not drawn at all.
    stubRoutes({ withoutPool: true })
    const { container } = render(
      <ComposerPoints t={t} provider="trae" region="cn" onOpenSettings={() => true} />,
    )
    await openPanel(container)

    expect(testButton()).toBeNull()
    // The settings pill is still there: the absence is about the pool, not the
    // whole header.
    expect(settingsButton()).not.toBeNull()
  })

  it('drives the pool TEST route for this panel, by POST', async () => {
    const { calls } = stubRoutes()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await openPanel(container)

    fireEvent.click(testButton() as HTMLButtonElement)
    await waitFor(() => { expect(calls.some(call => call.startsWith('POST '))).toBe(true) })
    // The exact address, built by the shared helper: the region is the panel's,
    // and the action is `test`. Hand-building this string is what a typo turns
    // into a request the route answers 400 to.
    expect(calls).toContain(`POST ${withTraePoolAction('cn', 'test')}`)
  })

  it('counts ACCOUNTS, not lines — the summary repeats what already streamed', async () => {
    // The failure this pins: the route writes `{row}` per account and then a
    // `{rows}` summary of the same accounts. Counting lines says "4 of 2".
    stubRoutes()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await openPanel(container)

    fireEvent.click(testButton() as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByText(/composer\.testDone/)).toBeTruthy() })
    expect(screen.getByText(/composer\.testDone/).textContent).toBe('composer.testDone:ok=1,total=2')
  })

  it('re-reads the usage document afterwards, because that is where the marks live', async () => {
    // The probes live in `usage.pool.accounts[].probe`, so without this read the
    // press would leave the table showing the state it just measured away.
    const { calls } = stubRoutes()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await openPanel(container)
    const before = calls.filter(call => call.startsWith('GET ') && call.includes('/usage')).length

    fireEvent.click(testButton() as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByText(/composer\.testDone/)).toBeTruthy() })
    await waitFor(() => {
      const after = calls.filter(call => call.startsWith('GET ') && call.includes('/usage')).length
      expect(after).toBeGreaterThan(before)
    })
  })

  it('re-reads the account-credits document too, because that is where the FIGURES are', async () => {
    // The sibling case above only proves the usage read happens, and that
    // document has no balance figures in it — the table's numbers come from
    // `/account-credits`. A press that skipped that read left the table showing
    // exactly the figures the batch had just made stale, which is the one thing
    // this button exists to prevent.
    const { calls } = stubRoutes()
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await openPanel(container)
    const before = calls.filter(call => call.startsWith('GET ') && call.includes('/account-credits')).length

    fireEvent.click(testButton() as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByText(/composer\.testDone/)).toBeTruthy() })
    await waitFor(() => {
      const after = calls.filter(call => call.startsWith('GET ') && call.includes('/account-credits')).length
      expect(after).toBeGreaterThan(before)
    })
  })

  it('says the batch was given up on when the DEADLINE aborts it', async () => {
    // An ABORT is the deadline, not a transport failure: "took too long, gave
    // up" is actionable where "failed" is not. Driven with fake timers because
    // the real deadline is three minutes and waiting it out is not a test.
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.startsWith(TRAE_POOL_PATH)) {
          // Never answer; settle only when the caller aborts, the way a real
          // fetch against a stalled Host does.
          return await new Promise((_resolve, reject) => {
            if (init?.signal?.aborted === true) {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
              return
            }
            init?.signal?.addEventListener('abort', () => {
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
            })
          })
        }
        return new Response(JSON.stringify({
          status: 'signed-in',
          accountId: 'account-1',
          accountName: 'Account 1',
          tokenExpiresAtMs: Date.now() + 3_600_000,
          region: 'cn',
          accounts: [],
          models: [],
          enabledModelIds: [],
          credits: { total: 1, consumed: 0, available: 1, workAvailable: 0, generalAvailable: 1, accounts: [] },
          pool: poolDocument(),
        }), { status: 200 })
      })
      const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
      await vi.waitFor(() => { expect(screen.getByText(/composer\.points/)).toBeTruthy() })
      fireEvent.click(container.querySelector('button.dsm-trae-composer-points-trigger') as HTMLButtonElement)
      await vi.waitFor(() => { expect(document.querySelector('[role="dialog"]')).not.toBeNull() })

      // The document has to land first: the button exists only once the
      // Host's `pool` section arrives, and the trigger renders before that.
      await vi.waitFor(() => { expect(testButton()).not.toBeNull() })
      fireEvent.click(testButton() as HTMLButtonElement)
      // Past POOL_TEST_TIMEOUT_MS (180s): the controller aborts, the promise
      // rejects with an AbortError, and the catch must pick the TIMED OUT line.
      await vi.advanceTimersByTimeAsync(180_001)
      await vi.waitFor(() => { expect(screen.getByText(/composer\.testTimedOut/)).toBeTruthy() })
      expect(screen.queryByText(/composer\.testFailed/)).toBeNull()
      // And the button is usable again: a deadline that leaves the control
      // disabled forever reads as a hung panel.
      await vi.waitFor(() => { expect((testButton() as HTMLButtonElement).disabled).toBe(false) })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a route refusal in its OWN line, not the read failure', async () => {
    // Three different failures share this footer's visual slot. Each keeps its
    // own state, or one press would erase another's explanation.
    stubRoutes({
      testLines: [JSON.stringify({ reason: 'pool-failed', error: 'no accounts are checked into this pool' })],
    })
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await openPanel(container)

    fireEvent.click(testButton() as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByText(/no accounts are checked into this pool/)).toBeTruthy() })
    // The generic copy is NOT shown: the Host named the reason.
    expect(screen.queryByText(/composer\.testFailed/)).toBeNull()
    expect(screen.queryByText(/composer\.refreshFailed/)).toBeNull()
  })

  it('does not claim success on a 200 that parsed into nothing', async () => {
    // A `200` with an unparseable body reads as "all fine" if `sawAny` is not
    // checked — the one way a broken Host could look healthier than a healthy one.
    stubRoutes({ testLines: ['not json at all'] })
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await openPanel(container)

    fireEvent.click(testButton() as HTMLButtonElement)
    await waitFor(() => { expect(screen.getByText(/composer\.testFailed/)).toBeTruthy() })
    expect(screen.queryByText(/composer\.testDone/)).toBeNull()
  })

  it('cannot be pressed twice into two concurrent batches', async () => {
    // The batch is serial and spends credits per account; two overlapping runs
    // would interleave their rows into one table.
    let runs = 0
    stubRoutes({ onTest: () => { runs += 1 } })
    const { container } = render(<ComposerPoints t={t} provider="trae" region="cn" />)
    await openPanel(container)

    const button = testButton() as HTMLButtonElement
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => { expect(screen.getByText(/composer\.testDone/)).toBeTruthy() })
    expect(runs).toBe(1)
  })
})

describe('the test button is the header\'s GHOST control, not a second pill', () => {
  it('has no border and no fill at rest, and gains its fill only on hover', () => {
    // The reference (m02477) shows a bare circular arrow and 「刷新」 with no
    // outline and no tint, beside a settings pill that carries both. The two
    // controls are different kinds of thing: one navigates, one re-runs a batch
    // in place — so they must not share a resting shape.
    //
    // What the first version got wrong: a 1px outline at rest read as the card's
    // dsm-btn-outline (a save/cancel control), and two bordered shapes in a
    // 248px header read as one segmented control.
    const rule = /\.dsm-trae-composer-panel-test\{([^}]*)\}/.exec(COMPOSER_POINTS_CSS)?.[1]
    expect(rule).toBeDefined()
    expect(rule).toContain('border-radius:999px')
    expect(rule).toContain('font-size:11px')
    expect(rule).toContain('cursor:pointer')
    // Ghost: the border is transparent (kept for layout stability, so the hover
    // state does not change the box size) and the fill is none.
    expect(rule).toContain('border:1px solid transparent')
    expect(rule).toContain('background:transparent')
    // Not the brand tint: that fill is what marks the settings pill primary.
    expect(rule).not.toContain('rgba(86,134,254')
    // Icon plus word, laid out in a row — the same shape the settings pill uses.
    expect(rule).toContain('display:inline-flex')
    expect(rule).toContain('gap:4px')
  })

  it('does not tint its hover either, so it never competes for the brand colour', () => {
    const hover = /\.dsm-trae-composer-panel-test:hover:not\(:disabled\)\{([^}]*)\}/.exec(COMPOSER_POINTS_CSS)?.[1]
    expect(hover).toBeDefined()
    expect(hover).toContain('interactive-bg-hover')
    expect(hover).not.toContain('rgba(86,134,254')
  })

  it('carries hover, active, focus and disabled states', () => {
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-test:hover:not(:disabled){')
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-test:active{')
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-test:focus-visible{')
    expect(COMPOSER_POINTS_CSS).toContain('.dsm-trae-composer-panel-test:disabled{')
  })

  it('pins the icon and the label so neither shrinks into an oval', () => {
    // flex:none on both: a flex item defaults to shrinking, and at 11px a
    // squashed 12px arrow renders as a smudge — the trap the gear documents.
    const icon = /\.dsm-trae-composer-panel-test-icon\{([^}]*)\}/.exec(COMPOSER_POINTS_CSS)?.[1]
    const label = /\.dsm-trae-composer-panel-test-label\{([^}]*)\}/.exec(COMPOSER_POINTS_CSS)?.[1]
    expect(icon).toContain('flex:none')
    expect(label).toContain('flex:none')
    expect(label).toContain('white-space:nowrap')
  })

  it('keeps the panel wide enough for title + two icon-and-word controls', () => {
    // Measured in a browser, not guessed: with the panel at 248px the header's
    // content box is 222px, and the English title "Trae credits" plus "Refresh"
    // plus "Settings" needs 233px — the settings pill overflowed its own header
    // by 11px. 264px gives the row 238px, which fits with 5px to spare in the
    // tighter of the two locales.
    //
    // The alternative fixes are worse: renaming the owner's words («刷新» /
    // "Refresh" are what was asked for), or dropping the icons, which is what
    // makes the two controls read as one family.
    //
    // jsdom does no layout, so this pins the DECLARATION and the reason lives
    // here. If a future change adds a third control, this number is the thing
    // that has to move, and the comment says how it was derived.
    const rule = /\.dsm-trae-composer-panel\{([^}]*)\}/.exec(COMPOSER_POINTS_CSS)?.[1]
    expect(rule).toBeDefined()
    expect(rule).toContain('width:min(264px,calc(100vw - 24px))')
  })

  it('gives the outcome NOTE a quieter rule than the error line', () => {
    // "2 of 3 answered" is a report, not a failure. Rendering it in the error
    // colour would make a healthy batch look broken.
    const note = /\.dsm-trae-composer-panel-note\{([^}]*)\}/.exec(COMPOSER_POINTS_CSS)?.[1]
    expect(note).toBeDefined()
    expect(note).toContain('label-secondary')
    expect(note).not.toContain('state-error')
  })
})

describe('the new copy exists in both dictionaries', () => {
  it('labels the button with the owner\'s word and puts the SCOPE in the tooltip', () => {
    // "Refresh" / 「刷新」 is the requested label. It is also a label that
    // under-describes what the press does — it tests the pool's members and
    // SPENDS CREDITS doing it (one minimal ping each) — so the tooltip and the
    // outcome line have to carry what the label no longer can.
    expect(zh['composer.test']).toBe('刷新')
    expect(en['composer.test']).toBe('Refresh')
    expect(zh['composer.testHint']).toMatch(/勾选/)
    expect(en['composer.testHint']).toMatch(/checked into/)
    // Long labels do not wrap in this header; they push the settings pill out.
    // "Refresh" fits (measured), so this bound guards against someone later
    // writing "Refresh pool" here.
    expect(en['composer.test'].length).toBeLessThanOrEqual(8)
    expect(zh['composer.test'].length).toBeLessThanOrEqual(3)
  })

  it('keeps the outcome line explicit about the POOL, which the label no longer can', () => {
    // The label got short, so the report is where "this was the account pool"
    // has to be unmistakable.
    expect(zh['composer.testDone']).toContain('账号池')
    expect(en['composer.testDone']).toContain('Pool')
  })

  it('has a distinct line for every ending: done, failed, timed out', () => {
    for (const key of ['composer.testDone', 'composer.testFailed', 'composer.testTimedOut'] as const) {
      expect(zh[key].length).toBeGreaterThan(0)
      expect(en[key].length).toBeGreaterThan(0)
      expect(zh[key]).not.toBe(en[key])
    }
    // The done line carries both counts, so "1 of 2 answered" is sayable.
    expect(zh['composer.testDone']).toContain('{ok}')
    expect(zh['composer.testDone']).toContain('{total}')
  })
})
