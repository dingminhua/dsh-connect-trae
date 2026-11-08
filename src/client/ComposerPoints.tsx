/**
 * Credit readout for the composer row (`conversation.input.right`, rendered
 * immediately before the model picker).
 *
 * Shows the bound CN account's general credit balance, but ONLY while the
 * session's selected model belongs to this plugin. That condition is the whole
 * point: the sidebar foot is a single shared row, so two connector plugins each
 * parking a line there end up fighting for the same space. The composer row is
 * per-session and provider-scoped, so exactly one plugin's credits are relevant
 * at a time and nothing overlaps.
 *
 * The row itself is a bare clickable readout — `Trae CN · 657` — with NO
 * controls of its own. Clicking it opens an anchored panel: a TABLE with one row
 * per account in the region and that account's general balance, where a row
 * click switches to it.
 *
 * The panel's header carries the account-pool test batch, labelled 「刷新」, and
 * a SETTINGS pill that opens this plugin's own page in the wide Settings dialog
 * (`./settings-route.ts`).
 *
 * The pill was briefly removed, on the belief that no host seam could open the
 * dialog on a given section. That belief was wrong — the settings shell
 * publishes its state as the `sidebar.settings` store seat, whose `openSection(id)`
 * is exactly that seam — so the pill is back and now lands on this plugin's own
 * `settings.section` page. The route module records the finding.
 *
 * Two deliberate choices in that panel:
 *
 *  - GENERAL balance only, not Work credits. The table's one figure is the
 *    bucket the SOLO chat actually spends; two columns of numbers in a
 *    five-slot popover is noise, and the card is where the breakdown belongs.
 *  - Per-account figures are fetched ONLY while the panel is open. The
 *    5-minute readout must not multiply its upstream reads by the account
 *    count — a healthy balance should not pay for a table nobody is looking at.
 *    This is the same principle that keeps `creditAlternatives` firing only
 *    when a balance hits zero.
 *
 * The provider comes from the Host's own `modelSelection` projection rather
 * than from anything this plugin tracks: the projection is what the model
 * picker writes and what the next request will use, so the readout cannot
 * disagree with the model actually in effect.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismissOnOutsidePointer } from './popover.ts'
import {
  TRAE_ACCOUNT_CREDITS_PATH,
  TRAE_ACCOUNT_STATUS_PATH,
  TRAE_USAGE_PATH,
  configuredAccountsOf,
  withTraeRegion,
} from '../status-paths.ts'
import { COMPOSER_POINTS_CSS } from './styles.ts'
import { formatDateTime } from './display.ts'
import { expiryHeadlineKey, expiryNotice, expiryToneClass } from './expiry-ladder.ts'
import type { ExpiryNotice } from './expiry-ladder.ts'
import { planText } from './plan-text.ts'
import type { TraeWebAccountCredit, TraeWebAccountState, TraeWebCreditExpiry, TraeWebPayStatus, TraeWebUsage } from '../status-paths.ts'
import { refreshIntervalMsOf, withTraePoolAction } from '../status-paths.ts'
import { POOL_TEST_TIMEOUT_MS, applyTestLine, outcomeLabel, testLinesOf } from './pool-test.ts'
import type { TraeRegion } from '../region.ts'
import type { TraeSettingsKey } from './locales.ts'
import type { TraeUsageCardInjected } from './TraeUsageCard.tsx'

/**
 * Inject the readout's styles into the document head, once, on module load.
 *
 * Same idempotent pattern as the card's injection, and for the same reason: the
 * classes are attached to DOM this component owns, and `.dsm-card-*` lives in
 * `TRAE_CARD_CSS` — which only loads when the settings card does. Before this
 * existed (2.13.0–2.13.4) the trigger rendered as the browser's default button
 * box and the panel, with no `position: fixed`, had its measured left/top
 * ignored and appeared nowhere.
 */
if (typeof document !== 'undefined') {
  const cssId = 'dsh-connect-trae/composer-points.css'
  if (!document.querySelector(`style[data-plugin-css="${cssId}"]`)) {
    const styleTag = document.createElement('style')
    styleTag.dataset.plugin = 'dsh-connect-trae'
    styleTag.dataset.pluginCss = cssId
    styleTag.textContent = COMPOSER_POINTS_CSS
    document.head.appendChild(styleTag)
  }
}

/**
 * Automatic refresh period when nothing says otherwise.
 *
 * Five minutes, matching the sidebar line: a credit balance moves on the scale
 * of model calls, not seconds, and each read is two read-only upstream calls.
 *
 * The LIVE period is the user's `Config.refreshIntervalMinutes` (see
 * {@link refreshIntervalMsOf}), whose default is this same five minutes — so
 * this constant is now the fallback for a caller that renders the readout
 * without a settings scope (a test, or a host that serves none), not the rule.
 * Both polling surfaces read that ONE field, so the composer row and the card
 * cannot end up refreshing the same routes at different rates.
 */
export const COMPOSER_POINTS_REFRESH_INTERVAL_MS = 300_000

