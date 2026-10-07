/**
 * Gate between the `sidebar.footer.action` slot and the compact credit line.
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
 * Off used to leave a small "积分" chip behind, on the theory that a switch you
 * cannot find is no switch at all (2.9.1). That safety net is no longer needed:
 * the card carries the same checkbox twice — at the top of the card and beside
 * the model actions — so the way back is always where the feature is
 * configured. What the user asked for is for the row to be gone, and a leftover
 * chip still occupies the footer they wanted cleared.
 *
 * The collapsed rail also renders nothing: the shell squeezes the footer to a
 * 56px strip rather than hiding it, and the line does not read well there — see
 * the bail-out below.
 */
import { useCallback, useEffect, useState } from 'react'
import { SidebarPoints } from './SidebarPoints.tsx'
import { unwrapVolatileDeep } from '../status-paths.ts'
import type { TraeSettingsKey } from './locales.ts'
import type { TraeUsageCardInjected } from './TraeUsageCard.tsx'

/**
 * Read the sidebar-credit switch out of a committed settings snapshot.
 *
 * Absent means ON: the field defaults to true on the host, and a settings
 * scope that has not populated yet must not blink the line away. Only an
 * explicit `false` (the user turned it off, from the line or the card) hides
 * the balance.
 */
export function sidebarPointsEnabledOf(scope: TraeUsageCardInjected['settingsScope']): boolean {
  if (scope === undefined) return true
  const value = unwrapVolatileDeep(scope.getSnapshot().value) as { showPointsInMainUi?: unknown } | undefined
  return value?.showPointsInMainUi !== false
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

  /**
   * Write the switch back through the same field the card writes, so the two
   * controls can never disagree. The read-back is not awaited for its value:
   * the subscription above re-renders when the committed snapshot changes, and
   * an unwritable scope simply leaves the current state alone.
   */
  const setShown = useCallback((next: boolean): void => {
    if (settingsScope === undefined || settingsScope.getSnapshot().writable !== true) return
    void settingsScope.set('showPointsInMainUi', next).catch(() => { /* keep current state */ })
  }, [settingsScope])

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

  // Off means GONE: no row, no chip, no placeholder.
  //
  // An earlier revision kept a small "积分" button here so the switch could not
  // be lost. That reasoning no longer holds: the card carries the same checkbox
  // in two places (top of the card, and beside the model actions), so the way
  // back is always available where the feature is configured. A residue in the
  // sidebar is worse than useless — the user asked for the row to disappear, and
  // a leftover chip still occupies the footer they wanted cleared.
  if (!enabled) return null

  return <SidebarPoints t={t} onHide={() => { setShown(false) }} />
}