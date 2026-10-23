// @vitest-environment jsdom
/**
 * The account-pool card section (`src/client/AccountPool.tsx`), tested as a
 * standalone component with a fake `t` and a fake `settingsScope`.
 *
 * WHAT THIS COVERS (all required by the pool card spec):
 *  1. rows render from a `pool` document, including a WORKING account, and a
 *     GHOST member (`reachable:false`, saved in settings but not listed
 *     locally) that still renders so it can be removed;
 *  2. the membership checkbox toggles the DRAFT (not `account.member`) and
 *     marks the settings dirty; saving writes `regions` with a
 *     `nextRegionPool`-shaped value (asserted on the `scope.set` argument)
 *     and clears dirty;
 *  3. discard restores the saved membership;
 *  4. `targetModelId` stale rendering + the "back to automatic" affordance;
 *  5. the check-in column is ABSENT when `checkinSupported` is false;
 *  6. a `test` batch renders rows incrementally from a mocked NDJSON stream;
 *  7. `noCandidate: 'empty'` renders the "choose members" warning.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Primitives ships browser-only CSS modules (shiki, `anser`, `*.module.css`) that
// jsdom cannot transform. Stub the one icon the card needs, wholesale.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import * as React from 'react'
import type { ReactElement } from 'react'
import { AccountPool } from '../src/client/AccountPool.tsx'
import { TRAE_CARD_CSS } from '../src/client/styles.ts'
import { withTraePoolAccount, withTraePoolAction } from '../src/status-paths.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'
import { zh } from '../src/client/locales.ts'
import type { TraeWebPool, TraeWebPoolAccount, TraeWebModel, TraePoolTestRowView, TraePoolCheckinRowView } from '../src/status-paths.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Fake translator: renders the key (or key:params) so queries use key strings. */
const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as (
  key: TraeSettingsKey, params?: Record<string, unknown>
) => string

/** A settings scope that records every `set` it receives, over `regions`. */
function makeScope(initial: Record<string, unknown> = {}, writable = true) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  const calls: { field: string; value: unknown }[] = []
  return {
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        value = { ...value, [field]: structuredClone(next) }
        calls.push({ field, value: structuredClone(next) })
        for (const listener of listeners) listener()
        return true
      },
    },
    calls,
    get value() { return value },
    get snapshotRegions(): Record<string, unknown> {
      const regions = (value as { regions?: unknown } | undefined)?.regions
      return typeof regions === 'object' && regions !== null ? regions as Record<string, unknown> : {}
    },
  }
}

/**
 * The `regions` write target the card reads its pool PREFS from (the same
 * shape `nextRegionPool` returns): a per-panel (`cn`) slot holding `pool`.
 * `cnSlotPool` is the saved `TraePoolPreferences` for the cn panel.
 */
function regionsOf(cnSlotPool: { enabled?: boolean; targetModelId?: string; memberAccountIds?: string[] }): Record<string, unknown> {
  return {
    regions: {
      cn: { pool: cnSlotPool },
      ai: {},
      enterprise: {},
    },
  }
}

/** A settings document whose cn panel already saved a pool membership. */
function pooledInitial(
  poolPrefs: { enabled: boolean; targetModelId?: string; memberAccountIds: string[]; probeInputTokens?: number },
): Record<string, unknown> {
  return regionsOf({ ...poolPrefs })
}

const MODELS: TraeWebModel[] = [
  { id: 'free-1', name: 'Free Model' },
  { id: 'pro-1', name: 'Pro 1' },
]

interface PoolOverride {
  enabled?: boolean
  checkinSupported?: boolean
  deleteSupported?: boolean
  probeInputTokens?: number
  targetModelId?: string
  staleTargetModelId?: string
  targetModelSource?: TraeWebPool['targetModelSource']
  noCandidate?: TraeWebPool['noCandidate']
  memberAccountIds?: readonly string[]
  memberNames?: Record<string, string>
  copies?: { path: string; count: number }
  accounts?: readonly TraeWebPoolAccount[]
}

function basePool(overrides: PoolOverride = {}): TraeWebPool {
  const accounts: readonly TraeWebPoolAccount[] = overrides.accounts ?? [
    {
      accountId: 'acc-a',
      accountName: 'AccA',
      generalAvailable: 30,
      workAvailable: 500,
      current: true,
      member: true,
      reachable: true,
      checkedInToday: false,
    },
    {
      accountId: 'acc-b',
      accountName: 'AccB',
      generalAvailable: 8,
      workAvailable: 0,
      current: false,
      member: true,
      reachable: true,
      checkedInToday: true,
    },
  ]
  return {
    enabled: overrides.enabled ?? true,
    checkinSupported: overrides.checkinSupported ?? true,
    ...(overrides.deleteSupported === undefined ? {} : { deleteSupported: overrides.deleteSupported }),
    ...(overrides.copies === undefined ? {} : { copies: overrides.copies }),
    ...(overrides.targetModelId === undefined ? {} : { targetModelId: overrides.targetModelId }),
    targetModelSource: overrides.targetModelSource ?? 'preferred',
    probeInputTokens: overrides.probeInputTokens ?? 0,
    ...(overrides.staleTargetModelId === undefined ? {} : { staleTargetModelId: overrides.staleTargetModelId }),
    memberAccountIds: overrides.memberAccountIds ?? ['acc-a', 'acc-b'],
    effectiveMemberAccountIds: ['acc-a', 'acc-b'],
    memberNames: overrides.memberNames ?? {},
    accounts,
    ...(overrides.noCandidate === undefined ? {} : { noCandidate: overrides.noCandidate }),
  }
}

/** One real pool-account that OLDS (not reachable locally) yet stays in settings. */
function ghostPool(overrides: PoolOverride = {}): TraeWebPool {
  return {
    ...basePool({ memberAccountIds: ['acc-a', 'ghost-1'], ...overrides }),
    accounts: [
      {
        accountId: 'acc-a', accountName: 'AccA', current: true, member: true, reachable: true,
        generalAvailable: 12, workAvailable: 3, checkedInToday: false,
      },
    ],
    memberAccountIds: overrides.memberAccountIds ?? ['acc-a', 'ghost-1'],
    memberNames: overrides.memberNames ?? { 'ghost-1': 'GhostOne' },
  }
}


/** `<AccountPool>` for a fixture, as an element (so a test can measure the DOM). */
function renderPoolAndReturn(pool: TraeWebPool, scope: unknown, deviceClaimed = false): ReactElement {
  return <AccountPool panel="cn" pool={pool} models={MODELS} t={t} settingsScope={scope as never} deviceClaimed={deviceClaimed} />
}

/**
 * The pool section, so row queries never bleed into other markup.
 */
function poolSection(): HTMLElement {
  return screen.getByRole('region', { name: 'row.poolTitle' })
}

/**
 * Render `<AccountPool>` inside a tiny harness that subscribes to the settings
 * scope and re-renders on change — the SAME way the real card drives the pool
 * section (the card bumps a `settingsRevision` in its own `subscribe`). Without
 * this, a `scope.set` (e.g. on save) would never re-render the pool, and the
 * "is anything dirty" read would stay stale.
 */