/** Localized copy injected by the browser-plugin registration. */
export interface ComposerPointsInjected {
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string
}

export interface ComposerPointsProps extends Partial<ComposerPointsInjected> {
  /**
   * Provider route of the session's selected model, or undefined while the
   * projection has not landed. The readout renders nothing unless this is one
   * of {@link TRAE_COMPOSER_PROVIDERS}.
   */
  provider?: string
  /** Which region's credits to read when the provider is this plugin's. */
  region?: TraeRegion
  /**
   * Settings scope from the configForms mirror. Present whenever a row click
   * should switch accounts; without it the table still renders but the rows are
   * inert, because a panel that switches nothing must not pretend to.
   */
  settingsScope?: TraeUsageCardInjected['settingsScope']
  /**
   * Opens this plugin's own settings page; `false` means this host has no route
   * there. Absent means the panel draws no settings button at all — a control
   * that cannot do anything must not be drawn, the same rule the page header's
   * back button follows.
   *
   * Passed in rather than reached for here for one reason: the route needs the
   * entry's service probe, and this component is rendered directly by tests that
   * have no host. `./settings-route.ts` owns the decision; this owns the button.
   */
  onOpenSettings?: () => boolean
}

/**
 * Provider routes this readout serves, mapped to the region to read from.
 *
 * BOTH regions, but they do not show the same KIND of number, and that is the
 * data's doing rather than a preference:
 *
 *  - `cn` is credit-based, so the readout shows the account's general balance.
 *  - `ai` is subscription-based. The Host builds its usage document from
 *    `payStatus` and never sets `credits` on it (`webStatusFor` returns early
 *    for `region === 'ai'`), so there is no balance to show. What it does carry
 *    is the PLAN, so the readout names the plan (`Pro` / `Free`) instead.
 *
 * The international route was previously omitted entirely, which meant the
 * readout vanished while an international model was selected — the asymmetry a
 * user reported. Omitting it was the safer half of a real problem (a plan-shaped
 * document templated into a number slot renders a dash), but the fix is to
 * render what that side actually has, not to render nothing.
 *
 * Mirrors `TRAE_PROVIDERS` on the host side; duplicated here because the client
 * bundle must not import the host entry.
 */
export const TRAE_COMPOSER_PROVIDERS: Readonly<Record<string, TraeRegion>> = {
  'trae': 'cn',
  'trae-global': 'ai',
}

/** The general credit balance out of one usage document, or undefined. */
function generalCreditsOf(usage: TraeWebUsage): number | undefined {
  if (usage.status !== 'signed-in') return undefined
  return usage.credits?.generalAvailable
}

