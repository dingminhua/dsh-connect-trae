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
 * The row itself is a bare clickable readout — `Trae CN · 3,392` — with NO
 * refresh control. Clicking it opens an anchored panel (the same interaction as
 * the neighbouring "Expert" control): account name, the Work and general
 * buckets, and the manual refresh button. Keeping the action out of the row is
 * deliberate: the row is shared with the permission, agent and model controls
 * and must stay narrow, while the panel has room to explain the number.
 *
 * The provider comes from the Host's own `modelSelection` projection rather
 * than from anything this plugin tracks: the projection is what the model
 * picker writes and what the next request will use, so the readout cannot
 * disagree with the model actually in effect.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition, useDismissOnOutsidePointer } from './popover.ts'
import { TRAE_USAGE_PATH, withTraeRegion } from '../status-paths.ts'
import type { TraeWebUsage } from '../status-paths.ts'
import type { TraeRegion } from '../region.ts'
import type { TraeSettingsKey } from './locales.ts'

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
}

/**
 * Provider routes this plugin owns, mapped to the region whose credits apply.
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

function formatClock(value: number): string {
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export function ComposerPoints(props: ComposerPointsProps) {
  const { t, provider, region } = props
  if (t === undefined) throw new Error('Composer points readout requires its translation function')
  const owned = provider === undefined ? undefined : TRAE_COMPOSER_PROVIDERS[provider]
  const activeRegion = region ?? owned

  const [usage, setUsage] = useState<TraeWebUsage | undefined>(undefined)
  const [busy, setBusy] = useState(false)
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

  // Fetch on mount and whenever the region changes, then keep it fresh. The
  // timer starts only after the first fetch settles, so a slow upstream cannot
  // stack overlapping reads.
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

  // Escape closes the panel, matching the neighbouring popovers.
  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [open])

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
  const work = signedIn?.credits?.workAvailable
  const accountName = signedIn?.accountName
  const signedOut = usage !== undefined && usage.status === 'signed-out'
  const valueText = general === undefined ? '—' : formatCredits(general)
  const label = t('composer.points')

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
              className="dsm-btn dsm-btn-outline dsm-trae-composer-panel-refresh"
              disabled={busy}
              onClick={() => { void fetchUsage() }}
            >
              {busy ? t('composer.refreshing') : t('composer.refresh')}
            </button>
          </div>
          {signedOut
            ? <p className="dsm-trae-composer-panel-empty">{t('composer.signedOut')}</p>
            : (
              <dl className="dsm-trae-composer-panel-grid">
                <dt>{t('composer.account')}</dt>
                <dd>{accountName ?? '—'}</dd>
                <dt>{t('composer.workCredits')}</dt>
                <dd>{work === undefined ? '—' : formatCredits(work)}</dd>
                <dt>{t('composer.generalCredits')}</dt>
                <dd>{general === undefined ? '—' : formatCredits(general)}</dd>
                <dt>{t('composer.lastRefresh')}</dt>
                <dd>{lastRefresh === undefined ? '—' : formatClock(lastRefresh)}</dd>
              </dl>
            )}
          {failed ? <p className="dsm-trae-composer-panel-error" role="status">{t('composer.refreshFailed')}</p> : null}
        </div>,
        document.body,
      )}
    </span>
  )
}