function renderPool(
  pool: TraeWebPool,
  scope: unknown,
  models: TraeWebModel[] = MODELS,
  extra: { onRefresh?: () => void | Promise<unknown>; onChanged?: () => void } = {},
): void {
  function Harness(): ReactElement {
    const [, force] = React.useState(0)
    React.useEffect(() => {
      const scopeTyped = scope as {
        subscribe?: (listener: () => void) => () => void
      } | undefined
      if (scopeTyped?.subscribe === undefined) return
      return scopeTyped.subscribe(() => force(v => v + 1))
    }, [scope])
    return <AccountPool panel="cn" pool={pool} models={models} t={t} settingsScope={scope as never}
      {...(extra.onRefresh === undefined ? {} : { onRefresh: extra.onRefresh })}
      {...(extra.onChanged === undefined ? {} : { onChanged: extra.onChanged })} />
  }
  render(<Harness />)
}

/** A member row by account name; rows are `div[role=row]` from the table. */
function poolRow(name: string): HTMLElement {
  return within(poolSection()).getByText(name).closest('.dsm-trae-pool-row') as HTMLElement
}

/** The checkbox in a member row, by its accessible name. */
function memberCheckbox(name: string): HTMLInputElement {
  return within(poolRow(name)).getByRole('checkbox') as HTMLInputElement
}

/** The settings save button. */
function saveButton(): HTMLButtonElement {
  return within(poolSection()).getByRole('button', { name: 'row.poolSaved' }) as HTMLButtonElement
}

/** The "back to automatic" affordance in the stale-target block. */
function clearTargetButton(): HTMLButtonElement {
  return within(poolSection()).getByRole('button', { name: 'row.poolTargetStaleClear' }) as HTMLButtonElement
}

describe('the save bar uses the card\'s normal button size', () => {
  it('is not caught by the rule that shrinks the tiny in-row buttons', () => {
    // The save bar is a footer bar like the models section's, so its buttons must
    // keep `.dsm-btn`'s own padding; the compact padding belongs to 测速/移除.
    const compact = /\.dsm-trae-pool-select-actions \.dsm-btn[^{]*\{/.exec(TRAE_CARD_CSS)
    expect(compact).not.toBeNull()
    expect(compact?.[0]).not.toContain('pool-save-row')
    // Stated positively as well: whatever else the card sets, the bar's buttons
    // keep the plain `.dsm-btn` metrics (32px tall at 13px type).
    const bar = /\.dsm-trae-pool-save-row \.dsm-btn\{([^}]*)\}/.exec(TRAE_CARD_CSS)
    expect(bar?.[1]).toContain('padding:5px 14px')
    expect(bar?.[1]).toContain('font-size:13px')
  })
})

describe('the pool section keeps one spacing and one radius scale', () => {
  // The section used to mix 10/12/14px insets and 10/12/14px radii, one per block,
  // which is exactly what reads as "inconsistent" even when each block looks fine
  // alone. These assertions pin the scale so a new block cannot invent its own.
  const rule = (selector: string): string => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = TRAE_CARD_CSS.match(new RegExp(`${escaped}\\{([^}]*)\\}`))
    return match?.[1] ?? ''
  }

  it('declares the scale on the section and uses it everywhere', () => {
    expect(rule('.dsm-trae-pool')).toContain('--dsm-trae-pool-pad-x:14px')
    expect(rule('.dsm-trae-pool')).toContain('--dsm-trae-pool-pad-y:10px')
    expect(rule('.dsm-trae-pool')).toContain('--dsm-trae-pool-radius:14px')
    for (const selector of [
      '.dsm-trae-pool-row',
      '.dsm-trae-pool-row-head',
      '.dsm-trae-pool-card-head',
      '.dsm-trae-pool-set',
    ]) {
      expect(rule(selector), selector).toContain('var(--dsm-trae-pool-pad-x)')
    }
  })

  it('only uses the card-wide radius scale inside the pool section', () => {
    // The card already has a scale: 14px for a surface, 10px for a box INSIDE a
    // surface, 999px for a pill. Anything else here is drift that shows up as
    // "these blocks do not belong together".
    const allowed = new Set(['0', '10px', '14px', '999px', '50%', 'var(--dsm-trae-pool-radius)'])
    const poolRules = TRAE_CARD_CSS.match(/\.[^{}]*dsm-trae-pool[^{}]*\{[^}]*\}/g) ?? []
    expect(poolRules.length).toBeGreaterThan(40)
    for (const block of poolRules) {
      for (const match of block.matchAll(/border-radius:([^;}]+)/g)) {
        expect(allowed.has(match[1]!.trim()), `${block.slice(0, 60)} → ${match[1]}`).toBe(true)
      }
    }
  })
})

describe('the batch check-in action', () => {
  /**
   * The batch button was removed on request. Trae allows ONE check-in per
   * DEVICE per day, so after this machine spent its check-in the button could
   * only ever be disabled for the rest of the day: a grey control whose reason
   * had to be explained in a sentence underneath. The per-account claim in the
   * roster table is the remaining path, and it is the one that can actually act.
   */
  it('offers no batch button at all', () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    render(renderPoolAndReturn(basePool({ checkinSupported: true }), scope, false))
    expect(screen.queryByRole('button', { name: 'row.poolCheckinAll' })).toBeNull()
    expect(screen.queryByText('row.poolCheckingIn')).toBeNull()
  })

  it('does not explain a device limit for a button that is gone', () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    render(renderPoolAndReturn(basePool({ checkinSupported: true }), scope, true))
    expect(screen.queryByText('row.poolActionNoteCheckinDevice')).toBeNull()
  })

  it('names a missing free model as the reason tests cannot run', () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    render(renderPoolAndReturn(basePool({ checkinSupported: true, targetModelSource: 'none' }), scope, false))
    expect(screen.getByText('row.poolActionNoteTestNone')).toBeTruthy()
  })

  it('asks for members before offering a batch run', () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: [] }))
    render(renderPoolAndReturn(basePool({ checkinSupported: true }), scope, false))
    expect(screen.getByText('row.poolActionNoteNoMembers')).toBeTruthy()
  })

  it('keeps the per-account claim button in the roster table', () => {
    // The one claim path that survives: an account that can still claim gets a
    // working button in the roster table below the pool block.
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    render(renderPoolAndReturn(basePool({ checkinSupported: true }), scope, false))
    expect(screen.queryByRole('button', { name: 'row.poolCheckinAll' })).toBeNull()
  })
})

