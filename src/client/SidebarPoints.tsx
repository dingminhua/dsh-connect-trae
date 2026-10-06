/**
 * Compact credit line contributed to the DSH main sidebar foot
 * (`sidebar.footer.action`).
 *
 * Mounted only while the plugin-card switch `showPointsInMainUi` is on, so the
 * slot renders nothing when the feature is off. On mount it fetches the bound
 * CN account's remaining credits ONCE and only then starts the periodic
 * refresh timer; the timer is cleared on unmount (switch off / plugin unload),
 * so timers never stack.
 *
 * A failed refresh keeps the last known value and surfaces a short failure
 * note; an in-flight refresh ignores further clicks (debounce).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { TRAE_USAGE_PATH, withTraeRegion } from '../status-paths.ts'
import type { TraeWebUsage } from '../status-paths.ts'
import type { TraeSettingsKey } from './locales.ts'
import { TRAE_SIDEBAR_CSS } from './styles.ts'

/**
 * Automatic refresh period. The first fetch happens immediately on enable;
 * this is the gap between subsequent automatic fetches.
 *
 * Five minutes, not the card's 60s: a credit balance moves on the scale of
 * model calls, not seconds, and this line is a glanceable reminder rather than
 * a live meter. Each poll is two read-only upstream calls, so a tighter period
 * would buy nothing a user can act on.
 */
export const SIDEBAR_POINTS_REFRESH_INTERVAL_MS = 300_000

/** Localized copy injected by the browser-plugin registration. */
export interface SidebarPointsInjected {
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string
}

/**
 * Props delivered by the `sidebar.footer.action` list slot. The shell passes
 * only its column state (`wide`); everything else comes from the private
 * inject face.
 */
/**
 * Props. The line is only ever mounted in the EXPANDED column: the gate drops it
 * while the sidebar is collapsed (56px rail), so no width variant is needed.
 */
export type SidebarPointsProps = Partial<SidebarPointsInjected>

/** Inject the sidebar-line CSS once. */
if (typeof document !== 'undefined') {
  const cssId = 'dsh-connect-trae/sidebar.css'
  if (!document.querySelector(`style[data-plugin-css="${cssId}"]`)) {
    const styleTag = document.createElement('style')
    styleTag.dataset.plugin = 'dsh-connect-trae'
    styleTag.dataset.pluginCss = cssId
    styleTag.textContent = TRAE_SIDEBAR_CSS
    document.head.appendChild(styleTag)
  }
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

function formatClock(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(value))
}

/**
 * The GENERAL credit balance out of one usage-route document.
 *
 * Deliberately `generalAvailable`, NOT `credits.available`. The latter is the
 * upstream aggregate (`summary.totalAmount - consumedAmount`), while the card
 * shows two buckets derived from the entitlement packs; the aggregate is not
 * guaranteed to equal the buckets, and a sidebar number the user cannot match
 * against the card is worse than no number at all. The general bucket is the
 * one the SOLO chat path spends, so it is the one worth watching.
 */
function generalCreditsOf(usage: TraeWebUsage): number | undefined {
  if (usage.status !== 'signed-in') return undefined
  // CN accounts carry `credits`; international accounts carry `payStatus`
  // instead and have no credit number to show here.
  return usage.credits?.generalAvailable
}

/** One fetch+render cycle. Returns false when the request failed. */
export function SidebarPoints({ t }: SidebarPointsProps) {
  if (t === undefined) throw new Error('Sidebar points line requires its translation function')
  const [points, setPoints] = useState<number | undefined>(undefined)
  const [signedIn, setSignedIn] = useState(true)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<number | undefined>(undefined)
  /** True while a request is in flight; debounces repeated refresh clicks. */
  const inFlight = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const fetchPoints = useCallback(async (signal?: AbortSignal): Promise<boolean> => {
    // Debounce: a click while a refresh is running is ignored, never queued.
    if (inFlight.current) return false
    inFlight.current = true
    if (mounted.current) setBusy(true)
    try {
      const response = await fetch(withTraeRegion(TRAE_USAGE_PATH, 'cn'), {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const value = await response.json() as TraeWebUsage
      if (!mounted.current || signal?.aborted === true) return true
      const general = generalCreditsOf(value)
      if (general !== undefined) {
        setPoints(general)
        setSignedIn(true)
      } else {
        setSignedIn(value.status === 'signed-in')
      }
      setFailed(false)
      setLastRefresh(Date.now())
      return true
    } catch {
      // Keep the previous value; only flag the failure for the small note.
      if (mounted.current && signal?.aborted !== true) setFailed(true)
      return false
    } finally {
      inFlight.current = false
      if (mounted.current) setBusy(false)
    }
  }, [])

  // Immediate fetch first; the periodic timer starts ONLY after that first
  // fetch settles. Both the interval and any in-flight request are cleared on
  // unmount (switch off / plugin unload), so timers never stack.
  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const controller = new AbortController()
    void fetchPoints(controller.signal).finally(() => {
      if (cancelled) return
      timer = window.setInterval(() => { void fetchPoints(controller.signal) }, SIDEBAR_POINTS_REFRESH_INTERVAL_MS)
    })
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
      controller.abort()
    }
  }, [fetchPoints])

  const titleText = lastRefresh === undefined
    ? undefined
    : t('sidebar.lastRefresh', { time: formatClock(lastRefresh) })
  const valueText = !signedIn
    ? t('sidebar.signedOut')
    : points === undefined
      ? '—'
      : formatNumber(points)

  return (
    <div className="dsm-trae-sidebar-points" title={titleText}>
      <span className="dsm-trae-sidebar-points-line">
        <span className="dsm-trae-sidebar-points-text" aria-live="polite">
          {t('sidebar.points')}：{valueText}
        </span>
        {failed
          ? <span className="dsm-trae-sidebar-points-failed" role="status">{t('sidebar.refreshFailed')}</span>
          : null}
      </span>
      <button
        type="button"
        className="dsm-trae-sidebar-points-refresh"
        disabled={busy}
        aria-label={busy ? t('sidebar.refreshing') : t('sidebar.refresh')}
        title={busy ? t('sidebar.refreshing') : t('sidebar.refresh')}
        onClick={() => { void fetchPoints() }}
      >
        {busy ? t('sidebar.refreshing') : t('sidebar.refresh')}
      </button>
    </div>
  )
}
