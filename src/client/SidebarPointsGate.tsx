/**
 * Gate between the `sidebar.footer.action` slot and the compact credit line.
 *
 * Kept in its own module (rather than inside the browser-plugin entry) so it
 * can be imported from the Node/jsdom test suite: the entry imports
 * browser-only DSH packages the test environment cannot load, but this gate
 * depends only on React, the card's settings-scope shape and the line
 * component.
 *
 * TWO states, and the off state is still a visible control:
 *
 *  - on  → {@link SidebarPoints}, which owns the fetch loop and its timer;
 *  - off → a single dimmed "积分" chip that turns it back on.
 *
 * The off state used to render NOTHING, and that turned out to be a dead end
 * (2.9.1): the switch also lives in the plugin card, but a market plugin can
 * own the Plugins tab without ever dispatching `plugins.bundle.config`, so on
 * such a host the line never rendered AND the switch could not be found. A
 * feature whose only control is on a page the user cannot open is not a
 * feature. The chip keeps the control where the feature itself renders, so it
 * is reachable on every host that draws this slot at all.
 *
 * The collapsed rail still renders nothing: the shell squeezes the footer to a
 * 56px strip rather than hiding it, and neither the line nor a chip reads well
 * there — see the bail-out below.
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

  if (!enabled) {
    return (
      <div className="dsm-trae-sidebar-points dsm-trae-sidebar-points-off">
        <button
          type="button"
          className="dsm-trae-sidebar-points-show"
          disabled={settingsScope?.getSnapshot()?.writable !== true}
          title={t('sidebar.showHint')}
          onClick={() => { setShown(true) }}
        >
          {t('sidebar.show')}
        </button>
      </div>
    )
  }

  return <SidebarPoints t={t} onHide={() => { setShown(false) }} />
}