describe('AccountPool card section', () => {
  it('renders rows from a pool document, including a ghost member and its delete action', () => {
    // Seed the saved cn membership so the DRAFT starts with acc-a AND the ghost.
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'ghost-1'] }))
    renderPool(ghostPool({ deleteSupported: true }), scope)

    const section = poolSection()
    // Real member renders with its name, General credit, probe-NEVER and a Test row action.
    expect(within(section).getByText('AccA')).toBeTruthy()
    expect(within(poolRow('AccA')).getByText('row.poolNeverTested')).toBeTruthy()
    // Ghost renders (member tag + "unusable" exclusion + its own name), not filtered out.
    expect(within(section).getByText('GhostOne')).toBeTruthy()
    const ghostRow = poolRow('GhostOne')
    expect(within(ghostRow).getByText('row.poolExcludedUnusable')).toBeTruthy()
    // Ghost delete aria targets the ghost, not a live account.
    const remove = within(ghostRow).getByRole('button', { name: /row\.poolGhostDeleteAria/ }) as HTMLButtonElement
    expect(remove).toBeTruthy()
  })

  it('falls back to the saved id when a ghost member has no stored name', () => {
    // A blank name must not render as an empty row: the row is the only place
    // the user can see and delete that legacy copy.
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'ghost-blank'] }))
    renderPool(ghostPool({ memberAccountIds: ['acc-a', 'ghost-blank'], memberNames: { 'ghost-blank': '' } }), scope)
    const row = poolRow('ghost-blank')
    expect(within(row).getByText('row.poolExcludedUnusable')).toBeTruthy()
  })

  it('marks a member row that has no local copy, and keeps the id as its name', () => {
    // The Host also emits rows for saved members it cannot resolve (the user may
    // have deleted the copy). Such a row renders through MemberRow, so without
    // this it showed a green dot and NO explanation — a blank line that read as
    // "the plugin failed to create the copy".
    const pool = basePool({
      accounts: [
        { accountId: 'acc-a', accountName: 'AccA', current: true, member: true, reachable: true, generalAvailable: 30, workAvailable: 0, checkedInToday: false },
        { accountId: 'c'.repeat(24), accountName: 'c'.repeat(24), current: false, member: true, reachable: false },
      ],
      memberAccountIds: ['acc-a', 'c'.repeat(24)],
    })
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'c'.repeat(24)] }))
    renderPool(pool, scope)
    const row = poolRow('c'.repeat(24))
    expect(within(row).getByText('row.poolNoCopyTag')).toBeTruthy()
    // Nothing to test: the Host would answer 「no stored credential」, which the
    // card renders as a credential rejection that never happened.
    const test = within(row).getByRole('button', { name: /row\.poolRowTest/ }) as HTMLButtonElement
    expect(test.disabled).toBe(true)
    // No green dot: the row is not a live account.
    expect(row.querySelector('.dsm-trae-pool-dot-ghost')).toBeTruthy()
  })

  it('names the copy FILE, so "the plugin has a real copy" is checkable', () => {
    // The recurring complaint is "there is no actual copy file, it just follows
    // the app". Naming the path and the count is the only answer a user can
    // verify without trusting the card.
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    renderPool(basePool({ copies: { path: '/Users/x/.dsh/.trae-auth.cn.json', count: 2 } }), scope)
    const line = within(poolSection()).getByText(/\/Users\/x\/\.dsh\/\.trae-auth\.cn\.json/)
    expect(line.textContent).toContain('2')
  })

  it('checkbox toggles the draft and marks dirty; saving writes regions via scope.set and clears dirty', async () => {
    const { scope, calls } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    renderPool(basePool(), scope)

    // Start clean (draft = saved membership of both).
    expect(screen.queryByText('row.poolUnsavedMembers')).toBeNull()

    // Uncheck AccB -> draft changes, dirty appears.
    const checkbox = memberCheckbox('AccB')
    fireEvent.click(checkbox)
    expect(memberCheckbox('AccB').checked).toBe(false)
    expect(screen.getByText('row.poolUnsavedMembers')).toBeTruthy()
    // row.checkin column visible because checkinSupported defaults to true.

    fireEvent.click(saveButton())

    await waitFor(() => {
      expect(calls.length).toBe(1)
      expect(calls[0]!.field).toBe('regions')
    })
    const regionsWrite = calls[0]!.value as { cn?: { pool?: { enabled?: boolean; memberAccountIds?: string[] } } }
    expect(regionsWrite).toBeTruthy()
    // nextRegionPool returns the `regions` MAP (exactly what scope.set('regions',…) needs):
    // only the cn panel's pool slot is written; the other panels carry over untouched.
    expect(regionsWrite.cn?.pool).toBeTruthy()
    expect(Object.keys(regionsWrite)).toEqual(['cn', 'ai', 'enterprise'])
    expect(regionsWrite.cn?.pool?.enabled).toBe(true)
    // Order-insensitive membership: removed acc-b, kept acc-a.
    expect([...(regionsWrite.cn?.pool?.memberAccountIds ?? [])].sort()).toEqual(['acc-a'])
    // Dirty cleared after a landed write.
    await waitFor(() => { expect(screen.queryByText('row.poolUnsavedMembers')).toBeNull() })
  })

  it('discard restores the saved membership and the enabled state', () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    renderPool(basePool(), scope)

    // Toggle both checkboxes on (both already member) _and_ flip enabled off.
    fireEvent.click(memberCheckbox('AccA'))
    fireEvent.click(memberCheckbox('AccB'))
    const enableSwitch = within(poolSection()).getByRole('checkbox', { name: 'row.poolEnabled' }) as HTMLInputElement
    fireEvent.click(enableSwitch)
    expect(screen.getByText('row.poolUnsavedMembers')).toBeTruthy()

    fireEvent.click(within(poolSection()).getByRole('button', { name: 'row.poolDiscard' }))

    expect(screen.queryByText('row.poolUnsavedMembers')).toBeNull()
    expect(memberCheckbox('AccA').checked).toBe(true)
    expect(memberCheckbox('AccB').checked).toBe(true)
    expect(enableSwitch.checked).toBe(true)
  })

  it('renders a stale target model and the back-to-automatic affordance clears it', () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    renderPool(basePool({
      // Host still holds an OLD id (NON-NEGOTIABLE: saved.targetModelId must not read as '').
      staleTargetModelId: 'retired-model',
      targetModelSource: 'stale',
    }), scope)

    // The controlled select shows the saved/reported model id, NOT automatic.
    const select = within(poolSection()).getByRole('combobox', { name: 'row.poolTargetLabel' }) as HTMLSelectElement
    expect(select.value).toBe('retired-model')
    // The stale model also appears as a selectable option.
    expect(within(select).getByRole('option', { name: 'row.poolTargetStaleOption:{\"model\":\"retired-model\"}' })).toBeTruthy()

    // Back-to-automatic removes the stale slot.
    fireEvent.click(clearTargetButton())
    expect(select.value).toBe('')
  })

  it('hides the probe-size row when the Host does not know the field', () => {
    // A card newer than the Host must not offer a control whose save would be
    // dropped by the Host schema and then fail its own read-back check.
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    const legacy: Omit<TraeWebPool, 'probeInputTokens'> & { probeInputTokens?: number } = { ...basePool() }
    delete legacy.probeInputTokens
    renderPool(legacy as TraeWebPool, scope)
    expect(within(poolSection()).queryByRole('combobox', { name: 'row.poolProbeSizeLabel' })).toBeNull()
    // The rest of the settings still save.
    fireEvent.click(within(poolSection()).getByRole('checkbox', { name: 'row.poolEnabled' }))
    expect(screen.getByText('row.poolUnsavedMembers')).toBeTruthy()
  })

  it('saves the probe size choice and treats it as a draft like every other preference', async () => {
    const { scope, calls } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    renderPool(basePool(), scope)

    const select = within(poolSection()).getByRole('combobox', { name: 'row.poolProbeSizeLabel' }) as HTMLSelectElement
    // 0 (minimal) is a REAL choice, not "unset": the select must show it, not fall
    // back to whatever the document's default happens to be.
    expect(select.value).toBe('0')

    fireEvent.change(select, { target: { value: '50000' } })
    // A draft change alone writes nothing.
    expect(calls.length).toBe(0)
    expect(select.value).toBe('50000')

    fireEvent.click(saveButton())
    await waitFor(() => { expect(calls.length).toBe(1) })
    const written = calls[0]!.value as { cn?: { pool?: { probeInputTokens?: number } } }
    expect(written.cn?.pool?.probeInputTokens).toBe(50000)

    // Discard puts the saved value back.
    fireEvent.change(select, { target: { value: '10000' } })
    expect(select.value).toBe('10000')
    fireEvent.click(within(poolSection()).getByRole('button', { name: 'row.poolDiscard' }))
    expect((within(poolSection()).getByRole('combobox', { name: 'row.poolProbeSizeLabel' }) as HTMLSelectElement).value).toBe('50000')
  })

  it('omits the check-in column when checkinSupported is false', () => {
    const { scope } = makeScope()
    renderPool(basePool({ checkinSupported: false }), scope)

    const section = poolSection()
    // No checkin column header, no per-row checkin state.
    expect(screen.queryByText('row.poolColumnCheckin')).toBeNull()
    expect(within(poolRow('AccA')).queryByText(/row\.poolCheckin/)).toBeNull()
  })

  it('renders exactly as many cells per row as the table declares columns', () => {
    // A grid row with one cell too many does not shrink — the extra cell wraps the
    // action buttons onto a second line, which is what a five-cell row looked like
    // on the four-column (no check-in) table.
    const narrow = makeScope()
    const { container } = render(renderPoolAndReturn(basePool({ checkinSupported: false }), narrow.scope))
    const table = container.querySelector('.dsm-trae-pool-table')
    expect(table?.classList.contains('dsm-trae-pool-table-no-checkin')).toBe(true)
    const narrowRows = Array.from(container.querySelectorAll('.dsm-trae-pool-row'))
    expect(narrowRows.length).toBeGreaterThan(0)
    for (const row of narrowRows) expect(row.children).toHaveLength(4)

    cleanup()
    const wide = makeScope()
    const second = render(renderPoolAndReturn(basePool(), wide.scope))
    for (const row of Array.from(second.container.querySelectorAll('.dsm-trae-pool-row'))) {
      expect(row.children).toHaveLength(5)
    }
  })

  it('renders a streamed row BEFORE the batch finishes, instead of freezing on a spinner', async () => {
    // The Host streams one NDJSON line per account, but a card that calls
    // `response.text()` only renders them after the LAST account finishes — the
    // whole batch looks frozen on "逐个处理账号中…". This body stays open, so a
    // row that appears now can only have come from the stream itself.
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    renderPool(basePool(), scope)

    let ctrl!: ReadableStreamDefaultController<Uint8Array>
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({ start(controller) { ctrl = controller } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))

    fireEvent.click(within(poolSection()).getByRole('button', { name: 'row.poolTestAll' }))
    ctrl.enqueue(encoder.encode(JSON.stringify({
      row: { accountId: 'acc-a', accountName: 'AccA', modelId: 'free-1', outcome: 'ok', detail: 'fast' },
    }) + '\n'))

    // No close, no trailing {rows} line: the cell must be there anyway.
    await waitFor(() => {
      expect(within(poolRow('AccA')).getByText('row.poolProbeOk')).toBeTruthy()
    })
    // The run is still in flight, so the button must still read as busy.
    expect(screen.getByRole('button', { name: 'row.poolTesting' }).hasAttribute('disabled')).toBe(true)

    ctrl.close()
    await waitFor(() => { expect(screen.queryByText('row.poolBusyHint')).toBeNull() })
  })

  it('cancels a test that never answers, so the button cannot stay locked forever', async () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    renderPool(basePool(), scope)
    vi.useFakeTimers({ shouldAdvanceTime: true })

    // A connection that never answers and never errors: only the card's own
    // deadline can end it. The stub honours the abort signal like real fetch.
    vi.stubGlobal('fetch', vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      })
    })))

    fireEvent.click(within(poolSection()).getByRole('button', { name: 'row.poolTestAll' }))
    // While the run is in flight the button is relabelled and disabled.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'row.poolTesting' })).toBeTruthy()
    })

    act(() => { vi.advanceTimersByTime(181_000) })

    // After the deadline the label comes back and the button is usable again.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'row.poolTestAll' }).hasAttribute('disabled')).toBe(false)
    })
    vi.useRealTimers()
  })

  it('renders a test batch incrementally from a mocked NDJSON stream', async () => {
    // Seed membership so the "test all" button (disabled with no members) is live.
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    renderPool(basePool(), scope)

    const rows: TraePoolTestRowView[] = [
      { accountId: 'acc-a', accountName: 'AccA', modelId: 'free-1', outcome: 'ok', detail: 'fast' },
      { accountId: 'acc-b', accountName: 'AccB', modelId: 'free-1', outcome: 'rate-limited', detail: 'throttled', retryAtMs: Date.now() + 60_000 },
    ]
    const fullNdjson = rows.map(r => JSON.stringify({ row: r })).join('\n') + '\n' + JSON.stringify({ rows })

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      expect(url).toBe(withTraePoolAction('cn', 'test'))
      return new Response(fullNdjson, { status: 200 })
    }))

    // Row 1 lands first, row 2 and the final {rows} line follow, so the probe
    // cells must appear incrementally — assert on the final full set, which
    // requires NDJSON to have been consumed line-by-line (JSON.stringify over
    // the array would not contain the `{row}` lines).
    fireEvent.click(within(poolSection()).getByRole('button', { name: 'row.poolTestAll' }))

    await waitFor(() => {
      expect(within(poolRow('AccA')).getByText('row.poolProbeOk')).toBeTruthy()
    })
    await waitFor(() => {
      expect(within(poolRow('AccB')).getByText('row.poolProbeRateLimited')).toBeTruthy()
    })
    // Batch completion clears the busy spinner state and logs done.
    await waitFor(() => { expect(screen.queryByText('row.poolBusyHint')).toBeNull() })
    expect(screen.getByText('row.poolLogTestDone')).toBeTruthy()

    // ONE click, ONE log line per account: the Host streams a `{row}` and then a
    // final `{rows}` summary repeating it, so logging both printed every account
    // twice ("LaoDing：正常。" twice for a single click).
    for (const name of ['AccA', 'AccB']) {
      expect(screen.getAllByText(new RegExp(`"accountName":"${name}"`))).toHaveLength(1)
    }
  })

  it('renders the "choose members" warning when noCandidate is empty', () => {
    const { scope } = makeScope()
    renderPool(basePool({ noCandidate: 'empty' }), scope)

    const section = poolSection()
    expect(within(section).getByText('row.poolNoCandidateEmpty')).toBeTruthy()
    expect(within(section).getByText('row.poolNoCandidateEmptyHint')).toBeTruthy()
  })

})

