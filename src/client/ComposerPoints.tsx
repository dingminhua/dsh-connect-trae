/**
 * Credit readout for the composer tool row (`conversation.input.left`).
 *
 * Shows the bound CN account's general credit balance, but ONLY while the
 * session's selected model belongs to this plugin. That condition is the whole
 * point: the sidebar foot is a single shared row, so two connector plugins each
 * parking a line there end up fighting for the same space (the observed result
 * was this plugin's line collapsed to a clipped "Tr" beside
 * dsh-connect-workbuddy's two rows). The composer row is per-session and
 * provider-scoped, so exactly one plugin's credits are relevant at a time and
 * nothing overlaps.
 *
 * The provider comes from the Host's own `modelSelection` projection rather
 * than from anything this plugin tracks: the projection is what the model
 * picker writes and what the next request will use, so the readout cannot
 * disagree with the model actually in effect. `next` wins over `lastUsed`
 * because a switch that has been made but not yet sent is still what the user
 * sees selected in the composer.
 *
 * Rendered as one compact control: the number and a refresh icon. No label, no
 * second button — the composer row is shared with the permission, agent and
 * model controls, so this must stay narrow.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
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

export function ComposerPoints(props: ComposerPointsProps) {
  const { t, provider, region } = props
  if (t === undefined) throw new Error('Composer points readout requires its translation function')
  const owned = provider === undefined ? undefined : TRAE_COMPOSER_PROVIDERS[provider]
  const activeRegion = region ?? owned

  const [points, setPoints] = useState<number | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const fetchPoints = useCallback(async (signal?: AbortSignal): Promise<void> => {
    // Debounce: a click while a refresh is running is ignored, never queued.
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
      const general = generalCreditsOf(value)
      if (general !== undefined) setPoints(general)
      setFailed(false)
    } catch {
      // Keep the previous value; only flag the failure.
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
    void fetchPoints(controller.signal).finally(() => {
      if (cancelled) return
      timer = window.setInterval(() => { void fetchPoints(controller.signal) }, COMPOSER_POINTS_REFRESH_INTERVAL_MS)
    })
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearInterval(timer)
      controller.abort()
    }
  }, [owned, fetchPoints])

  // Not this plugin's model: render nothing at all, so the composer row is
  // untouched while another provider is in use.
  //
  // The gate already filters, so in the shipped wiring this branch never fires.
  // It stays because this is a public component: a caller that forgets to check
  // must not get a Trae balance rendered next to another provider's model. The
  // effect above bails on the same condition, so no fetch loop starts either.
  if (owned === undefined) return null

  const valueText = points === undefined ? '—' : formatCredits(points)
  const label = t('composer.points')

  return (
    <div className="dsm-trae-composer-points" title={failed ? t('composer.refreshFailed') : undefined}>
      <span className="dsm-trae-composer-points-text" aria-live="polite">
        {label} {valueText}
      </span>
      <button
        type="button"
        className="dsm-trae-composer-points-refresh"
        disabled={busy}
        aria-label={busy ? t('composer.refreshing') : t('composer.refresh')}
        title={busy ? t('composer.refreshing') : t('composer.refresh')}
        onClick={() => { void fetchPoints() }}
      >
        {/* A refresh glyph, not the word: the row is shared and must stay narrow. */}
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path
            d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5V5.5H10.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}