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
 * refresh control. Clicking it opens an anchored panel: a TABLE with one row
 * per account in the region and that account's general balance, where a row
 * click switches to it. The manual refresh button lives in the panel too.
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
import { planText } from './plan-text.ts'
import type { TraeWebAccountCredit, TraeWebAccountState, TraeWebCreditExpiry, TraeWebPayStatus, TraeWebUsage } from '../status-paths.ts'
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
 * Automatic refresh period. Five minutes, matching the sidebar line: a credit
 * balance moves on the scale of model calls, not seconds, and each read is two
 * read-only upstream calls.
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
  const { t, provider, region, settingsScope } = props
  if (t === undefined) throw new Error('Composer points readout requires its translation function')
  const owned = provider === undefined ? undefined : TRAE_COMPOSER_PROVIDERS[provider]
  const activeRegion = region ?? owned

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
  const [busy, setBusy] = useState(false)
  const [switchingId, setSwitchingId] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
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
    if (mounted.current) setBusy(true)
    try {
      const response = await fetch(withTraeRegion(TRAE_USAGE_PATH, activeRegion), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const value = await response.json() as TraeWebUsage
      if (!mounted.current || signal?.aborted === true) return
      setUsage(value)
      setLastRefresh(Date.now())
      setFailed(false)
    } catch {
      if (mounted.current && signal?.aborted !== true) setFailed(true)
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
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
  useEffect(() => {
    if (owned === undefined) return undefined
    let cancelled = false
    let timer: number | undefined
    const controller = new AbortController()
    void fetchUsage(controller.signal).finally(() => {
      if (cancelled) return
      timer = window.setInterval(() => { void fetchUsage(controller.signal) }, COMPOSER_POINTS_REFRESH_INTERVAL_MS)
    })
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
      controller.abort()
    }
  }, [owned, fetchUsage])

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
    const roster = usage?.status === 'signed-in'
      ? usage.accounts.filter(account => account.region === 'ai')
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
  }, [activeRegion, usage])

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
            <button
              type="button"
              className="dsm-trae-composer-panel-refresh"
              disabled={busy || switchingId !== undefined}
              onClick={() => { void fetchUsage() }}
            >
              {busy ? t('composer.refreshing') : t('composer.refresh')}
            </button>
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
              carries a plan, not packs, so it has no per-pack expiry at all. */}
          {activeRegion === 'cn' && signedIn?.credits?.expiry !== undefined
            ? <div className={`dsm-trae-expiry ${expiryToneClass(expiryNotice(signedIn.credits.expiry)?.tier ?? 'lapsed')}`} role="status">
                <span>{expiryMessageOf(signedIn.credits.expiry, t)}</span>
                {soonestExpiryOf(signedIn.credits.expiry) === undefined
                  ? null
                  : <span className="dsm-trae-expiry-detail">
                      {t('row.expiryEarliest', { time: formatDateTime(soonestExpiryOf(signedIn.credits.expiry)!) })}
                    </span>}
              </div>
            : null}
          <div className="dsm-trae-composer-panel-foot">
            <span>
              {t('composer.lastRefresh')} {lastRefresh === undefined ? '—' : formatClock(lastRefresh)}
            </span>
          </div>
          {failed ? <p className="dsm-trae-composer-panel-error" role="status">{t('composer.refreshFailed')}</p> : null}
        </div>,
        document.body,
      )}
    </span>
  )
}