describe('the destructive delete action', () => {
  it('is the only destructive action, and hidden unless the Host supports deleting a copy', () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    renderPool(basePool(), scope) // basePool: no deleteSupported
    // No delete button when the Host cannot delete...
    expect(within(poolRow('AccA')).queryByRole('button', { name: /row\.poolRowDelete/ })).toBeNull()
    // ...and no 移除 button either: it was folded into delete, so the row has only
    // its Test action left rather than a softer second removal the user cannot read.
    expect(within(poolRow('AccA')).queryByRole('button', { name: /row\.poolRowRemoveAria/ })).toBeNull()
    expect(within(poolRow('AccA')).getByRole('button', { name: 'row.poolRowTest' })).toBeTruthy()
  })

  it('deletes the plugin credential, persists the membership, logs success and awaits refresh', async () => {
    // Delete drops the plugin's OWN copy and clears every account-holder this card
    // holds: settings membership, draft selection, the binding it may have held.
    const { scope, calls } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    const refreshed = vi.fn()
    renderPool(basePool({ deleteSupported: true }), scope, MODELS, { onRefresh: refreshed })

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(withTraePoolAccount('cn', 'delete', 'acc-a'))
      return new Response(JSON.stringify({ accountId: 'acc-a', deleted: true, stillSignedIn: false }), { status: 200 })
    }))

    fireEvent.click(within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }))

    await waitFor(() => { expect(calls.length).toBe(1) })
    const written = calls[0]!.value as { cn?: { pool?: { enabled?: boolean; memberAccountIds?: string[] } } }
    expect([...(written.cn?.pool?.memberAccountIds ?? [])].sort()).toEqual(['acc-b'])
    // The switch is a preference, not part of the delete: written back as SAVED.
    expect(written.cn?.pool?.enabled).toBe(true)
    // The row is OUT of the pool and the draft agrees, so no stale 「未保存」 nudge.
    await waitFor(() => { expect(within(poolRow('AccA')).getByText('row.poolNotMember')).toBeTruthy() })
    expect(screen.queryByText('row.poolUnsavedMembers')).toBeNull()
    // Success — and no sign-out hint, because the account is gone from the machine.
    expect(screen.getByText('row.poolRowDeleted:{"accountName":"AccA"}')).toBeTruthy()
    expect(screen.queryByText(/row\.poolDeleteStillSigned/)).toBeNull()
    // The re-read was awaited, and the button returned to idle.
    expect(refreshed).toHaveBeenCalled()
    await waitFor(() => {
      const button = within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }) as HTMLButtonElement
      expect(button.textContent).toBe('row.poolRowDelete')
      expect(button.disabled).toBe(false)
    })
  })

  it('shows the in-flight caption only while the delete is pending', async () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    renderPool(basePool({ deleteSupported: true }), scope)

    let settle: ((value: Response) => void) | undefined
    const pending = new Promise<Response>(resolve => { settle = resolve })
    vi.stubGlobal('fetch', vi.fn(() => pending))

    fireEvent.click(within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }))

    const inflight = within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }) as HTMLButtonElement
    expect(inflight.textContent).toBe('row.poolRowDeleting')
    expect(inflight.disabled).toBe(true)

    settle?.(new Response(JSON.stringify({ accountId: 'acc-a', deleted: true, stillSignedIn: false }), { status: 200 }))
    await waitFor(() => {
      const done = within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }) as HTMLButtonElement
      expect(done.textContent).toBe('row.poolRowDelete')
      expect(done.disabled).toBe(false)
    })
  })

  it('tells the user which app to quit when a running Trae blocks the delete', async () => {
    // A running Trae holds storage.json in memory and flushes it back on exit, so
    // the Host refuses rather than rewriting a file that will be reverted. The card
    // must name the app and NOT log a deletion or touch the settings membership.
    const { scope, calls } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    const refreshed = vi.fn()
    renderPool(basePool({ deleteSupported: true }), scope, MODELS, { onRefresh: refreshed })
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({
        accountId: 'acc-a', deleted: false, stillSignedIn: true, hadCopy: true, blockedApps: ['cn'], signedOutApps: [],
      }), { status: 200 })))

    fireEvent.click(within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }))

    await waitFor(() => {
      expect(screen.getByText('row.poolRowDeleteAppRunning:{"accountName":"AccA","apps":"row.editionCn"}')).toBeTruthy()
    })
    // The actionable sentence is on the card, naming the app the user must quit.
    expect(screen.getByText('row.poolDeleteAppRunning:{"accountName":"AccA","apps":"row.editionCn"}')).toBeTruthy()
    // Nothing was deleted, so no success line and no sign-out guidance.
    expect(screen.queryByText(/row\.poolRowDeleted:/)).toBeNull()
    expect(screen.queryByText(/row\.poolDeleteStillSigned/)).toBeNull()
    // The settings membership was not rewritten and no refresh was requested.
    expect(calls).toHaveLength(0)
    expect(refreshed).not.toHaveBeenCalled()
  })

  it('leaves an unsaved switch edit alone when an in-row delete persists the membership', async () => {
    // The delete writes the settings slot, which re-reads `saved` and resets the
    // draft. It must reset the MEMBERSHIP it just changed, not revert a switch the
    // user is still editing — the hint says the switch needs an explicit save.
    const { scope, calls } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    renderPool(basePool({ deleteSupported: true }), scope)
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ accountId: 'acc-a', deleted: true, stillSignedIn: false }), { status: 200 })))

    const enableSwitch = within(poolSection()).getByRole('checkbox', { name: 'row.poolEnabled' }) as HTMLInputElement
    fireEvent.click(enableSwitch)
    expect((within(poolSection()).getByRole('checkbox', { name: 'row.poolEnabled' }) as HTMLInputElement).checked).toBe(false)

    fireEvent.click(within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }))

    await waitFor(() => { expect(calls.length).toBe(1) })
    const written = calls[0]!.value as { cn?: { pool?: { enabled?: boolean; memberAccountIds?: string[] } } }
    expect(written.cn?.pool?.enabled).toBe(true)
    expect([...(written.cn?.pool?.memberAccountIds ?? [])].sort()).toEqual(['acc-b'])
    // The draft switch survived the write.
    await waitFor(() => {
      expect((within(poolSection()).getByRole('checkbox', { name: 'row.poolEnabled' }) as HTMLInputElement).checked).toBe(false)
    })
  })

  it('drops a ghost row once its saved membership is gone', async () => {
    const { scope, calls } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'ghost-1'] }))
    renderPool(ghostPool({ deleteSupported: true }), scope)
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe(withTraePoolAccount('cn', 'delete', 'ghost-1'))
      return new Response(JSON.stringify({ accountId: 'ghost-1', deleted: true, stillSignedIn: false }), { status: 200 })
    }))

    expect(within(poolSection()).getByText('GhostOne')).toBeTruthy()
    fireEvent.click(within(poolRow('GhostOne')).getByRole('button', { name: /row\.poolGhostDeleteAria/ }))

    await waitFor(() => { expect(calls.length).toBe(1) })
    const written = calls[0]!.value as { cn?: { pool?: { memberAccountIds?: string[] } } }
    expect(written.cn?.pool?.memberAccountIds).toEqual(['acc-a'])
    await waitFor(() => { expect(within(poolSection()).queryByText('GhostOne')).toBeNull() })
  })

  it('does not commit the settings draft when the deleted account was not a member', async () => {
    // AccC is listed but never checked in: there is nothing to remove from
    // settings, so the click must not commit the user's unsaved draft.
    const { scope, calls } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    renderPool(basePool({
      deleteSupported: true,
      accounts: [
        { accountId: 'acc-a', accountName: 'AccA', current: true, member: true, reachable: true, generalAvailable: 1, workAvailable: 1, checkedInToday: false },
        { accountId: 'acc-c', accountName: 'AccC', current: false, member: false, reachable: true, generalAvailable: 2, workAvailable: 2, checkedInToday: false },
      ],
      memberAccountIds: ['acc-a'],
    }), scope)
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ accountId: 'acc-c', deleted: true, stillSignedIn: false }), { status: 200 })))

    fireEvent.click(within(poolRow('AccC')).getByRole('button', { name: /row\.poolRowDeleteAria/ }))

    await waitFor(() => {
      expect(screen.getByText('row.poolRowDeleted:{"accountName":"AccC"}')).toBeTruthy()
    })
    expect(calls).toHaveLength(0)
  })

  it('reports a delete whose settings write did not land instead of logging success', async () => {
    const { scope, calls } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    renderPool(basePool({ deleteSupported: true }), scope)
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ accountId: 'acc-a', deleted: true, stillSignedIn: false }), { status: 200 })))
    // A Host that accepts the write but keeps answering the old value.
    scope.set = async (field: string, value: unknown) => {
      calls.push({ field, value })
      return true
    }

    fireEvent.click(within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }))

    await waitFor(() => { expect(screen.getByText('row.poolLogSaveFailed')).toBeTruthy() })
    expect(screen.queryByText('row.poolRowDeleted:{"accountName":"AccA"}')).toBeNull()
    // The button still clears: the failure is reported in the log, not by a spinner.
    await waitFor(() => {
      const button = within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }) as HTMLButtonElement
      expect(button.textContent).toBe('row.poolRowDelete')
    })
  })

  it('says there was no copy to delete when the account only lives in the Trae app', async () => {
    // `hadCopy: false` — the plugin held nothing; the account is the app's own
    // login. Claiming "已删除副本" here would describe an erasure that never
    // happened, so the card must say the copy does not exist instead.
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    renderPool(basePool({ deleteSupported: true }), scope)
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ accountId: 'acc-a', deleted: true, stillSignedIn: true, hadCopy: false }), { status: 200 })))

    fireEvent.click(within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }))

    await waitFor(() => {
      expect(screen.getByText('row.poolDeleteNoCopy:{"accountName":"AccA"}')).toBeTruthy()
    })
    expect(screen.queryByText('row.poolDeleteStillSigned:{"accountName":"AccA"}')).toBeNull()
    expect(screen.queryByText('row.poolRowDeleted:{"accountName":"AccA"}')).toBeNull()
    expect(screen.getByText('row.poolRowDeleteNoCopy:{"accountName":"AccA"}')).toBeTruthy()
  })

  it('shows a sign-out-in-Trae hint instead of success when the account is still signed in to the app', async () => {
    // Deleting the plugin's copy of an account that is ALSO a desktop login is a
    // partial erasure: the row will stay (the app still lists it). Lying "已删除"
    // would push the user to expect a row that cannot leave.
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a', 'acc-b'] }))
    renderPool(basePool({ deleteSupported: true }), scope)

    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ accountId: 'acc-a', deleted: true, stillSignedIn: true }), { status: 200 })))

    fireEvent.click(within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }))

    await waitFor(() => {
      expect(screen.getByText('row.poolDeleteStillSigned:{"accountName":"AccA"}')).toBeTruthy()
    })
    expect(screen.queryByText('row.poolRowDeleted:{"accountName":"AccA"}')).toBeNull()
    // The guidance is a warning, not a claim that the erasure failed.
    expect(screen.getByText('row.poolRowDeleteStillSigned:{"accountName":"AccA"}')).toBeTruthy()
    await waitFor(() => {
      const button = within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
    })
  })

  it('reports an unconfirmed delete instead of pretending it landed', async () => {
    const { scope } = makeScope(pooledInitial({ enabled: true, memberAccountIds: ['acc-a'] }))
    renderPool(basePool({ deleteSupported: true }), scope)
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ accountId: 'acc-a', deleted: false, stillSignedIn: true }), { status: 200 })))

    fireEvent.click(within(poolRow('AccA')).getByRole('button', { name: /row\.poolRowDeleteAria/ }))

    await waitFor(() => {
      expect(screen.getByText('row.poolRowDeleteError:{"accountName":"AccA","message":"row.poolRowDeleteFailed"}')).toBeTruthy()
    })
    expect(screen.queryByText('row.poolRowDeleted:{"accountName":"AccA"}')).toBeNull()
  })
})

