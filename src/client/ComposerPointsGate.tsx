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
 *
 * WHY THERE IS A SECOND SEAT (learned from dsh-connect-workbuddy issue #62).
 * That row is a LIST seat, so it is shared not only with the shell's own
 * controls but with any other plugin that registers there — and one report is
 * exactly that: with a third-party plugin installed the readout stopped
 * appearing. A list seat cannot promise that every occupant is visible, so the
 * seat becomes the USER's choice: `composer` (default, unchanged for anyone who
 * does not choose) or `stats`, the ambient dock below the composer card where
 * the shell renders its own round/step/token pills. This plugin has already
 * lost this readout once to a shared seat — it used to live at the sidebar
 * foot, where it was clipped to "Tr" beside dsh-connect-workbuddy's rows.
 *
 * The gate is registered in BOTH seats and renders in the one the setting
 * names, which keeps the decision in ONE function instead of re-registering
 * slots when the setting changes — and this repository already documents that
 * kind of binding as fragile (the rc.6→rc.7 `id`/`order` → `key`/`priority`
 * rename). Registration is unconditional; only the render is conditional.
 */
import { useEffect, useState } from 'react'
import { ComposerPoints, TRAE_COMPOSER_PROVIDERS } from './ComposerPoints.tsx'
import { regionCreditPositionOf, regionEnabledOf, unwrapVolatileDeep } from '../status-paths.ts'
import type { TraeCreditPosition } from '../status-paths.ts'
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
 * The settings tree this plugin writes, unwrapped to a plain object.
 *
 * `unwrapVolatileDeep` first: on DSH 0.1.7 the scope's value is a live
 * cosmokit reference, and reading a field off it without unwrapping yields a
 * proxy whose `===` comparison against a string is false — which would make the
 * seat test below reject EVERY seat and silently hide the readout.
 */
function scopeValueOf(scope: TraeUsageCardInjected['settingsScope']): unknown {
  return scope === undefined ? undefined : unwrapVolatileDeep(scope.getSnapshot().value)
}

/**
 * Read the composer-readout switch out of a committed settings snapshot.
 *
 * Absent means OFF, matching the host default (`false`): a scope that has not
 * populated yet, or a host too old to serve the field, must not put a row in
 * the composer toolbar that the user never asked for.
 */
export function composerPointsEnabledOf(scope: TraeUsageCardInjected['settingsScope']): boolean {
  const value = scopeValueOf(scope) as { showPointsInMainUi?: unknown } | undefined
  return value?.showPointsInMainUi === true
}

export interface ComposerPointsGateProps {
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string
  /**
   * WHICH seat this registration occupies (learned from workbuddy #62).
   *
   * The component is registered once per seat and renders only in the seat the
   * setting names, so switching seats is a settings write rather than a slot
   * re-registration. Absent means `composer` — the only seat before the setting
   * existed, which keeps every existing caller and test on the old behaviour.
   */
  position?: TraeCreditPosition
  /** Settings scope from the configForms mirror; the card writes the same field. */
  settingsScope?: TraeUsageCardInjected['settingsScope']
  /**
   * Route to this plugin's settings page, for the panel header's control.
   * Absent in tests and on a caller that did not wire it — the panel then draws
   * no settings button at all (see `ComposerPointsProps.onOpenSettings`).
   */
  onOpenSettings?: () => boolean
  /**
   * Standard slot hook: reads one Host-computed projection for this session.
   * Injected by the slot, so it is absent when this gate is rendered directly
   * from a test.
   */
  useProjection?: (key: 'modelSelection') => unknown
}

export function ComposerPointsGate(props: ComposerPointsGateProps) {
  const { t, position, settingsScope, useProjection } = props
  // Re-render when the settings change, so ticking the card's checkbox — or
  // moving the seat — appears without a remount. `settingsScope` is a stable
  // injected reference, so the subscription is set up once per scope.
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

  // A region the user switched OFF must render nothing, even though the model
  // projection still names its provider: switching a provider off withdraws its
  // adapter route and its configurable-provider entry from the harness, so its
  // credits are no longer readable and the readout would sit there failing.
  // The rule mirrors the Host's own opt-out semantics through `regionEnabledOf`
  // (only an explicit `false` disables), which is the same reader the card uses
  // for its tab checkboxes — so the card and this gate can never disagree about
  // whether a region is on.
  if (!regionEnabledOf(scopeValueOf(settingsScope), region)) return null

  // `region` is non-undefined here, and it is derived from `provider`, so the
  // provider is present too; the assertion states that rather than widening the
  // component's prop to accept an absent provider it never sees.
  //
  // The SEAT test comes last, and it needs `region`: the setting is per region,
  // so which seat this registration should use is only knowable once ownership
  // is settled. Ordering it after ownership and the switches also means a region
  // whose readout is hidden or switched off renders nothing in EITHER seat,
  // rather than the inactive seat briefly drawing a frame before the switch
  // rejects it.
  if (regionCreditPositionOf(scopeValueOf(settingsScope), region) !== (position ?? 'composer')) return null

  return (
    <ComposerPoints
      t={t}
      provider={provider as string}
      region={region}
      {...settingsScope === undefined ? {} : { settingsScope }}
      {...props.onOpenSettings === undefined ? {} : { onOpenSettings: props.onOpenSettings }}
    />
  )
}