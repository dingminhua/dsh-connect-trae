/**
 * Gate between the `sidebar.footer.action` slot and the compact credit line.
 *
 * Kept in its own module (rather than inside the browser-plugin entry) so it
 * can be imported from the Node/jsdom test suite: the entry imports
 * browser-only DSH packages the test environment cannot load, but this gate
 * depends only on React, the card's settings-scope shape and the line
 * component.
 *
 * It renders NOTHING while the card switch `showPointsInMainUi` is off (the
 * row's DOM is absent, not hidden), and mounts {@link SidebarPoints} — which
 * owns the fetch loop and its timer — only while on. A subscription to the
 * settings scope mounts or unmounts the line as soon as the switch changes.
 */
import { useEffect, useState } from 'react'
import { SidebarPoints } from './SidebarPoints.tsx'
import { unwrapVolatileDeep } from '../status-paths.ts'
import type { TraeSettingsKey } from './locales.ts'
import type { TraeUsageCardInjected } from './TraeUsageCard.tsx'

/** Read the sidebar-credit switch out of a committed settings snapshot. */
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
  if (!enabled) return null
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
  return <SidebarPoints t={t} />
}