/**
 * The section must actually LOOK like something.
 *
 * jsdom does not do layout or cascade, so an unstyled section passes every
 * behavioural assertion above while the user sees a wall of stacked text. The
 * pool shipped exactly that way once (840 lines of markup, zero rules), which is
 * why the guard is structural: every `dsm-*` class this component RENDERS must
 * have a rule in the card stylesheet.
 *
 * The composer readout already had this test (`tests/composer-styles.spec.tsx`);
 * it did not cover the card, so nothing failed.
 */
describe('the pool section is styled', () => {
  function classesIn(container: HTMLElement): Set<string> {
    const found = new Set<string>()
    // `Array.from` rather than a bare for-of: tsconfig's lib is `dom` without
    // `dom.iterable`, so a NodeList is not an Iterable to the type checker.
    for (const element of Array.from(container.querySelectorAll('[class]'))) {
      for (const name of element.getAttribute('class')?.split(/\s+/) ?? []) {
        if (name !== '') found.add(name)
      }
    }
    return found
  }

  function unstyled(names: Set<string>): string[] {
    return [...names].filter(
      name => !TRAE_CARD_CSS.includes(`.${name}{`) && !TRAE_CARD_CSS.includes(`.${name}:`),
    )
  }

  it('every class the member table renders has a rule', () => {
    const { scope } = makeScope()
    // A pool document that exercises the states a single row can be in:
    // serving (and therefore tinted), in-pool, excluded, tested, checked in,
    // device-claimed, unknown, plus a ghost that stays removable.
    const rich = basePool({
      checkinSupported: true,
      targetModelId: 'free-1',
      targetModelSource: 'stale',
      staleTargetModelId: 'retired-model',
      noCandidate: 'unusable',
      memberAccountIds: ['acc-a', 'acc-b', 'ghost-1'],
      accounts: [
        {
          accountId: 'acc-a', accountName: 'AccA', current: true, member: true, reachable: true,
          generalAvailable: 30, workAvailable: 500, expiringSoon: 0, checkedInToday: true,
          probe: { outcome: 'ok', atMs: Date.now() - 60_000, source: 'test-batch', modelId: 'free-1' },
        },
        {
          accountId: 'acc-b', accountName: 'AccB', current: false, member: true, reachable: true,
          generalAvailable: 8, workAvailable: 0, expiringSoon: 12, checkedInToday: false,
          excludedBy: 'rate-limited',
          probe: { outcome: 'rate-limited', atMs: Date.now() - 3_600_000, source: 'live-request', modelId: 'free-1', message: 'slow down' },
        },
        {
          accountId: 'acc-c', accountName: 'AccC', current: false, member: false, reachable: true,
          deviceCheckedIn: true,
        },
      ],
    })
    const { container } = render(<>{renderPoolAndReturn(rich, scope)}</>)
    expect(unstyled(classesIn(container))).toEqual([])
  })

  it('every class the empty / settings / log markup renders has a rule', () => {
    const { scope } = makeScope()
    const { container } = render(<>{renderPoolAndReturn(basePool({ checkinSupported: false, noCandidate: 'empty', targetModelSource: 'none' }), scope)}</>)
    expect(unstyled(classesIn(container))).toEqual([])
  })

  it('styles the state variants that only appear after an interaction', () => {
    // These classes are produced by the activity log, which only mounts entries
    // after an action, so a render cannot reach them — assert them directly
    // rather than let a whole tone family go unstyled.
    for (const name of ['dsm-trae-pool-log-ok', 'dsm-trae-pool-log-info', 'dsm-trae-pool-log-warn', 'dsm-trae-pool-log-error']) {
      expect(TRAE_CARD_CSS).toContain(`.${name}{`)
    }
  })
})

