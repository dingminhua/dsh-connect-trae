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
import { createElement as h } from 'react'
import type { JSX } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { TraeUsageCard } from './TraeUsageCard.tsx'
import { ComposerPointsGate } from './ComposerPointsGate.tsx'
import type { ComposerPointsGateProps } from './ComposerPointsGate.tsx'
import { TRAE_SETTINGS_ID, openPluginSettingsPage } from './settings-route.ts'
import { MODEL_LABEL_PRIORITY, TraeModelLabel } from './TraeModelLabel.tsx'
import type { TraeUsageCardInjected } from './TraeUsageCard.tsx'
import type { TraeCreditPosition } from '../status-paths.ts'
import { TRAE_USAGE_PATH, withTraeRegion } from '../status-paths.ts'
import { en, zh } from './locales.ts'
import type { TraeSettingsKey } from './locales.ts'
import { TRAE_PLUGIN_ICON } from './icon.ts'
import {
  setSidebarPanelWanted, sidebarPanelWanted, subscribeSidebarPanelWanted,
} from './panel-switch.ts'

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

/**
 * The slot entries this client currently holds, by the identity each claims.
 *
 * MODULE-LEVEL, and that is the whole point (issue #74). `apply()` can run a
 * second time while the first run's registrations are still live — a reload or
 * rebuild path applies the same client twice. A map closed over by ONE `apply`
 * invocation cannot see the previous invocation's entries and therefore cannot
 * release them, which is precisely the state that produced
 *
 *   single slot "conversation.input.model.label" already has a registration at
 *   priority 0 (registered by dsh-connect-trae-client)
 *
 * — a plugin colliding with ITSELF, not with another plugin.
 *
 * Stale entries are harmless: every disposer in the registry is idempotent
 * (`if (!rec.entries.includes(entry)) return`), so releasing one twice is a
 * no-op and a leftover entry costs nothing but a map slot.
 */
/** One held seat: the entry itself, and the watcher that can re-create it. */
interface SlotHold {
  /** Disposes the registry ENTRY. Idempotent in the registry. */
  disposeEntry?: () => void
  /** Stops the `inject` watcher from running the callback again. */
  disposeInject?: () => void
}

const liveSlotEntries = new Map<string, SlotHold>()

/**
 * Release this client's hold on `identity`, if it has one.
 *
 * `entryOnly` exists because of a subtle self-collision: the release is called
 * from INSIDE the `inject` callback as well as from `apply`, and disposing the
 * inject controller from within its own callback would tear down the effect
 * that is currently executing. Inside the callback only the ENTRY is released;
 * from `apply`, both.
 */
function releaseSlotEntry(identity: string, entryOnly = false): void {
  const held = liveSlotEntries.get(identity)
  if (held === undefined) return
  liveSlotEntries.delete(identity)
  if (held.disposeEntry !== undefined) {
    try { held.disposeEntry() } catch { /* already disposed by the slot service */ }
  }
  if (!entryOnly && held.disposeInject !== undefined) {
    try { held.disposeInject() } catch { /* already disposed */ }
  }
}

/**
 * Register one slot entry, surviving EVERY way the registry can refuse it.
 *
 * WHY THE CATCH IS INSIDE THE CALLBACK, which is the whole point of issue #74.
 * `slots.inject()` does not necessarily run its callback now: when the slot is
 * not declared yet it subscribes and runs the callback LATER. A later throw is
 * re-thrown by the renderer's own `changed()` handler out of a `queueMicrotask`,
 * where no call-site try/catch can reach it — the user gets a renderer error
 * banner on the first paint after a restart, and a reload (which re-declares in
 * a different order) clears it. Moving the catch inside the callback turns every
 * refusal into a log line, matching this file's "degrade, never take the page
 * down" contract.
 *
 * WHY THE RELEASE COMES FIRST. A `single` slot rejects a second live entry at
 * the same priority. That refusal is OUR fault and we can fix it rather than
 * report it, so each run releases whatever this identity already holds.
 *
 * @param ctx - The applying plugin's context (module scope has none).
 * @param identity - Stable key for this seat.
 * @param slotKey - The host slot to register into.
 * @param register - Performs the registration, returning its disposer.
 * @param describe - Names the seat in the failure log.
 */
