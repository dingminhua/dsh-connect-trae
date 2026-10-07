/**
 * Credit readout for the composer tool row (`conversation.input.left`).
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
  TRAE_USAGE_PATH,
  configuredAccountsOf,
  withTraeRegion,
} from '../status-paths.ts'
import { COMPOSER_POINTS_CSS } from './styles.ts'
import type { TraeWebAccountCredit, TraeWebUsage } from '../status-paths.ts'
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
 * Provider routes whose credit balance this readout can show, mapped to the
 * region to read it from.
 *
 * CN ONLY, and the restriction is the data's, not a preference: the Host builds
 * the international region's usage document from `payStatus` and never sets
 * `credits` on it (`webStatusFor` returns early for `region === 'ai'`), because
 * that side is subscription-based and has no comparable balance. Mapping
 * `trae-global` here would render the hardcoded "Trae CN" label next to a dash
 * — a number-slot with no number — while an international model is selected.
 *
 * Mirrors the CN half of `TRAE_PROVIDERS` on the host side; duplicated here
 * because the client bundle must not import the host entry.
 */
export const TRAE_COMPOSER_PROVIDERS: Readonly<Record<string, TraeRegion>> = {
  'trae': 'cn',
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

function formatClock(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function ComposerPoints(props: ComposerPointsProps) {
  const { t, provider, region, settingsScope } = props
  if (t === undefined) throw new Error('Composer points readout requires its translation function')
  const owned = provider === undefined ? undefined : TRAE_COMPOSER_PROVIDERS[provider]
  const activeRegion = region ?? owned

  const [usage, setUsage] = useState<TraeWebUsage | undefined>(undefined)
  const [accountCredits, setAccountCredits] = useState<TraeWebAccountCredit[] | undefined>(undefined)
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

  // Per-account figures are read on OPEN, not on the 5-minute cycle.
  useEffect(() => {
    if (!open || activeRegion === undefined) return undefined
    const controller = new AbortController()
    void fetchAccountCredits(controller.signal)
    return () => { controller.abort() }
  }, [open, activeRegion, fetchAccountCredits])

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
      await fetchAccountCredits()
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
  const general = signedIn === undefined ? undefined : generalCreditsOf(signedIn)
  const signedOut = usage !== undefined && usage.status === 'signed-out'
  const valueText = general === undefined ? '—' : formatCredits(general)
  const label = t('composer.points')

  /**
   * The table's rows: every account in this region, with its general balance.
   *
   * The endpoint's answer is authoritative (it carries the figures). Before it
   * lands — or if it fails — fall back to the usage document's account list so
   * the switches are reachable immediately, showing `—` for the figure rather
   * than a spinner the user has to wait on.
   */
  const rows: TraeWebAccountCredit[] = accountCredits
    ?? (signedIn === undefined
      ? []
      : signedIn.accounts
        .filter(account => account.region === activeRegion)
        .map(account => ({ id: account.id, accountName: account.accountName, selected: account.selected })))
  const selectedId = accountCredits?.find(account => account.selected)?.id
    ?? (signedIn === undefined ? undefined : signedIn.accountId)
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
          aria-label={t('composer.panelTitle')}
        >
          <div className="dsm-trae-composer-panel-head">
            <span className="dsm-trae-composer-panel-title">{t('composer.panelTitle')}</span>
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
                      <th scope="col" className="dsm-trae-composer-panel-num">{t('composer.generalCredits')}</th>
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
                            {row.generalAvailable === undefined ? '—' : formatCredits(row.generalAvailable)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
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