/** Group the digits so a four-figure balance stays readable in a narrow row. */
function formatCredits(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/**
 * The notice this panel would render, or undefined when there is nothing to say.
 *
 * THE ONE GUARD THE RENDER READS. An earlier version asked
 * `signedIn?.credits?.expiry !== undefined`, which is true whenever upstream sent
 * the four buckets — even with every `packs` count at 0. The box then rendered
 * with an empty `<span>` inside and the `lapsed` border (the tone fallback),
 * i.e. a warning-shaped rectangle containing nothing. Every empty-bucket
 * document produced one, which is the blank box in the reported screenshot.
 *
 * Putting the whole lookup here means the render cannot ask a weaker question
 * than the copy does: "is there a box" and "is there a sentence" are now the
 * same boolean.
 */
function expiryNoticeOf(signedIn: { credits?: { expiry?: TraeWebCreditExpiry } } | undefined): ExpiryNotice | undefined {
  const expiry = signedIn?.credits?.expiry
  return expiry === undefined ? undefined : expiryNotice(expiry)
}

/**
 * The soonest expiry the chosen tier names, or undefined when none carries one.
 *
 * Read from the tier the shared ladder picked, so the time shown always belongs
 * to the horizon the headline claims — the two cannot disagree.
 */
function soonestExpiryOf(expiry: TraeWebCreditExpiry): number | undefined {
  return expiryNotice(expiry)?.soonestExpiresAtMs
}

/**
 * The notice's headline sentence, naming the amount and the pack count.
 *
 * The TIER is chosen by the shared ladder (see `./expiry-ladder.ts`), which the
 * card's account panel uses too — the two surfaces render the same locale
 * keys, so the choice must not be made twice.
 */
function expiryMessageOf(expiry: TraeWebCreditExpiry, t: NonNullable<ComposerPointsProps['t']>): string {
  const notice = expiryNotice(expiry)
  if (notice === undefined) return ''
  return t(expiryHeadlineKey(notice.tier), {
    total: formatCredits(notice.total),
    packs: String(notice.packs),
  })
}

/**
 * A clock time, for the ONE thing in this panel that is always the same day:
 * `composer.lastRefresh`, which is "now" by construction.
 *
 * DO NOT reuse this for credit expiry. It was reused for that once (issue #71)
 * and produced `最早到期：23:59` for a pack expiring TOMORROW at 23:59 — a full
 * day earlier than the truth, in the one sentence whose entire job is "how long
 * do I have left". The card already rendered the same locale key
 * (`row.expiryEarliest`) through `formatDateTime`, so one key had two
 * granularities in one plugin. Expiry goes through `formatDateTime`; only
 * same-day instants may use this.
 *
 * The locale is `undefined` — the READER's, not a fixed one — so an English UI
 * shows `11:59 PM` rather than the Chinese convention's `23:59`. It used to
 * hardcode `'zh-CN'`, which meant the English interface printed a Chinese-style
 * time (issue #71's aside). `formatDateTime` already worked this way; this
 * brings the two into agreement.
 */
function formatClock(value: number): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function ComposerPoints(props: ComposerPointsProps) {
  const { t, provider, region, settingsScope, onOpenSettings } = props
  if (t === undefined) throw new Error('Composer points readout requires its translation function')
  const owned = provider === undefined ? undefined : TRAE_COMPOSER_PROVIDERS[provider]
  const activeRegion = region ?? owned
  /**
   * The poll period, from the user's own cadence setting.
   *
   * Read through the SHARED reader (the card's poll reads the same field the
   * same way), with the constant above as the fallback when this readout is
   * rendered with no settings scope at all. It re-reads on every render, so the
   * scope's notification after a write is enough to rebuild the timer — the
   * effect below lists it as a dependency for exactly that reason.
   */
  const refreshIntervalMs = settingsScope === undefined
    ? COMPOSER_POINTS_REFRESH_INTERVAL_MS
    : refreshIntervalMsOf(settingsScope.getSnapshot().value)

  const [usage, setUsage] = useState<TraeWebUsage | undefined>(undefined)
  const [accountCredits, setAccountCredits] = useState<TraeWebAccountCredit[] | undefined>(undefined)
  /**
   * Per-account PLANS, international region only.
   *
   * The CN panel reads the credit route; that route is CN-shaped (it calls the
   * credit snapshot, which the ai document does not carry), so the international
   * panel reads the per-account STATUS route instead — the same one the card's
   * roster uses, which answers `payStatus` for ai. Reads only while the panel is
   * open, for the same reason the credit route does.
   */
  const [accountPlans, setAccountPlans] = useState<Record<string, TraeWebPayStatus | undefined> | undefined>(undefined)
  const [switchingId, setSwitchingId] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  /**
   * The settings button was pressed on a host with no route to the page.
   *
   * Its own state rather than reusing `failed`: the two say different things
   * ("the upstream read failed" vs "this host cannot open the settings page"),
   * and a shared flag would let one press erase the other's explanation.
   */
  const [settingsFailed, setSettingsFailed] = useState(false)
  /**
   * The account-pool test batch, driven from this panel's header.
   *
   * WHY IT LIVES HERE AT ALL: the rows below ARE the pool's members, and a row's
   * mark is a MEASUREMENT (`被限流 · 约 6 小时后` is a probe result, not a
   * setting). Re-reading the usage document cannot improve a stale measurement —
   * only running it again can — so the question "which of these can serve right
   * now?" had no answer from the place that asks it. The pool card can do this,
   * but it is behind the settings page; the reader is already looking at these
   * accounts.
   *
   * `testing` is separate from the panel's other busy states on purpose: this is
   * a SERIAL batch against one account at a time with a gap (hitting the whole
   * pool at once is how the upstream's volume limit gets tripped), so it can run
   * for a minute while a credits read would be merely slow.
   *
   * `testFailed` is its own line so the two failures cannot take turns
   * overwriting each other in one slot. `testNote` carries the last outcome summary, which is what makes the
   * press feel answered even when the table's marks are subtle.
   */
  const [testing, setTesting] = useState(false)
  const [testFailed, setTestFailed] = useState<string | undefined>(undefined)
  const [testNote, setTestNote] = useState<string | undefined>(undefined)
  const testingRef = useRef(false)
  /**
   * The usage document, mirrored into a ref.
   *
   * `fetchAccountPlans` has to read the roster out of it, and reading it as a
   * `useCallback` DEPENDENCY made that callback a new function on every poll
   * (every `fetchUsage` stores a fresh object). The open/region effect calls
   * the callback by identity, so a new identity re-ran it — which meant every
   * five-minute poll silently re-read the per-account status of every account,
   * the exact "read on OPEN, not on a cycle" cost the effect's own comment says
   * it is avoiding. The ref keeps the callback stable while still reading the
   * newest document.
   */
  const usageRef = useRef<TraeWebUsage | undefined>(undefined)
  const [lastRefresh, setLastRefresh] = useState<number | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const rootRef = useRef<HTMLSpanElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /**
   * Re-render when the settings document changes, so a cadence picked in the
   * card reaches THIS readout without a reload.
   *
   * The scope is a stable injected reference, so the subscription is set up once
   * per scope. `settingsRevision` is not read anywhere — bumping it is the whole
   * point, since `refreshIntervalMs` above is recomputed on every render.
   *
   * The gate above (`ComposerPointsGate`) already subscribes for its own two
   * switches, but a child does not re-render because its PARENT subscribed: this
   * component is mounted through that gate, so without its own subscription a
   * cadence change would only land on the next unrelated render.
   */
  const [, setSettingsRevision] = useState(0)
  useEffect(
    () => settingsScope?.subscribe(() => { setSettingsRevision(revision => revision + 1) }),
    [settingsScope],
  )

  const position = useAnchoredPosition({
    open: open && activeRegion !== undefined,
    anchorRef: rootRef,
    panelRef,
    side: 'top',
    gap: 8,
    margin: 12,
  })
  useDismissOnOutsidePointer(rootRef, open, setOpen, panelRef)

  const fetchUsage = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (inFlight.current || activeRegion === undefined) return
    inFlight.current = true
    try {
      const response = await fetch(withTraeRegion(TRAE_USAGE_PATH, activeRegion), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const value = await response.json() as TraeWebUsage
      if (!mounted.current || signal?.aborted === true) return
      usageRef.current = value
      setUsage(value)
      setLastRefresh(Date.now())
      setFailed(false)
    } catch {
      if (mounted.current && signal?.aborted !== true) setFailed(true)
    } finally {
      inFlight.current = false
    }
  }, [activeRegion])

  /**
   * Every account's general balance — one upstream read per account.
   *
   * Paid only while the panel is open (see the note at the top of this file).
   * A failure keeps whatever we already have rather than clearing it: a number
   * that went stale is better than a switch that vanished.
   */
  const fetchAccountCredits = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (activeRegion === undefined) return
    try {
      const response = await fetch(withTraeRegion(TRAE_ACCOUNT_CREDITS_PATH, activeRegion), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json() as { accounts?: unknown }
      if (!mounted.current || signal?.aborted === true) return
      if (Array.isArray(data.accounts)) setAccountCredits(data.accounts as TraeWebAccountCredit[])
    } catch {
      // Keep the previous rows: the table falls back to the usage document's
      // account list, so a failed figure must not remove the switch.
    }
  }, [activeRegion])

  // Fetch usage on mount and whenever the region changes, then keep it fresh.
  // The timer starts only after the first fetch settles, so a slow upstream
  // cannot stack overlapping reads.
  //
  // `refreshIntervalMs` is a dependency, so changing the cadence REPLACES the
  // timer: the cleanup below clears the old one and aborts its in-flight read
  // before the effect re-runs, which is what keeps a change from leaving two
  // loops ticking. It is read off the settings scope through the shared reader,
  // i.e. the same number the card's own poll uses.
  useEffect(() => {
    if (owned === undefined) return undefined
    let cancelled = false
    let timer: number | undefined
    const controller = new AbortController()
    void fetchUsage(controller.signal).finally(() => {
      if (cancelled) return
      timer = window.setInterval(() => { void fetchUsage(controller.signal) }, refreshIntervalMs)
    })
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
      controller.abort()
    }
  }, [owned, fetchUsage, refreshIntervalMs])

  /**
   * Every account's PLAN, one status read per account — ai only.
   *
   * Costs one upstream call per account, paid only while the panel is open (the
   * same rule the credit route follows). A failed read leaves that account's plan
   * undefined, which the row renders as a dash: the row still switches accounts,
   * which is the panel's primary job.
   */
  const fetchAccountPlans = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (activeRegion !== 'ai') return
    // Through the ref, not the state variable: see `usageRef` for why depending
    // on the object here turned this into a per-poll read.
    const document = usageRef.current
    const roster = document?.status === 'signed-in'
      ? document.accounts.filter(account => account.region === 'ai')
      : []
    if (roster.length === 0) { setAccountPlans({}); return }
    const entries = await Promise.all(roster.map(async account => {
      try {
        const response = await fetch(
          `${withTraeRegion(TRAE_ACCOUNT_STATUS_PATH, 'ai')}&accountId=${encodeURIComponent(account.id)}`,
          { headers: { accept: 'application/json' }, credentials: 'same-origin', ...signal === undefined ? {} : { signal } },
        )
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const state = await response.json() as TraeWebAccountState
        return [account.id, state.payStatus] as const
      } catch {
        return [account.id, undefined] as const
      }
    }))
    if (!mounted.current || signal?.aborted === true) return
    setAccountPlans(Object.fromEntries(entries))
  }, [activeRegion])

  // Per-account figures are read on OPEN, not on the 5-minute cycle.
  useEffect(() => {
    if (!open || activeRegion === undefined) return undefined
    const controller = new AbortController()
    if (activeRegion === 'ai') void fetchAccountPlans(controller.signal)
    else void fetchAccountCredits(controller.signal)
    return () => { controller.abort() }
  }, [open, activeRegion, fetchAccountCredits, fetchAccountPlans])

  // Escape closes the panel, matching the neighbouring popovers.
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

  /**
   * Switch to another account, then re-read both the usage document and the
   * table so the marker, the readout, and the panel all move together.
   *
   * The merge goes through the shared `configuredAccountsOf` helper (the card
   * uses the same one): writing only `[region]: id` would drop the other
   * region's selection. The write is read-back checked — `set()` resolving is
   * not proof it landed — so a refused write reports failure instead of
   * showing a marker on an account that was never selected.
   */
  const switchTo = async (accountId: string): Promise<void> => {
    if (settingsScope === undefined || settingsScope.getSnapshot().writable !== true) return
    if (activeRegion === undefined || switchingId !== undefined) return
    const currentId = accountCredits?.find(account => account.selected)?.id
      ?? (usage?.status === 'signed-in' ? usage.accountId : undefined)
    if (accountId === currentId) return
    setSwitchingId(accountId)
    setFailed(false)
    try {
      const configured = configuredAccountsOf(settingsScope.getSnapshot().value)
      const accepted = await settingsScope.set('accounts', { ...configured, [activeRegion]: accountId })
      const readBack = configuredAccountsOf(settingsScope.getSnapshot().value)
      if (accepted === false || readBack[activeRegion] !== accountId) {
        throw new Error('the Host did not persist the switch')
      }
      await fetchUsage()
      if (activeRegion === 'ai') await fetchAccountPlans()
      else await fetchAccountCredits()
    } catch {
      if (mounted.current) setFailed(true)
    } finally {
      if (mounted.current) setSwitchingId(undefined)
    }
  }

  /**
   * The header's settings control: open this plugin's page, then close.
   *
   * CLOSING IS PART OF THE JOB. The panel is portaled to `document.body` and
   * floats over the composer; opening the Settings dialog does not remove it, so
   * leaving it open would park a credits table on top of the dialog the user
   * just asked for. It is not reopened on return — a popover that comes back by
   * itself after navigation is a popover the user cannot get rid of.
   *
   * `false` (no route on this host) sets the panel's own error line rather than
   * doing nothing: a press that changes nothing on screen is indistinguishable
   * from a broken button, and the honest answer here is "this host has no way
   * there".
   */
  const openSettings = (): void => {
    const opened = onOpenSettings === undefined ? false : onOpenSettings()
    if (!opened) {
      setSettingsFailed(true)
      return
    }
    setSettingsFailed(false)
    setOpen(false)
  }

  /**
   * Run the pool's test batch, then re-read what it changed.
   *
   * The route is the SAME one the card's "测试勾选的账号" drives — it tests the
   * pool's checked-in members, not every account listed in this panel — and the
   * model comes from the Host's saved target rather than from here, so a press
   * cannot spend credits on a model the user did not choose. Same for the
   * outcome vocabulary and the NDJSON fold: both live in `./pool-test.ts` so the
   * card and this header cannot answer one batch two ways.
   *
   * The re-read afterwards is not a courtesy. The probes live in the USAGE
   * document (`usage.pool.accounts[].probe`), so the marks only move once that
   * document is fetched again; without it the press would leave the table
   * showing the state it just measured away.
   *
   * A failure keeps the previous measurements: nothing was learned about them,
   * and blanking the marks would look like the addresses had become unusable.
   */
  const testAccounts = async (): Promise<void> => {
    if (activeRegion === undefined || testingRef.current) return
    testingRef.current = true
    setTesting(true)
    setTestFailed(undefined)
    setTestNote(undefined)
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, POOL_TEST_TIMEOUT_MS)
    try {
      const response = await fetch(withTraePoolAction(activeRegion, 'test'), {
        method: 'POST',
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        signal: controller.signal,
      })
      let failure: string | undefined
      let sawAny = false
      /**
       * Counted by ACCOUNT ID, not by line.
       *
       * The route streams one `{row}` per account and then a `{rows}` summary
       * that repeats every one of them, so counting lines would report "4 / 2".
       * The summary is what guarantees a client that only reads the last line
       * still gets the whole batch, so it cannot simply be ignored.
       */
      const seen = new Map<string, string>()
      // Streamed: each finished account lands while the rest still run, so a
      // batch that takes a minute does not look like a dead button.
      for await (const line of testLinesOf(response)) {
        const used = applyTestLine(line, t, row => {
          seen.set(row.accountId, row.outcome)
        }, message => { failure = message })
        if (used) sawAny = true
      }
      if (!mounted.current) return
      if (failure !== undefined) {
        setTestFailed(failure)
        return
      }
      // A `200` that parsed into nothing would otherwise read as "all fine".
      if (!sawAny) throw new Error(t('row.poolLogGeneric'))
      const outcomes = [...seen.values()]
      setTestNote(t('composer.testDone', {
        ok: String(outcomes.filter(outcome => outcome === 'ok').length),
        total: String(outcomes.length),
      }))
    } catch {
      if (mounted.current && !controller.signal.aborted) setTestFailed(t('composer.testFailed'))
      // An ABORT is the deadline, not a transport failure, and it is worth
      // saying so: "跑太久放弃了" is actionable, "测试失败" is not.
      else if (mounted.current) setTestFailed(t('composer.testTimedOut'))
    } finally {
      clearTimeout(timer)
      testingRef.current = false
      if (mounted.current) setTesting(false)
      // Re-read AFTER the flags, and BOTH documents. The usage document carries
      // the marks (limited-until, reachable); the account-credits document is
      // where the table's FIGURES come from. Re-reading only the former left
      // the numbers in the table below still showing what they said before the
      // batch — the panel's whole point was that those numbers are stale.
      await Promise.all([fetchUsage(), fetchAccountCredits()])
    }
  }

  // Not this plugin's model: render nothing at all, so the composer row is
  // untouched while another provider is in use.
  //
  // The gate already filters, so in the shipped wiring this branch never fires.
  // It stays because this is a public component: a caller that forgets to check
  // must not get a Trae balance rendered next to another provider's model.
  if (owned === undefined) return null

  // The signed-out variant of the document carries none of the credit fields,
  // so read them only when the document is actually a signed-in one; reading
  // them off the union would be a type error and a runtime `undefined` for a
  // genuinely signed-out account.
  const signedIn = usage?.status === 'signed-in' ? usage : undefined
  const signedOut = usage !== undefined && usage.status === 'signed-out'
  const general = signedIn === undefined ? undefined : generalCreditsOf(signedIn)
  /**
   * What the readout shows after the separator.
   *
   * Region-dependent because the two sides answer different questions: CN has a
   * spendable balance, ai has a plan. Reading the credit field on an ai document
   * would always be `undefined` and print the dash this change exists to remove.
   */
  const valueText = activeRegion === 'ai'
    ? (signedIn?.payStatus === undefined
        ? '—'
        : planText(signedIn.payStatus, t))
    : general === undefined ? '—' : formatCredits(general)
  /**
   * The label before the separator. Per REGION, not one hardcoded 'Trae CN':
   * the international readout sat next to the wrong product name otherwise.
   */
  const label = activeRegion === 'ai' ? t('composer.pointsGlobal') : t('composer.points')

  /**
   * The table's rows: every account in this region, with its general balance.
   *
   * The endpoint's answer is authoritative (it carries the figures). Before it
   * lands — or if it fails — fall back to the usage document's account list so
   * the switches are reachable immediately, showing `—` for the figure rather
   * than a spinner the user has to wait on.
   */
  const selectedId = accountCredits?.find(account => account.selected)?.id
    ?? (signedIn === undefined ? undefined : signedIn.accountId)
  /**
   * The panel's rows.
   *
   * On ai the credit route is never read (it is CN-shaped), so the roster comes
   * from the usage document alone — which already lists every account in the
   * region with its selection, and is exactly what the panel needs to offer the
   * switch. On cn the credit route's answer is authoritative because it carries
   * the figures.
   */
  const sourceRows: TraeWebAccountCredit[] = activeRegion === 'ai'
    ? (signedIn === undefined
        ? []
        : signedIn.accounts
          .filter(account => account.region === 'ai')
          .map(account => ({ id: account.id, accountName: account.accountName, selected: account.selected })))
    : accountCredits
      ?? (signedIn === undefined
        ? []
        : signedIn.accounts
          .filter(account => account.region === activeRegion)
          .map(account => ({ id: account.id, accountName: account.accountName, selected: account.selected })))
  const rows: TraeWebAccountCredit[] = sourceRows.map(row => {
    // The bound account's balance is already in the usage document the readout
    // rendered, so fall back to it when the table request carried no figure.
    // Without this the row could show "—" while the trigger on the same screen
    // shows the number for the very same account — two answers to one question.
    if (row.id !== selectedId || row.generalAvailable !== undefined || general === undefined) return row
    return { ...row, generalAvailable: general }
  })
  const canSwitch = settingsScope !== undefined && settingsScope.getSnapshot().writable === true
  /**
   * This panel's account pool, when the Host reports one.
   *
   * A `pool` carrying no members is still a pool: the test button is drawn (the
   * Host answers 409 `no-members` and the panel says so) rather than hidden, so
   * the control's absence always means "this panel has no pool feature", never
   * "you have not checked anybody in yet".
   */
  const pool = signedIn?.pool

  return (
    <span ref={rootRef} className="dsm-trae-composer-points">
      <button
        type="button"
        className="dsm-trae-composer-points-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { setOpen(!open) }}
      >
        {label} · {valueText}
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className="dsm-trae-composer-panel"
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          aria-label={activeRegion === 'ai' ? t('composer.panelTitleGlobal') : t('composer.panelTitle')}
        >
          <div className="dsm-trae-composer-panel-head">
            <span className="dsm-trae-composer-panel-title">
              {activeRegion === 'ai' ? t('composer.panelTitleGlobal') : t('composer.panelTitle')}
            </span>
            {/* SETTINGS, not refresh (the owner's m01198), styled as the sibling
                `dsh-connect-workbuddy` styles its own — the same pill so the two
                connectors' popovers agree (m01930).
                The reader looking at this panel has a question — "where do I
                change this?" — and the answer should not require knowing that
                this plugin's page lives inside the wide Settings dialog. The
                balance itself no longer needs a button: it polls every five
                minutes, every account switch re-reads, and OPENING this panel
                re-reads too (see the open effect above), so the affordance the
                refresh button provided is still one click away.
                Not drawn when `onOpenSettings` is absent: a control that cannot
                do anything must not be drawn, the same rule the page header's
                back button follows. The WRAPPER stays either way, so the header
                layout is identical with and without the button. */}
            <span className="dsm-trae-composer-panel-actions">
              {/* THE POOL TEST BATCH (m02091), to the settings pill's LEFT.
                  Placed before it deliberately: settings is navigation and
                  belongs at the row's end, the way a dialog's close control
                  does; the test is an action on the table below, so it sits
                  nearer the figure it re-measures.

                  Only drawn when this panel actually HAS a pool. `usage.pool` is
                  absent on a Host that predates the feature, on an unconfigured
                  panel, and on the enterprise tab — in every one of those cases
                  the route answers 503/409 and the button could only ever
                  produce an error, so it is not drawn (the same rule the
                  settings pill follows for a host with no route).

                  The label reads 「刷新」/ "Refresh" at the owner's request. That
                  is the owner's word for the action, and the label is not the
                  place to argue with it — but it IS a label that under-describes
                  the press in two ways, so both live in the tooltip
                  (`composer.testHint`) and in the foot line instead:

                  1. SCOPE: it tests the pool's checked-in members, not the rows
                     on screen (the route only ever reads
                     `effectiveMemberAccountIds`).
                  2. COST: it is the only press in this plugin that SPENDS
                     credits — one minimal ping per member. A bare "Refresh"
                     reads as free, and this is not.

                  The label stays short for a measured reason too: the header is
                  222px inside a 248px popover and long labels do not wrap here,
                  they push the settings pill off the row. */}
              {pool === undefined
                ? null
                : (
                  <button
                    type="button"
                    className="dsm-trae-composer-panel-test"
                    title={t('composer.testHint')}
                    // The label is one word ("Refresh" / 「刷新」) and says nothing
                    // about scope or cost, so the accessible name carries the
                    // hint instead. `title` alone is not a name for a screen
                    // reader, and a button announced as bare "Refresh" next to a
                    // "Settings" is the ambiguity the hint exists to remove.
                    aria-label={t('composer.testHint')}
                    disabled={testing || switchingId !== undefined}
                    onClick={() => { void testAccounts() }}
                  >
                    {/* The same icon-plus-word shape the settings pill beside it
                        uses, so the header reads as one family rather than a
                        pill next to a bare word. A circular arrow, though, not a
                        gear: this one re-runs the batch, it does not navigate.
                        `aria-hidden` for the same reason as the gear — the
                        button's own text already names it. */}
                    <svg
                      className={testing
                        ? 'dsm-trae-composer-panel-test-icon dsm-trae-composer-panel-test-icon-spin'
                        : 'dsm-trae-composer-panel-test-icon'}
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      fill="none"
                      aria-hidden="true"
                      focusable="false"
                    >
                      {/* Drawn in the SAME 16-unit grid with the same 1.5px stroke
                          as the gear beside it: a 24-unit grid scaled to 12px
                          halves the stroke and the arc renders as a grey smudge
                          next to the crisp gear. One icon family, one grid. */}
                      <path
                        d="M13.4 8a5.4 5.4 0 1 1-5.4-5.4c1.5 0 2.95.62 3.96 1.63L13.4 5.6"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M13.4 2.6v3h-3"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="dsm-trae-composer-panel-test-label">
                      {testing ? t('composer.testing') : t('composer.test')}
                    </span>
                  </button>
                )}
              {onOpenSettings === undefined
                ? null
                : (
                  <button
                    type="button"
                    className="dsm-trae-composer-panel-settings"
                    title={t('composer.openSettingsHint')}
                    disabled={switchingId !== undefined}
                    onClick={openSettings}
                  >
                    {/* A gear, because the label is one word and a one-word
                        underlined link reads as body text that happens to be
                        clickable. `aria-hidden`: the button's own text already
                        names it, so the icon must not be announced twice. */}
                    <svg
                      className="dsm-trae-composer-panel-settings-icon"
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      fill="none"
                      aria-hidden="true"
                      focusable="false"
                    >
                      {/* 1.5px stroke, not 1.3: at 11px the gear's teeth blur
                          into a grey disc and the icon reads as a smudge next to
                          the label. 12px + 1.5 keeps them legible — the shape is
                          the affordance. */}
                      <path
                        d="M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <path
                        d="M12.9 9.6a1.2 1.2 0 0 0 .24 1.32l.04.04a1.4 1.4 0 1 1-1.98 1.98l-.04-.04a1.2 1.2 0 0 0-1.32-.24 1.2 1.2 0 0 0-.72 1.1v.12a1.4 1.4 0 1 1-2.8 0v-.07a1.2 1.2 0 0 0-.78-1.1 1.2 1.2 0 0 0-1.32.24l-.04.04a1.4 1.4 0 1 1-1.98-1.98l.04-.04a1.2 1.2 0 0 0 .24-1.32 1.2 1.2 0 0 0-1.1-.72h-.12a1.4 1.4 0 1 1 0-2.8h.07a1.2 1.2 0 0 0 1.1-.78 1.2 1.2 0 0 0-.24-1.32l-.04-.04a1.4 1.4 0 1 1 1.98-1.98l.04.04a1.2 1.2 0 0 0 1.32.24h.05a1.2 1.2 0 0 0 .72-1.1v-.12a1.4 1.4 0 1 1 2.8 0v.07a1.2 1.2 0 0 0 .72 1.1 1.2 1.2 0 0 0 1.32-.24l.04-.04a1.4 1.4 0 1 1 1.98 1.98l-.04.04a1.2 1.2 0 0 0-.24 1.32v.05a1.2 1.2 0 0 0 1.1.72h.12a1.4 1.4 0 1 1 0 2.8h-.07a1.2 1.2 0 0 0-1.1.72Z"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="dsm-trae-composer-panel-settings-label">
                      {t('composer.openSettings')}
                    </span>
                  </button>
                )}
            </span>
          </div>
          {signedOut
            ? <p className="dsm-trae-composer-panel-empty">{t('composer.signedOut')}</p>
            : rows.length === 0
              ? <p className="dsm-trae-composer-panel-empty">{t('composer.noAccounts')}</p>
              : (
                <table className="dsm-trae-composer-panel-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('composer.account')}</th>
                      {/* On ai the figure in this column is the PLAN, not a
                          balance: the international document has no `credits`
                          at all. A header reading 「通用积分」 above the word
                          `Pro` would name the wrong quantity. */}
                      <th scope="col" className="dsm-trae-composer-panel-num">
                        {activeRegion === 'ai' ? t('composer.plan') : t('composer.generalCredits')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(row => {
                      const current = row.id === selectedId
                      return (
                        <tr key={row.id} className={current ? 'dsm-trae-composer-panel-row-current' : undefined}>
                          <th scope="row">
                            <button
                              type="button"
                              className="dsm-trae-composer-panel-switch"
                              disabled={!canSwitch || switchingId !== undefined || current}
                              aria-label={t('composer.switchTo', { account: row.accountName })}
                              onClick={() => { void switchTo(row.id) }}
                            >
                              <span className="dsm-trae-composer-panel-dot" aria-hidden="true" />
                              {row.accountName}
                            </button>
                          </th>
                          <td className="dsm-trae-composer-panel-num">
                            {activeRegion === 'ai'
                              ? (() => {
                                  const payStatus = row.id === selectedId && signedIn?.payStatus !== undefined
                                    ? signedIn.payStatus
                                    : accountPlans?.[row.id]
                                  return payStatus === undefined ? '—' : planText(payStatus, t)
                                })()
                              : row.generalAvailable === undefined ? '—' : formatCredits(row.generalAvailable)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
          {/* Credit about to lapse. This panel is where the balance is actually
              read, so it is where "some of that balance is about to disappear"
              belongs — but only for the CN shape: the international document
              carries a plan, not packs, so it has no per-pack expiry at all.

              GUARD ON THE NOTICE, NOT ON THE DOCUMENT. `credits.expiry` being
              present only means upstream sent the four buckets; every one of
              them can be empty (`packs: 0`), and then `expiryNotice()` returns
              `undefined` because there is no horizon, no amount and no pack
              count to report. Keying the render on the object drew an EMPTY
              bordered box between the table and 「最近刷新」 — visible in the
              reported screenshot as a blank rectangle with nothing in it. A
              warning with nothing to warn about is not a warning.

              Rendering is now driven by the same call that produces the copy,
              so "there is a box" and "there is a sentence" cannot disagree. */}
          {activeRegion === 'cn' && expiryNoticeOf(signedIn) !== undefined
            ? <div className={`dsm-trae-expiry ${expiryToneClass(expiryNoticeOf(signedIn)!.tier)}`} role="status">
                <span>{expiryMessageOf(signedIn!.credits!.expiry!, t)}</span>
                {expiryNoticeOf(signedIn)!.soonestExpiresAtMs === undefined
                  ? null
                  : <span className="dsm-trae-expiry-detail">
                      {t('row.expiryEarliest', { time: formatDateTime(expiryNoticeOf(signedIn)!.soonestExpiresAtMs!) })}
                    </span>}
              </div>
            : null}
          <div className="dsm-trae-composer-panel-foot">
            <span>
              {t('composer.lastRefresh')} {lastRefresh === undefined ? '—' : formatClock(lastRefresh)}
            </span>
          </div>
          {failed ? <p className="dsm-trae-composer-panel-error" role="status">{t('composer.refreshFailed')}</p> : null}
          {settingsFailed
            ? <p className="dsm-trae-composer-panel-error" role="status">{t('composer.openSettingsFailed')}</p>
            : null}
          {/* The batch's own two lines, kept apart from the read failure above
              and from the settings failure: three different failures rendered
              into one slot would take turns overwriting each other's reason. */}
          {testNote === undefined
            ? null
            : <p className="dsm-trae-composer-panel-note" role="status">{testNote}</p>}
          {testFailed === undefined
            ? null
            : <p className="dsm-trae-composer-panel-error" role="status">{testFailed}</p>}
        </div>,
        document.body,
      )}
    </span>
  )
}