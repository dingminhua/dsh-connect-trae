/**
 * Decides whether the composer credit readout belongs in this session, by
 * reading the Host's own `modelSelection` projection and the plugin's
 * `showPointsInMainUi` switch.
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
 *
 * The switch is read the same way the retired sidebar gate read it: absent or
 * false means OFF, and only an explicit `true` shows the readout. The composer
 * row is shared with the shell's own permission/agent/model controls, so the
 * readout must be asked for, not imposed — 2.13.0 rendered it unconditionally
 * and 2.13.3 restored the opt-in after the user went looking for the switch.
 */
import { useEffect, useState } from 'react'
import { ComposerPoints, TRAE_COMPOSER_PROVIDERS } from './ComposerPoints.tsx'
import { unwrapVolatileDeep } from '../status-paths.ts'
import type { TraeSettingsKey } from './locales.ts'
import type { TraeUsageCardInjected } from './TraeUsageCard.tsx'

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

/**
 * Read the composer-readout switch out of a committed settings snapshot.
 *
 * Absent means OFF, matching the host default (`false`): a scope that has not
 * populated yet, or a host too old to serve the field, must not put a row in
 * the composer toolbar that the user never asked for.
 */
export function composerPointsEnabledOf(scope: TraeUsageCardInjected['settingsScope']): boolean {
  if (scope === undefined) return false
  const value = unwrapVolatileDeep(scope.getSnapshot().value) as { showPointsInMainUi?: unknown } | undefined
  return value?.showPointsInMainUi === true
}

export interface ComposerPointsGateProps {
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string
  /** Settings scope from the configForms mirror; the card writes the same field. */
  settingsScope?: TraeUsageCardInjected['settingsScope']
  /**
   * Standard slot hook: reads one Host-computed projection for this session.
   * Injected by the slot, so it is absent when this gate is rendered directly
   * from a test.
   */
  useProjection?: (key: 'modelSelection') => unknown
}

export function ComposerPointsGate(props: ComposerPointsGateProps) {
  const { t, settingsScope, useProjection } = props
  // Follow the switch so ticking the card checkbox appears without a remount.
  // The two hooks are unconditional; `settingsScope` is a stable injected
  // reference, so the subscription is set up once per scope.
  const [enabled, setEnabled] = useState(() => composerPointsEnabledOf(settingsScope))
  useEffect(
    () => settingsScope?.subscribe(() => { setEnabled(composerPointsEnabledOf(settingsScope)) }),
    [settingsScope],
  )
  // The projection hook is optional so the gate can be rendered in a test
  // without a Host; the fallback is handled by the result, not the call count.
  const projection = useProjection === undefined
    ? undefined
    : useProjection('modelSelection') as ModelSelectionProjectionLike | undefined

  // The switch is off (or the scope has not landed): render NOTHING, so the
  // shared composer row is untouched and no fetch loop starts.
  if (!enabled) return null

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