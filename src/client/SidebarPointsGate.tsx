/**
 * Gate between the `sidebar.footer.action` slot and the compact credit line.
 *
 * Aligned with `dsh-connect-workbuddy`'s sidebar credit gate (3.7.0), which is
 * the sibling plugin this feature was modelled on.
 *
 * Kept in its own module (rather than inside the browser-plugin entry) so it
 * can be imported from the Node/jsdom test suite: the entry imports
 * browser-only DSH packages the test environment cannot load, but this gate
 * depends only on React, the card's settings-scope shape and the line
 * component.
 *
 * TWO states:
 *
 *  - on  → {@link SidebarPoints}, which owns the fetch loop and its timer;
 *  - off → NOTHING. The row is absent from the DOM, not hidden.
 *
 * There is deliberately NO control inside the row. An earlier revision put a
 * `×` beside the refresh button, on the theory that a switch you cannot find is
 * no switch at all. That trade turned out badly in two ways, both of which the
 * sibling plugin hit first and documented:
 *
 *  1. a bare `scope.set()` in the row was a SECOND writer of the same field,
 *     with a different (weaker) success path than the card's read-back-checked
 *     write — a second path that can disagree about one setting;
 *  2. it competed for space in a footer the row was meant to leave tidy.
 *
 * The card is the right home for the switch: it sits with the setting it
 * controls (account, models), and it is where the user already is. It carries
 * the checkbox TWICE — at the top of the card and beside the model actions —
 * so the control is found where the work happens rather than hunted for.
 *
 * The collapsed rail also renders nothing: the shell squeezes the footer to a
 * 56px strip rather than hiding it, and the line does not read well there.
 */
import { useEffect, useState } from 'react'
import { SidebarPoints } from './SidebarPoints.tsx'
import { unwrapVolatileDeep } from '../status-paths.ts'
import type { TraeSettingsKey } from './locales.ts'
import type { TraeUsageCardInjected } from './TraeUsageCard.tsx'

/**
 * Read the sidebar-credit switch out of a committed settings snapshot.
 *
 * Absent means OFF, matching the host default (the field defaults to false).
 * Only an explicit `true` shows the balance: a scope that has not populated
 * yet, or a host too old to serve the field, must not put a row in the footer
 * that the user never asked for.
 */
export function sidebarPointsEnabledOf(scope: TraeUsageCardInjected['settingsScope']): boolean {
  if (scope === undefined) return false
  const value = unwrapVolatileDeep(scope.getSnapshot().value) as { showPointsInMainUi?: unknown } | undefined
  return value?.showPointsInMainUi === true
}

export interface SidebarPointsGateProps {
  t: (key: TraeSettingsKey, params?: Record<string, unknown>) => string
  settingsScope?: TraeUsageCardInjected['settingsScope']
  /** Shell owner prop for `sidebar.footer.action`: false in the collapsed rail. */
  wide?: boolean
}

export function SidebarPointsGate(props: SidebarPointsGateProps) {
  const { t, settingsScope, wide } = props
  const [enabled, setEnabled] = useState(() => sidebarPointsEnabledOf(settingsScope))
  useEffect(
    () => settingsScope?.subscribe(() => { setEnabled(sidebarPointsEnabledOf(settingsScope)) }),
    [settingsScope],
  )

  // Collapsed rail: render NOTHING.
  //
  // The shell does NOT hide the footer when the sidebar collapses — it
  // squeezes it: `SidebarRoot.module.css` sets
  // `.collapsed .footerActions { display:flex; justify-content:center;
  // width:auto }`, so the 56px rail still gets a centred strip down there. A
  // label, a balance and a refresh button do not fit in 56px; they end up
  // ellipsised to "积…" next to a clipped button, which reads as broken rather
  // than compact. A collapsed sidebar is the normal working state, so this is
  // exactly when the line must be absent rather than degraded.
  //
  // Bailing out here — before the line mounts — also means the fetch loop and
  // its 5-minute timer never start while collapsed.
  if (wide === false) return null
  if (!enabled) return null

  return <SidebarPoints t={t} />
}