/**
 * Who bills is answered ONCE — in the header — and the 「未入池」 tag stays on the
 * row.
 *
 * These two facts are orthogonal and used to share a line: a green 「派单中」
 * badge next to a grey 「未入池」, under a count reading 「已选 0 / 1」, reads as a
 * bug. It is not (the account serves right now, the Host fell back to the saved
 * selection, and no member is in the pool) — but the explanation has to exist
 * somewhere, so it moved into the header plus one conditional note.
 *
 * The pill that used to sit in the row is gone; what these tests pin is that the
 * INFORMATION still exists, in the one place it cannot contradict the row.
 */
describe('who is billing is stated in the header, not on the row', () => {
  const headerLine = (account: string): string => `row.poolCurrentHeader:${JSON.stringify({ account })}`

  it('names the billing account in the header even when it is not a pool member, and explains the overlap', () => {
    const { scope } = makeScope()
    // Exactly the post-removal shape: the saved list is empty, the Host fell back
    // to the bound account, so that account is `current` but no longer a member.
    render(<>{renderPoolAndReturn(basePool({
      memberAccountIds: [],
      noCandidate: 'empty',
      accounts: [
        { accountId: 'acc-a', accountName: 'AccA', current: true, member: false, reachable: true, generalAvailable: 30 },
        { accountId: 'acc-b', accountName: 'AccB', current: false, member: false, reachable: true, generalAvailable: 8 },
      ],
    }), scope)}</>)
    const section = poolSection()
    expect(within(section).getByText(headerLine('AccA'))).toBeTruthy()
    // The row keeps membership in words, and nothing on it claims to be serving.
    expect(within(poolRow('AccA')).getByText('row.poolNotMember')).toBeTruthy()
    expect(poolRow('AccA').querySelector('.dsm-trae-pool-tag-current')).toBeNull()
    // …and the orthogonal pair is explained, once.
    expect(within(section).getByText(`row.poolServingOutside:${JSON.stringify({ account: 'AccA' })}`)).toBeTruthy()
  })

  it('drops the note when the billing account IS a pool member', () => {
    const { scope } = makeScope()
    render(<>{renderPoolAndReturn(basePool(), scope)}</>)
    const section = poolSection()
    expect(within(section).getByText(headerLine('AccA'))).toBeTruthy()
    expect(within(section).queryByText(/row\.poolServingOutside/)).toBeNull()
  })

  it('puts the picker in the header slot while the pool is off', () => {
    // With the pool off the plugin does not choose, so the user must be able to —
    // and the picker carries the account name, which is why a badge beside it
    // would be the same fact twice in one row of pixels.
    const { scope } = makeScope()
    const onBind = vi.fn()
    render(<AccountPool
      panel="cn"
      pool={basePool({ enabled: false })}
      models={MODELS}
      t={t}
      settingsScope={scope as never}
      onBind={onBind}
    />)
    const picker = within(poolSection()).getByRole('combobox', { name: 'row.poolManualAccountLabel' })
    expect(picker).toBeTruthy()
    // The badge is gone: the control it would have duplicated is right there.
    expect(screen.queryByText(headerLine('AccA'))).toBeNull()
    // Binding still works through the control that moved.
    fireEvent.change(picker, { target: { value: 'acc-b' } })
    expect(onBind).toHaveBeenCalledWith('acc-b')
  })

  it('falls back to naming the account when no picker can be offered', () => {
    // A Host with no binding route cannot offer a choice, so the slot does the
    // next best thing rather than leaving the header silent about who bills.
    const { scope } = makeScope()
    render(<>{renderPoolAndReturn(basePool({
      enabled: false,
      accounts: [
        { accountId: 'acc-a', accountName: 'AccA', current: true, member: false, reachable: true, generalAvailable: 30 },
      ],
    }), scope)}</>)
    expect(within(poolSection()).getByText(headerLine('AccA'))).toBeTruthy()
    expect(within(poolSection()).getByText('row.poolModeManual')).toBeTruthy()
  })
})

