/**
 * Decides whether the composer credit readout belongs in this session, by
 * reading the Host's own `modelSelection` projection.
 *
 * Kept separate from {@link ComposerPoints} (and from the browser-plugin entry)
 * so the decision can be unit-tested without a Host: the entry imports
 * browser-only DSH packages the test environment cannot load, while this module
 * depends only on React and a narrow projection shape.
 *
 * WHY the projection rather than this plugin's own state: the projection is
 * what the model picker writes and what the next request will use, so the
 * readout cannot disagree with the model actually in effect. `next` outranks
 * `lastUsed` because a selection that has been made but not yet sent is still
 * what the composer shows the user.
 */
import { ComposerPoints, TRAE_COMPOSER_PROVIDERS } from './ComposerPoints.tsx'
import type { TraeSettingsKey } from './locales.ts'

/** The slice of the `modelSelection` projection this decision needs. */
export interface ModelSelectionProjectionLike {
  lastUsed?: { provider?: unknown } | null
  next?: { provider?: unknown } | null
}

/**
 * The provider route the session is currently pointed at.
 *
 * `next` wins over `lastUsed`: a switch that has landed but not yet been sent
 * is still the selection the composer displays.
 */
export function selectedProviderOf(projection: ModelSelectionProjectionLike | undefined): string | undefined {
  const candidate = projection?.next ?? projection?.lastUsed
  const provider = candidate?.provider
  return typeof provider === 'string' && provider !== '' ? provider : undefined
}

export interface ComposerPointsGateProps {
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string
  /**
   * Standard slot hook: reads one Host-computed projection for this session.
   * Injected by the slot, so it is absent when this gate is rendered directly
   * from a test.
   */
  useProjection?: (key: 'modelSelection') => unknown
}

export function ComposerPointsGate(props: ComposerPointsGateProps) {
  const { t, useProjection } = props
  // The hook is optional so the gate can be rendered in a test without a Host.
  // Calling it conditionally would break the rules of hooks, so the call itself
  // is unconditional and the fallback is handled by the result.
  const projection = useProjection === undefined
    ? undefined
    : useProjection('modelSelection') as ModelSelectionProjectionLike | undefined

  const provider = selectedProviderOf(projection)
  const region = provider === undefined ? undefined : TRAE_COMPOSER_PROVIDERS[provider]
  // ONE decision, taken here: this plugin owns the provider, or nothing renders.
  // `region` is the ownership test itself (the map only holds routes this plugin
  // registers), so it is the single source of truth for both the render and the
  // region whose credits are read — no second copy of the rule to drift.
  if (region === undefined) return null

  // `region` is non-undefined here, and it is derived from `provider`, so the
  // provider is present too; the assertion states that rather than widening the
  // component's prop to accept an absent provider it never sees.
  return <ComposerPoints t={t} provider={provider as string} region={region} />
}