function registerSlotEntry(
  // Structural, not `ClientContext`: the helper is module-level and takes only
  // the one fact it needs, so the spec can drive it without a full context.
  ctx: { slots: { inject(key: never, callback: () => (() => void)): () => void } },
  identity: string,
  slotKey: string,
  register: () => () => void,
  describe: string,
): void {
  const hold: SlotHold = {}
  const fail = (error: unknown): void => {
    console.error(`[dsh-connect-trae] ${describe} failed to register (host provider unaffected):`, error)
  }
  const run = (): (() => void) => {
    releaseSlotEntry(identity, true)
    try {
      const disposeEntry = register()
      hold.disposeEntry = disposeEntry
      // `liveSlotEntries` may have been cleared by a release while we ran (a
      // concurrent re-declaration); re-seat the hold so the entry is reachable.
      const current = liveSlotEntries.get(identity)
      if (current === undefined) liveSlotEntries.set(identity, hold)
      else current.disposeEntry = disposeEntry
      return disposeEntry
    } catch (error: unknown) {
      fail(error)
      return () => {}
    }
  }
  try {
    const result = ctx.slots.inject(slotKey as never, () => {
      try {
        return run()
      } catch (error: unknown) {
        // Only reachable if the release itself throws.
        fail(error)
        return () => {}
      }
    })
    hold.disposeInject = result
    // The callback may ALREADY have run (the slot was declared): `register()`
    // is not called again here, only the hold is seated. Calling it twice would
    // re-create the very duplicate this function exists to prevent.
    const current = liveSlotEntries.get(identity)
    if (current === undefined) liveSlotEntries.set(identity, hold)
    else current.disposeInject = result
  } catch (error: unknown) {
    releaseSlotEntry(identity)
    fail(error)
  }
}

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

    /**
     * The composer panel's route to this plugin's own settings page.
     *
     * Deliberately a CLOSURE over `softGet` rather than a resolved service: the
     * seam it uses (the settings shell's `sidebar.settings` store seat) belongs
     * to another bundle whose apply order is not ours to assume, so the probe
     * happens on every press and a shell that appears later is still found. See
     * `settings-route.ts` for the finding that established which seam this is.
     */
    // The label thunk, not a fixed string: route 2 finds the nav row by its
    // RENDERED text, so this must resolve in whatever language is active at the
    // moment of the press. `t('nav.panel')` is the same key the section
    // registration uses, so the row this route looks for is the row that gets
    // registered — one spelling, one source.
    const onOpenSettings = (): boolean => openPluginSettingsPage(softGet, {
      label: () => t('nav.panel'),
    })

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

    /**
     * The configuration card, now drawn as its own `settings.section` page.
     *
     * WHY THE SEAT MOVED. It used to register into the Plugins page's
     * `plugins.bundle.config` / `plugins.row.config` slots, which put the whole
     * configuration inside the plugin's market detail page, below its README.
     * That page's job is to describe and install a package; a page that both
     * advertises and configures makes the user scroll past marketing to reach a
     * checkbox. `settings.section` is the shell's seat for "this plugin owns a
     * settings page", addressed by the same id the nav row uses.
     *
     * WHY `id` AND `order: 30`. The id is this plugin's package name, and it is
     * the SAME string the nav glyph below registers under, because the shell
     * renders `settings.section.icon` filtered by `{ only: section.id }` — an
     * icon whose id does not match never appears and the shell's default glyph
     * silently stays. `order: 30` places this page after the shipped sections
     * (account -10, general 0, models 10, plugins 15, agent-presets 20) and
     * alongside the other third-party pages, without colliding with a built-in.
     *
     * WHY NO CAPABILITY PROBE. `slots.inject()` already IS the probe: it runs
     * the callback now when the slot is declared and subscribes otherwise,
     * doing nothing at all on a host that never declares `settings.section`.
     * Wrapping it in a `typeof` test on some accessor is how a page ends up
     * never registering anywhere, silently — the failure mode this plugin's
     * sibling shipped twice. Let the host answer.
     *
     * The page and its glyph are registered from ONE `inject` callback and both
     * disposers are returned as a pair: the glyph is only meaningful while the
     * page's id exists, so the pairing is structural rather than a convention,
     * and Cordis disposes both with this fiber.
     */
    // One spelling, shared with the composer pill's route (`settings-route.ts`):
    // an id the nav row and `openSection(id)` disagree on opens the dialog on
    // the shell's fallback section instead, silently.
    const traeSettingsId = TRAE_SETTINGS_ID
    const registerSettingsPage = (): void => {
      registerSlotEntry(ctx, 'settings.section#dsh-connect-trae', 'settings.section', () => {
        const disposers: Array<() => void> = []
        try {
          disposers.push((ctx.slots as unknown as {
            register(
              options: {
                name: string
                id: string
                order: number
                label: () => string
                locale: string
                inject: () => TraeUsageCardInjected & { surface: 'section' }
              },
              component: unknown,
            ): () => void
          }).register({
            name: 'settings.section',
            id: traeSettingsId,
            order: 30,
            // A THUNK, re-read on every projection: the shell never subscribes
            // locale state, so a fixed string would leave the nav row in the
            // language that happened to be active at registration.
            label: () => t('nav.panel'),
            locale: namespace,
            inject: () => ({ t, settingsScope, surface: 'section' as const }),
          }, TraeUsageCard))

          /**
           * The nav glyph, addressed by the SAME id as the page.
           *
           * The host renders this cell with `{ size, active }` inside its own
           * button and label, so only the picture belongs here. Same shape as
           * the sidebar row's glyph (a brand-mark `<img>`), because it is the
           * same identity in a second place.
           *
           * Its own `inject`: `settings.section.icon` is a SEPARATE slot that a
           * host line may not declare, and the page must still appear when only
           * `settings.section` exists. A missing glyph is the shell's default
           * gear — a degraded look, not a missing page.
           */
          try {
            disposers.push(ctx.slots.inject('settings.section.icon' as never, () => (ctx.slots as unknown as {
              register(options: { name: string, id: string, locale: string }, component: unknown): () => void
            }).register({
              name: 'settings.section.icon',
              id: traeSettingsId,
              locale: namespace,
            }, SettingsSectionIcon)))
          } catch (error: unknown) {
            // A host without the icon slot is not a failure: the page stands.
            console.error('[dsh-connect-trae] settings nav icon failed to register (page unaffected):', error)
          }
        } catch (error: unknown) {
          for (const dispose of disposers) {
            try { dispose() } catch { /* already disposed by the slot service */ }
          }
          throw error
        }
        return () => {
          for (const dispose of disposers) {
            try { dispose() } catch { /* already disposed by the slot service */ }
          }
        }
      }, 'settings section page')
    }

    registerSettingsPage()

    /**
     * Credit readout in the composer row (`conversation.input.right`, a
     * session-scope list slot rendered immediately before the model picker).
     *
     * Provider-scoped on purpose: it renders only while the session's selected
     * model belongs to this plugin. That is what keeps two connector plugins
     * from competing for one shared row — the sidebar foot, where this line used
     * to live, is a single root row, and the observed result beside
     * dsh-connect-workbuddy's two rows was this plugin's line squeezed down to a
     * clipped "Tr".
     *
     * Registration is unconditional; the gate reads the Host's modelSelection
     * projection and returns null for every other provider, so nothing is drawn
     * and no fetch loop starts while another provider is selected.
     *
     * THE SAME READOUT IS REGISTERED IN TWO SEATS (learned from workbuddy issue
     * #62), and BOTH registrations are unconditional too. Which one actually
     * draws is decided inside the gate by the per-region `creditPosition`
     * setting, so changing the setting is a settings write rather than a slot
     * re-registration — this file's own header records how fragile rebinding a
     * slot is across DSH lines (the rc.6→rc.7 `id`/`order` → `key`/`priority`
     * rename). The composer row is a LIST seat shared with every other bundle,
     * so a third party parking something there can crowd this readout out of
     * existence; the second seat is what keeps one plugin's presence from
     * deciding another's.
     */
    const registerPointsSlot = (
      slotName: string,
      id: string,
      order: number,
      position: TraeCreditPosition,
    ): void => {
      registerSlotEntry(ctx, `${slotName}#${id}`, slotName, () => (ctx.slots as unknown as {
        register(
          // The gate's OWN prop shape, not the card's: this registration
          // injects `position` on top of the card's `t` / `settingsScope`.
          // Spellling it `TraeUsageCardInjected` made the extra prop an
          // excess-property surprise waiting for the next refactor to trip
          // over.
          options: { name: string; id: string; order: number; locale: string; inject: () => ComposerPointsGateProps },
          component: unknown,
        ): () => void
      }).register({
        name: slotName,
        id,
        order,
        locale: namespace,
        // `settingsScope` rides along so the gate can honor the card's
        // "show credits in the composer" switch and its seat without a second
        // writer; `position` is which seat THIS registration occupies.
        inject: () => ({ t, settingsScope, position, onOpenSettings }),
      }, ComposerPointsGate), `points slot "${slotName}"`)
    }

    // The composer row: the default seat, and the closer, more glanceable one.
    // `order: 4` is this readout's long-standing place in that row.
    //
    // `conversation.input.right` rather than `input.left` (issue #71): the host
    // renders `input.right` inside `div.trailing`'s `standardControls`, i.e.
    // IMMEDIATELY BEFORE the model picker, while `input.left` sits at the very
    // end of `div.tools` — butted against the permission selector, 8px away.
    // Both are clickable, so reaching for "完全权限" landed on the readout and
    // opened the credit popover (issue #71's second suggestion). The readout is
    // a readout, not an action; next to the model picker it stops competing
    // with a control the user is actually aiming at.
    //
    // The SETTING does not change: `creditPosition`'s `composer` value still
    // means "the row that carries the model picker", which is exactly where
    // `input.right` renders — so a saved profile keeps working with no
    // migration, and the `stats` seat is untouched.
    registerPointsSlot('conversation.input.right', 'dsh-connect-trae-composer-points', 4, 'composer')
    // The ambient dock below the composer card, where the shell renders its own
    // round/step/token pills. `order: 10` places this readout AFTER those pills
    // (the shell's own statistics register at 0), so the shipped figures stay
    // leftmost and the readout reads as an addition rather than a replacement.
    registerPointsSlot('conversation.composer.dock', 'dsh-connect-trae-stats-points', 10, 'stats')

    /**
     * The upstream's activity badge in the HOST's model picker (ported from the
     * sibling `dsh-connect-workbuddy` plugin, whose #120 shipped the same fix).
     *
     * The picker renders the model name as a plain string, so a provider can
     * only put a CHARACTER there — and a character's colour is the emoji font's
     * business, not ours. The host therefore offers exactly one seam for this:
     * the `conversation.input.model.label` slot, whose contract is "render
     * non-interactive inline content such as a coloured name or badge" while the
     * picker keeps owning clicks, focus and check marks.
     *
     * Registered unconditionally: the component renders the plain name for a
     * provider that is not ours, so there is nothing to gate on. Its own
     * try/catch keeps a host that does not serve this slot from taking the card
     * down with it.
     */
    const registerModelLabel = (): void => {
      registerSlotEntry(ctx, 'conversation.input.model.label', 'conversation.input.model.label', () => (ctx.slots as unknown as {
        register(options: { name: string, priority: number }, component: unknown): () => void
      }).register(
        // The priority is not a detail (issue #74): `single` slots throw on a
        // duplicate at the SAME priority, and 0 — the default, which this used
        // to take — is the one value guaranteed to be contested, because it is
        // what every other contributor also gets without asking. See
        // `MODEL_LABEL_PRIORITY` for the live occupancy that chose this value.
        { name: 'conversation.input.model.label', priority: MODEL_LABEL_PRIORITY },
        TraeModelLabel,
      ), 'model label slot')
    }

    registerModelLabel()

    /**
     * The sidebar glyph for the optional panel row.
     *
     * The host renders `sidebar.panellist` registrants with `{ size, active }`
     * inside a `currentColor`-themed glyph cell, so the brand mark is drawn as a
     * small `<img>` — the PNG's own colours read as the plugin's identity, and
     * the row's selection state is the host's to paint around it.
     */
    function TraePanelIcon(props: { size?: number }): JSX.Element {
      const edge = typeof props.size === 'number' && props.size > 0 ? props.size : 16
      return h('img', {
        className: 'dsm-trae-panel-icon',
        src: TRAE_PLUGIN_ICON,
        alt: '',
        width: edge,
        height: edge,
        'aria-hidden': 'true',
      })
    }

    /**
     * The nav glyph for the `settings.section` page.
     *
     * A separate component from {@link TraePanelIcon} even though it draws the
     * same picture, because the two slots pass DIFFERENT owner props and a shared
     * component would have to paper over that: `sidebar.panellist` sends
     * `{ size, active }` on a row the shell paints, `settings.section.icon` sends
     * `{ size, active }` inside the shell's own nav button, and the second one
     * also has to survive `size` being absent (the shell always sends it, but a
     * host line that renames the prop must degrade to the default rather than
     * divide by `undefined`).
     *
     * `active` is applied as a slight opacity step instead of a colour: the
     * brand PNG carries its own colours, and recolouring someone else's mark to
     * show selection would misrepresent the product. The shell already paints
     * the selected row.
     */
    function SettingsSectionIcon(props: { size?: number, active?: boolean }): JSX.Element {
      const edge = typeof props.size === 'number' && props.size > 0 ? props.size : 16
      return h('img', {
        className: 'dsm-trae-section-icon',
        src: TRAE_PLUGIN_ICON,
        alt: '',
        width: edge,
        height: edge,
        style: { opacity: props.active === false ? 0.75 : 1 },
        'aria-hidden': 'true',
      })
    }

    /**
     * Back to the conversation, for the page's header.
     *
     * Soft-probed: `layout` is a host service this entry deliberately does not
     * declare in `inject` (an absent service keeps `apply` from running at all,
     * and the page is useful without the back affordance). `selectPanel(null)` is
     * the host's own way of handing the centre column back.
     */
    const backToConversation = (): void => {
      const layout = softGet('layout') as { selectPanel?: (id: string | null) => void } | undefined
      if (layout !== undefined && typeof layout.selectPanel === 'function') layout.selectPanel(null)
    }

    /**
     * The Trae panel in the sidebar (`sidebar.panellist` row + `main` keyed
     * page), mirroring the sibling `dsh-connect-workbuddy` panel and the host's
     * own Plugins row.
     *
     * OPT-IN (`Config.sidebarPanel`, default false). Registering it is NOT the
     * same as showing it: the host's sidebar builds the nav row from the slot's
     * ENTRY METADATA, so a component returning `null` leaves a blank but still
     * clickable button rather than no button. The row therefore has to be
     * registered only while the switch is on, which is what
     * {@link syncPanelRegistration} owns. See `panel-switch.ts` for the store
     * that decision rides on.
     */
    const PANEL_ID = 'dsh-connect-trae'
    const registerPanel = (): Array<() => void> => {
      registerSlotEntry(ctx, 'sidebar.panellist#dsh-connect-trae', 'sidebar.panellist', () => (ctx.slots as unknown as {
        register(options: { name: string; id: string; order: number; label: () => string; locale: string }, component: unknown): () => void
      }).register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        // Below both shipped rows (the host's Plugins at 0 and the market at 1)
        // and above Scheduled tasks (10): this is a usage readout, not a
        // primary destination.
        order: 2,
        label: () => t('nav.panel'),
        locale: namespace,
      }, TraePanelIcon), 'sidebar panel row')
      registerSlotEntry(ctx, `main#${PANEL_ID}`, 'main', () => (ctx.slots as unknown as {
        register(options: { name: string; key: string; locale: string; inject: () => TraeUsageCardInjected & { surface: 'page', backToConversation: () => void } }, component: unknown): () => void
      }).register({
        name: 'main',
        key: PANEL_ID,
        locale: namespace,
        inject: () => ({ t, settingsScope, surface: 'page' as const, backToConversation }),
      }, TraeUsageCard), 'sidebar panel page')
      // Returned for `syncPanelRegistration`'s dispose loop. `registerSlotEntry`
      // owns the disposers in `liveSlotEntries`; handing its own release back
      // keeps the existing "flip the switch disposes the row" behaviour without
      // two competing owners of the same entry.
      return [
        () => { releaseSlotEntry('sidebar.panellist#dsh-connect-trae') },
        () => { releaseSlotEntry(`main#${PANEL_ID}`) },
      ]
    }

    /**
     * The live panel registrations, kept SEPARATE from the settings slots.
     *
     * They are the only slots in this plugin that come and go while the page is
     * open (the opt-in switch), so owning them apart means flipping the switch
     * does not dispose and re-create the card, the composer readout and the
     * model label — which would be a visible flicker for a change that has
     * nothing to do with them.
     */
    let panelDisposers: Array<() => void> = []

    /**
     * Bring the panel registrations in line with the opt-in switch.
     *
     * Dispose FIRST, then register: a live `key`/`id` cannot be registered
     * twice (the ledger is keyed), and the throw would be swallowed into "no
     * entry at all".
     */
    const syncPanelRegistration = (): void => {
      // LEAVE THE PAGE BEFORE ITS PANEL GOES. Disposing a `main` key while the
      // centre column is dispatching it strands that column on nothing until the
      // host notices; the host's own sidebar does this same step for the same
      // reason, and so does the sibling market plugin. Everything is soft-probed,
      // so a host without `layout` (or without `panelInfo`) simply skips it —
      // such a host already drops an unresolvable panel id on its own.
      if (panelDisposers.length > 0) {
        const layout = softGet('layout') as {
          selectPanel?: (id: string | null) => void
          panelInfo?: { getSnapshot?(): { activePanelId?: unknown } }
        } | undefined
        try {
          if (layout?.panelInfo?.getSnapshot?.()?.activePanelId === PANEL_ID) layout.selectPanel?.(null)
        } catch { /* an unreadable panel id must not block the teardown */ }
      }
      for (const dispose of panelDisposers) {
        try { dispose() } catch { /* already disposed by the slot service */ }
      }
      panelDisposers = []
      if (!sidebarPanelWanted()) return
      panelDisposers = registerPanel()
    }

    /**
     * Follow the switch, and SEED it from the Host.
     *
     * The seed is a status read rather than the settings scope on purpose: this
     * namespace's browser mirror is documented as stale on the affected 0.1.7
     * deployments, and here a stale `false` would mean the row never appears —
     * with no later event to correct it, because the mirror reports namespace
     * edges, not value changes.
     *
     * A failed read is NOT an error to show: OFF is the documented default
     * answer, so a plugin whose status route is unreachable simply gets no row.
     *
     * The SUBSCRIPTION is what makes the switch live: the card calls
     * `setSidebarPanelWanted` after a verified write, so the row appears and
     * disappears without a reload. The host's layout service drops an
     * `activePanelId` whose `main` key has gone, so switching off while the page
     * is open returns the centre column to the conversation on its own.
     */
    ctx.effect(
      () => subscribeSidebarPanelWanted(syncPanelRegistration),
      'dsh-connect-trae: sidebar panel opt-in',
    )
    // Reconcile once now: the store starts OFF, so this is a no-op until the
    // Host's answer below (or a click on the card) turns it on. Called anyway so
    // the panel set is never left describing a state nobody reconciled.
    syncPanelRegistration()
    void (async () => {
      try {
        const response = await fetch(withTraeRegion(TRAE_USAGE_PATH, 'cn'), {
          headers: { accept: 'application/json' },
        })
        if (!response.ok) return
        const document = await response.json() as { sidebarPanelEnabled?: unknown }
        if (document.sidebarPanelEnabled === true) setSidebarPanelWanted(true)
      } catch { /* no answer means no row; the switch stays off */ }
    })()

  } catch (error: unknown) {
    // Degrade silently on the page: the host provider still serves models.
    console.error('[dsh-connect-trae] client card failed to load (host provider unaffected):', error)
  }
}