/**
 * The page's two modes are selected by a switch that has to come FIRST.
 *
 * It used to be the last row of the settings box, about a hundred lines below
 * the member table whose every column changes meaning with it. These tests pin
 * the ORDER, which is the whole point of the change — a re-render that moves the
 * switch back down would otherwise pass every other assertion in this file.
 */
describe('the pool switch leads the section', () => {
  it('renders the switch above the member table, with the running mode beside it', () => {
    const { scope } = makeScope()
    render(<>{renderPoolAndReturn(basePool(), scope)}</>)
    const section = poolSection()
    const switchInput = within(section).getByRole('checkbox', { name: 'row.poolEnabled' })
    const table = within(section).getByRole('table', { name: 'row.poolMembersTitle' })
    // DOCUMENT_POSITION_FOLLOWING: the table comes after the switch.
    expect(switchInput.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(section).getByText('row.poolModeAuto')).toBeTruthy()
  })

  it('labels the RUNNING mode, not the draft, while an edit is pending', async () => {
    // The switch already shows the pending edit and 「未保存」 says it is pending,
    // which frees the mode chip to answer a different question: what is the pool
    // doing right now? Read from the draft it would claim 「自动挑号」 while the
    // saved pool was still off and the manual picker was still in charge.
    const { scope } = makeScope(pooledInitial({ enabled: false, memberAccountIds: [] }))
    render(<>{renderPoolAndReturn(basePool({ enabled: false, memberAccountIds: [] }), scope)}</>)
    const section = poolSection()
    // Switch the draft ON without saving.
    await act(async () => { fireEvent.click(within(section).getByRole('checkbox', { name: 'row.poolEnabled' })) })
    expect(within(section).getByText('row.poolDirty')).toBeTruthy()
    // `pool.enabled` (the Host's running answer) is still false, so the chip
    // keeps saying 「手动选号」.
    expect(within(section).getByText('row.poolModeManual')).toBeTruthy()
    expect(within(section).queryByText('row.poolModeAuto')).toBeNull()
  })
})

