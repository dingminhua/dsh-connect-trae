/**
 * Browser half: Trae usage summary inside Plugin configuration.
 * Mirrors the `dsh-workbuddy-connect` browser-plugin entry so the external
 * presentation stays consistent across the plugin family.
 *
 * DSH 0.1.7+ only. The client settings surface is `configForms` (probed
 * through `ctx.get()` rather than declared in `inject`, because Cordis'
 * dependency gate is hard — an `inject` entry the running line does not
 * provide keeps `apply` from running at all, which is exactly how the plugin
 * ended up `pending (waiting for service: settingsScope)` before 2.3.0), and
 * the configuration cards live in the Plugins page's `plugins.*` slots. The
 * pre-0.1.7 `settingsScope` service and `settings.plugin.item` slot are gone
 * with the line they served.
 */

// DSH 0.1.2 deleted `@deepseek-ai/dsh-client-runtime` (its services moved to
// focused packages), so `ClientContext` is now cordis' own `Context` plus the
// service augmentations below: `slots` comes from `dsh-client-ui-renderer`,
// `locale` from `dsh-client-locale`. `configForms` is NOT declared here — it
// is read through `ctx.get()`, which needs no augmentation.
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
 * Deliberately only the two services the 0.1.7 line provides unconditionally:
 * `slots` (card injection) and `locale` (copy). The settings surface is probed
 * through `ctx.get()` (which returns undefined, never throws, for an absent
 * service), so the card degrades to read-only rather than failing to load if
 * configForms is not served yet.
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
    // absent service. Never touch `ctx.configForms` directly; go through
    // `get`.
    const softGet = (name: string): unknown => (ctx as unknown as { get(name: string): unknown }).get(name)

    const forms = softGet('configForms') as
      | {
          describe(): {
            getSnapshot(): { view?: { namespaces?: { ns: string }[] } }
            subscribe(listener: () => void): () => void
          }
          get(ns: string): TraeUsageCardInjected['settingsScope']
        }
      | undefined

    /**
     * The card's settings scope, bound to whichever namespace the Host actually
     * serves — resolved from the describe mirror, and RE-BOUND whenever the
     * mirror changes.
     *
     * The mirror answers asynchronously relative to this plugin's `apply()`
     * (and, on a profile reload, may gain namespaces that did not exist at
     * boot — this plugin's entry is exactly such a case). Resolving the
     * namespace ONCE at apply time and falling back to the declared constant
     * is a real failure: the form controller is bound to its namespace forever,
     * so a card whose entry appeared after the mirror's first load writes to
     * `trae` — a namespace the host does not serve — and every write is
     * refused (`No configurable plugin entry "trae"`), while the controls stay
     * enabled (the mirror reports global `writable` even when the namespace is
     * missing).
     *
     * The scope therefore forwards every read/write to the CURRENT controller:
     * once the mirror lists the trae namespace (any name matching `/trae/i`,
     * e.g. `dsh-connect-trae` or `include:dsh-connect-trae`), the card lands on
     * the right namespace and re-renders through its own subscription. Before
     * the mirror answers, the scope reports `writable: false` so the card is
     * read-only rather than offering controls that cannot save.
     */
    const settingsScope: TraeUsageCardInjected['settingsScope'] = (() => {
      let current: TraeUsageCardInjected['settingsScope'] | undefined
      let currentOff: (() => void) | undefined
      let refreshedOnce = false
      const listeners = new Set<() => void>()
      const notify = (): void => { for (const listener of [...listeners]) listener() }
      const scope: TraeUsageCardInjected['settingsScope'] = {
        getSnapshot: () => current?.getSnapshot() ?? { status: 'unavailable', value: undefined, writable: false },
        subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        set: (field, value) => current !== undefined ? current.set(field, value) : Promise.resolve(false),
      }
      const rebind = (): void => {
        let served: { ns: string } | undefined
        try {
          const namespaces = forms?.describe().getSnapshot().view?.namespaces ?? []
          served = namespaces.find(entry => entry.ns === 'trae' || /trae/i.test(entry.ns))
        } catch { /* mirror not ready: keep the current binding */ }
        const next = served === undefined || forms === undefined ? undefined : forms.get(served.ns)
        if (next !== current) {
          currentOff?.()
          current = next
          currentOff = current?.subscribe(notify)
          notify()
        }
        // The mirror may have settled before this entry existed. Nudge it to
        // re-describe ONCE (the answer lands through the mirror update; later
        // `settings/document-updated` events keep it fresh from there).
        if (next === undefined && !refreshedOnce) {
          refreshedOnce = true
          try { (forms?.describe() as { load?(): unknown }).load?.() } catch { /* ignore */ }
        }
      }
      // Try immediately (the mirror may already be ready), then follow it.
      rebind()
      forms?.describe().subscribe?.(rebind)
      return scope
    })()

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
          // The scope is always present (it is the re-binding proxy); a host
          // with no settings surface leaves it permanently unbound, so the
          // card renders read-only rather than not at all.
          inject: () => ({ t, settingsScope }),
        }, TraeUsageCard))
      } catch (error: unknown) {
        // Isolated per slot on purpose: a failed registration must never take
        // the other slots down with it.
        console.error(`[dsh-connect-trae] card slot "${slotName}" failed to register (host provider unaffected):`, error)
      }
    }

    registerCard('plugins.bundle.config', 'dsh-connect-trae')
    registerCard('plugins.row.config', 'dsh-connect-trae#dsh-connect-trae')
  } catch (error: unknown) {
    // Degrade silently on the page: the host provider still serves models.
    console.error('[dsh-connect-trae] client card failed to load (host provider unaffected):', error)
  }
}
