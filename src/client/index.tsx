/**
 * Browser half: Trae usage summary inside Plugin configuration.
 * Mirrors the `dsh-workbuddy-connect` browser-plugin entry so the external
 * presentation stays consistent across the plugin family.
 *
 * The registration shape serves TWO host lines at once, and the settings
 * surface differs between them:
 *
 *   0.1.5  `settingsScope.bind({ namespace })` + the `settings.plugin.item` slot
 *   0.1.7  `configForms.get(entryId)`          + the `plugins.*` slots
 *
 * `settingsScope` was REMOVED (not deprecated) in 0.1.7-alpha.1, so the
 * settings service is probed by capability rather than declared in `inject`
 * (see below), and each slot is registered on its own because the two lines
 * declare disjoint slot sets.
 */

// DSH 0.1.2 deleted `@deepseek-ai/dsh-client-runtime` (its services moved to
// focused packages), so `ClientContext` is now cordis' own `Context` plus the
// service augmentations below: `slots` comes from `dsh-client-ui-renderer`,
// `locale` from `dsh-client-locale`. `settingsScope` (0.1.5) and `configForms`
// (0.1.7) are NOT declared here — they are read through `ctx.get()`, which
// needs no augmentation and works on whichever line is running.
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { TraeUsageCard } from './TraeUsageCard.tsx'
import type { TraeUsageCardInjected } from './TraeUsageCard.tsx'
import { en, zh } from './locales.ts'
import type { TraeSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Trae plugin card copy. */
    'settings.trae': TraeSettingsKey
  }
}

/** Stable browser-plugin name. */
export const name = 'dsh-connect-trae-client'
/**
 * Client services required by the Plugin configuration contribution.
 *
 * Deliberately only the two services that exist on BOTH host lines. Cordis'
 * dependency gate is hard: any `inject` entry the running line does not provide
 * keeps `apply` from ever running at all — which is exactly how this plugin
 * ended up `pending (waiting for service: settingsScope)` on 0.1.7. Probing the
 * settings surface through `ctx.get()` (which returns undefined, never throws,
 * for an absent service) is what lets one build serve both lines.
 */
export const inject = ['slots', 'locale']

/**
 * Register card copy and the Trae card under Plugin configuration.
 *
 * The entire body is wrapped so that a DSH slot-API breaking change (for
 * example the rc.6→rc.7 `id`→`key` / `order`→`priority` rename) degrades
 * to a `console.error` instead of throwing into the DSH loader and raising
 * the red "Failed to load plugins" banner. The host provider keeps working:
 * the `trae` model channel is unaffected.
 *
 * NOTE: the try/catch boundary of this function is mirrored (duplicated) in
 * `tests/client-fallback.spec.ts`, because the real client entry imports
 * browser-only DSH packages that cannot load in the Node test environment.
 * If you change the guarded body, the soft probe, or the per-slot
 * registration here, update that mirror too.
 */
export function apply(ctx: ClientContext): void {
  try {
    const namespace = 'settings.trae'
    ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-connect-trae: settings copy')
    const t = ctx.locale.bind(namespace) as TraeUsageCardInjected['t']

    // Soft service probe. Property access on an undeclared service THROWS
    // ("cannot get property X without inject") — `?.` guards null/undefined,
    // not a throwing getter — while `ctx.get()` returns undefined for an
    // absent service. Never touch `ctx.configForms` / `ctx.settingsScope`
    // directly; go through `get`.
    const softGet = (name: string): unknown => (ctx as unknown as { get(name: string): unknown }).get(name)

    let settingsScope: TraeUsageCardInjected['settingsScope'] | undefined
    const forms = softGet('configForms') as
      | {
          describe(): { getSnapshot(): { view?: { namespaces?: { ns: string }[] } } }
          get(ns: string): TraeUsageCardInjected['settingsScope']
        }
      | undefined
    const legacy = softGet('settingsScope') as
      | { bind(options: { namespace: string }): TraeUsageCardInjected['settingsScope'] }
      | undefined
    if (forms !== undefined) {
      // 0.1.7 line: pick the namespace the Host actually serves (the plugin
      // may be mounted under a different entry id), falling back to the
      // declared one when the mirror has not populated yet.
      let ns = 'trae'
      try {
        const namespaces = forms.describe().getSnapshot().view?.namespaces ?? []
        const served = namespaces.find(entry => entry.ns === 'trae' || /trae/i.test(entry.ns))
        if (served !== undefined) ns = served.ns
      } catch { /* mirror not ready: the declared id is still correct */ }
      settingsScope = forms.get(ns)
    } else if (legacy !== undefined) {
      settingsScope = legacy.bind({ namespace: 'trae' })
    }

    const registerCard = (slotName: string, key: string): void => {
      try {
        ctx.slots.inject(slotName as never, () => (ctx.slots as unknown as {
          register(
            options: { name: string; key: string; priority: number; inject: () => TraeUsageCardInjected },
            component: unknown,
          ): () => void
        }).register({
          name: slotName,
          key,
          priority: 30,
          // A line with no settings surface still renders the card read-only
          // rather than not at all: saving is the only capability that needs
          // the scope.
          inject: () => settingsScope === undefined
            ? { t }
            : { t, settingsScope },
        }, TraeUsageCard))
      } catch (error: unknown) {
        // Isolated per slot on purpose: the two host lines declare disjoint
        // slot sets (0.1.5 only settings.plugin.item; 0.1.7 only the
        // plugins.* pair), so one line's registration must never take the
        // other slots down with it.
        console.error(`[dsh-connect-trae] card slot "${slotName}" failed to register (host provider unaffected):`, error)
      }
    }

    registerCard('plugins.bundle.config', 'dsh-connect-trae')
    registerCard('plugins.row.config', 'dsh-connect-trae#dsh-connect-trae')
    registerCard('settings.plugin.item', 'trae')
  } catch (error: unknown) {
    // Degrade silently on the page: the host provider still serves models.
    console.error('[dsh-connect-trae] client card failed to load (host provider unaffected):', error)
  }
}