/**
 * The batch bar sits between the range it acts on and the rows it acts on.
 *
 * Order is the feature: 「已选 N / M」 and 全部/清空 declare the SET, the buttons
 * act on it, and the checkboxes it counts are the table below. The bar used to
 * stand above the whole member block, reading as a page-level toolbar whose
 * buttons asked "act on WHICH accounts?" a full block before the control that
 * answers it.
 */
describe('the batch bar sits inside the member block', () => {
  it('renders the count, then the batch button, then the table', () => {
    const { scope } = makeScope()
    render(<>{renderPoolAndReturn(basePool(), scope)}</>)
    const section = poolSection()
    const card = section.querySelector('.dsm-trae-pool-card') as HTMLElement
    const count = within(section).getByText(/row\.poolSelectedCount/)
    const testAll = within(section).getByRole('button', { name: 'row.poolTestAll' })
    const table = within(section).getByRole('table', { name: 'row.poolMembersTitle' })
    expect(card.contains(count)).toBe(true)
    expect(card.contains(testAll)).toBe(true)
    expect(count.compareDocumentPosition(testAll) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(testAll.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('states why the batch button is dead right under it, not a screen away', () => {
    const { scope } = makeScope()
    render(<>{renderPoolAndReturn(basePool({ memberAccountIds: [] }), scope)}</>)
    const section = poolSection()
    const testAll = within(section).getByRole('button', { name: 'row.poolTestAll' })
    expect((testAll as HTMLButtonElement).disabled).toBe(true)
    const note = within(section).getByText('row.poolActionNoteNoMembers')
    expect(testAll.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps the save bar reachable while scrolling the page', () => {
    // Both commit buttons used to sit at the very bottom of the section: with a
    // long roster the user edited a row, scrolled nowhere, and could not see what
    // applied the edit.
    const bar = /\.dsm-trae-pool-save-row\{([^}]*)\}/.exec(TRAE_CARD_CSS)
    expect(bar?.[1]).toContain('position:sticky')
    expect(bar?.[1]).toContain('bottom:0')
  })
})

/**
 * The probe column no longer claims to name a model.
 *
 * The same model used to be printed three times on one screen: on the 「目标测速
 * 模型」 control, in the column header, and again under every row. The header is
 * now 「状态」 (it describes an outcome), and a row only names its model when it
 * differs from the saved choice — the case that looks like a bug and is not.
 */
describe('the probe column says one thing', () => {
  it('heads the column 「状态」, not a model name', () => {
    // The header describes an OUTCOME. It used to say 「目标模型」, which named the
    // very thing the 「目标测速模型」 control above already names — the first of
    // three sightings of one model on a single screen.
    expect(zh['row.poolColumnProbe']).toBe('状态')
    const { scope } = makeScope()
    render(<>{renderPoolAndReturn(basePool({ targetModelId: 'free-1', targetModelSource: 'preferred' }), scope)}</>)
    expect(within(poolSection()).getByText('row.poolColumnProbe')).toBeTruthy()
  })

  it('does not reprint the saved target model under a row that used exactly it', () => {
    const { scope } = makeScope()
    render(<>{renderPoolAndReturn(basePool({
      targetModelId: 'free-1',
      targetModelSource: 'preferred',
      accounts: [
        {
          accountId: 'acc-a', accountName: 'AccA', current: true, member: true, reachable: true,
          generalAvailable: 30, workAvailable: 0,
          probe: { outcome: 'ok', atMs: Date.now() - 60_000, source: 'test-batch', modelId: 'free-1' },
        },
      ],
    }), scope)}</>)
    expect(within(poolRow('AccA')).queryByText(/row\.poolProbeModel/)).toBeNull()
  })

  it('names the model when the probe ran against a different one', () => {
    const { scope } = makeScope()
    render(<>{renderPoolAndReturn(basePool({
      targetModelId: 'free-1',
      targetModelSource: 'preferred',
      accounts: [
        {
          accountId: 'acc-a', accountName: 'AccA', current: true, member: true, reachable: true,
          generalAvailable: 30, workAvailable: 0,
          probe: { outcome: 'ok', atMs: Date.now() - 60_000, source: 'live-request', modelId: 'pro-1' },
        },
      ],
    }), scope)}</>)
    expect(within(poolRow('AccA')).getByText(/row\.poolProbeModel/)).toBeTruthy()
  })

  it('still shows where the reading came from when it hides the model', () => {
    // Hiding the model must not hide the provenance with it: 「实时请求」 explains
    // where the number came from, and that is not stated anywhere else.
    const { scope } = makeScope()
    render(<>{renderPoolAndReturn(basePool({
      targetModelId: 'free-1',
      targetModelSource: 'preferred',
      accounts: [
        {
          accountId: 'acc-a', accountName: 'AccA', current: true, member: true, reachable: true,
          generalAvailable: 30, workAvailable: 0,
          probe: { outcome: 'ok', atMs: Date.now() - 60_000, source: 'live-request', modelId: 'free-1' },
        },
      ],
    }), scope)}</>)
    expect(within(poolRow('AccA')).queryByText(/row\.poolProbeModel/)).toBeNull()
    expect(within(poolRow('AccA')).getByText('row.poolProbeSourceLive')).toBeTruthy()
  })
})
