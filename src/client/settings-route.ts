/**
 * The route from the composer credit readout to THIS plugin's settings page.
 *
 * ## The finding this module encodes (m02517)
 *
 * The 4.9.0 line deleted the panel's settings pill on the stated reasoning that
 * "the host exposes no client service that opens the Settings dialog on a given
 * section, so the pill had nowhere to go". That reasoning was WRONG, and the
 * owner said so: clicking through the sidebar DOES open the wide settings on a
 * chosen page. The route exists; it was simply not the one the old module used.
 *
 * The old module (`openBundle` → `layout.selectPanel('plugins')`) targeted the
 * **Plugins** page, which stopped holding this plugin's configuration the moment
 * it moved to its own `settings.section` page. So the previous implementation is
 * not restorable, and a replacement was needed — this is it.
 *
 * ## The route: the settings shell's own store seat
 *
 * `@deepseek-ai/dsh-client-ui-settings-general` registers the `sidebar.settings`
 * slot with a **store seat**, and that seat is the shell's public state handle:
 *
 *     const shellHandle = createSettingsShellStore()
 *     const shellInstance = shellHandle.create()
 *     const shellStore = { ...shellHandle, create: () => shellInstance }
 *     ctx.slots.register({ name: 'sidebar.settings', store: shellStore, … })
 *
 * `createSettingsShellStore().actions` contains exactly the four shell
 * mutations, and `openSection(id)` is the one that answers this button: it sets
 * `activeId = id` AND `open = true`, i.e. "open the Settings dialog on the
 * named section" in a single call. `id` is the same string this plugin already
 * registers the page under (`TRAE_SETTINGS_ID`), so no translation is needed.
 *
 * Note the `create: () => shellInstance` override. A bare handle would mint a
 * FRESH instance per `create()` call — a private copy whose `openSection` moves
 * a dialog nobody renders. The shell pins the seat to its one live instance
 * precisely so a reader of the seat gets the dialog the user actually sees. This
 * module is that reader.
 *
 * ## Why reading the seat is legitimate, and not a private reach-through
 *
 *  - `StoredEntry.store` is a documented public field: "Declared store seat
 *    (instance resolution and lifecycle live with the host machinery)".
 *  - `slots.entries(key)` is a documented public service method, and reading a
 *    seat through it is the pattern the harness's OWN client tests use for this
 *    exact store, e.g. `ui-shortcuts/tests/commands.client.spec.ts`:
 *    `ctx.slots.entries('sidebar.settings')[0].store.create()`.
 *  - No other id-targeted seam exists. `settings.launcher` hands `openSettings`
 *    with no id, `settings.section` receives only `close`, and `openSection` is
 *    otherwise given only to `settings.onboarding` registrants — reaching it
 *    from there would mean registering a fake first-run step, which is far more
 *    intrusive than reading the seat the shell deliberately published.
 *
 * ## Why the probe is at PRESS time
 *
 * The seat belongs to ANOTHER bundle whose apply order is not ours to assume.
 * Probing once during `apply()` would capture `undefined` on a page whose
 * settings bundle applied later, leaving the button dead for the whole session
 * with nothing to re-evaluate it. `entries()` answers `[]` for a slot that is
 * not declared yet, so probing per press is free of state and always current.
 *
 * ## Why `false` rather than an exception
 *
 * The caller is a popover button. There is no supported host line lacking the
 * shell, but "cannot" must not become a thrown error inside a click handler on
 * a user's machine; it becomes a `false` the caller reports, and a button that
 * stays honest about it.
 */

/**
 * The `settings.section` id this plugin registers its page under.
 *
 * One spelling, in one place: the page registration, the nav row and
 * `openSection(id)` must agree, or the dialog opens on the shell's fallback
 * (first) section instead of this plugin's — silently, since an unknown id is
 * not an error to the store.
 */
export const TRAE_SETTINGS_ID = 'dsh-connect-trae'

/** The shipped slot whose store seat is the settings shell's state handle. */
export const SETTINGS_SLOT = 'sidebar.settings'

/** The slice of a live shell instance this module calls. */
interface SettingsShellInstanceLike {
  actions?: {
    openSection?: (id: string) => void
    open?: () => void
  } | undefined
}

/** The slice of the declared store seat this module calls. */
interface SettingsShellHandleLike {
  create?: (scopeKey?: string) => SettingsShellInstanceLike
}

/** The slice of a slot ledger entry this module reads. */
interface SlotEntryLike {
  store?: unknown
}

/** The slice of the `slots` service this module calls. */
interface SlotsLike {
  entries?: (key: string) => readonly SlotEntryLike[]
}

/**
 * Open this plugin's settings page — the wide Settings dialog, on this
 * plugin's section.
 *
 * @param get - the entry's soft service probe (`ctx.get`), which returns
 *   `undefined` for an absent service instead of throwing. Called HERE, on every
 *   invocation, so a service that appears after `apply` is still found.
 * @returns whether a route was taken. `false` means the caller's control should
 *   report that this host has no way there — see the module note.
 */
/**
 * The settings panel container inside the shell.
 *
 * `data-shortcut-modal="settings"` is the SHELL'S OWN attribute — its shortcut
 * router keys off it to decide whether the open modal is the settings one — so
 * it is far more stable than any class name, which is a CSS-module hash that
 * changes with every build.
 */
export const SETTINGS_PANEL_SELECTOR = '[data-shortcut-modal="settings"]'

/**
 * The sidebar's settings trigger: dialog semantics plus an expanded state.
 *
 * Both attributes are load-bearing. `aria-haspopup="dialog"` identifies it as
 * the thing that opens the panel; `aria-expanded` is how route 2 tells an open
 * panel from a closed one WITHOUT clicking, because clicking a trigger that is
 * already expanded CLOSES the dialog — a jump that would read as the settings
 * window flickering shut.
 */
export const SETTINGS_TRIGGER_SELECTOR = 'button[aria-haspopup="dialog"][aria-expanded]'

/**
 * Budget for "panel mounted + nav row rendered".
 *
 * The panel mounts synchronously on the click, but the nav rows' labels wait
 * for a locale snapshot, so a same-frame query is often one tick too early.
 * Five attempts over ~300ms covers one layout pass while staying under the
 * threshold where a user starts to think the press did nothing.
 */
const RETRY_DELAYS_MS = [0, 60, 70, 80, 90] as const

/** Options for {@link openPluginSettingsPage}. */
export interface SettingsRouteOptions {
  /**
   * The nav-row label in the CURRENT language, evaluated per press.
   *
   * A function rather than a string: route 2 finds the row by its rendered
   * text, and a label captured at registration would stop matching the moment
   * the user switches language.
   */
  label: () => string
  /** Document; injected by tests. */
  doc?: Document
  /** Scheduler; injected by tests. Defaults to `window.setTimeout`. */
  schedule?: (run: () => void, ms: number) => void
  /**
   * Called when NO route could even be attempted, so the caller can fall back
   * to something that is at least not a dead press.
   */
  onGiveUp?: () => void
}

function defaultSchedule(run: () => void, ms: number): void {
  try {
    window.setTimeout(run, ms)
  } catch {
    // A host without a working timer should still get the row clicked rather
    // than a jump that never runs.
    run()
  }
}

/**
 * Find the settings nav row whose label is this plugin's.
 *
 * Trimmed equality, not `includes`: 「dsh-connect-trae」 is a SUBSTRING of
 * nothing here, but 「模型」 is a substring of 「模型与预设」 on a differently
 * worded shell, and a loose match would click the wrong row.
 */
function findSectionRow(scope: ParentNode, label: string): HTMLButtonElement | undefined {
  const want = label.trim()
  if (want === '') return undefined
  const buttons = Array.from(scope.querySelectorAll<HTMLButtonElement>('button'))
  return buttons.find(button => (button.textContent ?? '').trim() === want)
}

/**
 * Route 1: open this plugin's section through the shell's store seat.
 *
 * @returns `'opened'` when the dialog is on the right section, `'shell'` when
 *   the dialog opened but is NOT preselected (route 2 can still click the row),
 *   and `undefined` when the seat is absent or unusable.
 */
function openThroughStoreSeat(
  get: (name: string) => unknown,
  sectionId: string,
): 'opened' | 'shell' | undefined {
  let slots: SlotsLike | undefined
  try {
    slots = get('slots') as SlotsLike | undefined
  } catch {
    return undefined
  }
  if (slots === undefined || typeof slots.entries !== 'function') return undefined

  let seat: unknown
  try {
    // `entries` is a plain ledger read, but it is another bundle's service and
    // a composed profile can replace `slots` with something that throws here.
    seat = slots.entries(SETTINGS_SLOT)[0]?.store
  } catch {
    return undefined
  }
  if (seat === null || typeof seat !== 'object') return undefined

  const handle = seat as SettingsShellHandleLike
  if (typeof handle.create !== 'function') return undefined

  try {
    const instance = handle.create()
    const openSection = instance?.actions?.openSection
    if (typeof openSection === 'function') {
      openSection(sectionId)
      return 'opened'
    }
    // A shell whose store predates `openSection`. Pressing it still opens the
    // dialog, so report `'shell'` and let route 2 click the nav row: the user
    // lands on the right page that way, and this is not a dead button. This is
    // the ONE difference from the 4.9.x code, which returned success here and
    // left the user on whichever section the shell defaults to.
    const open = instance?.actions?.open
    if (typeof open === 'function') {
      open()
      return 'shell'
    }
  } catch {
    // `create()` or a baked action threw. Nothing left to try here.
  }
  return undefined
}

/**
 * Open this plugin's settings page — the wide Settings dialog, on THIS
 * plugin's section.
 *
 * ## Two routes, best first (the shape borrowed from dsh-connect-workbuddy 5.20.4)
 *
 * 1. **The shell's store seat** — one call, exact, no timing:
 *    `slots.entries(SETTINGS_SLOT)[0].store.create().actions.openSection(id)`.
 * 2. **Driving the chrome** — click the sidebar's settings trigger, wait for the
 *    panel, then click this plugin's nav row by its label.
 *
 * Route 1 is strictly better where it exists: `openSection(id)` sets `activeId`
 * AND `open` in one action, so there is no window in which the dialog is open
 * on the wrong section, no retry loop, and no dependency on the nav row's
 * localized text. Route 2 is kept because the host range this plugin declares
 * spans shell lines that may predate the seat; deleting it would trade a
 * working fallback for nothing.
 *
 * ## Why both routes are needed even now
 *
 * A seat that carries `open()` but not `openSection()` is a real shell shape
 * (the store gained `openSection` after `open`). Returning `true` on that seat —
 * which 4.9.x did — claimed success while leaving the user on the shell's
 * default section, so the button appeared to do something other than what its
 * label promised. Handing back `'shell'` and continuing to route 2 is what
 * makes the button land on the page it names on EVERY shell.
 *
 * ## Why the probe happens per PRESS, not during `apply`
 *
 * The seat belongs to ANOTHER bundle whose apply order is not ours to assume.
 * Probing once during `apply()` would capture `undefined` on a host whose
 * settings bundle applied later, leaving the button dead for the whole session.
 * `entries()` answers `[]` for an undeclared slot, so a per-press probe is
 * stateless and always current — the same reason the caller passes `softGet`.
 *
 * ## Why it never throws
 *
 * Every path runs from a RENDER path (a click handler in the credits popover).
 * A throw here would take out the whole readout rather than one button, so each
 * stage swallows its own failure and the jump degrades to a silent no-op when
 * the shell has a different shape.
 *
 * @param get - the entry's soft service probe (`ctx.get`), which returns
 *   `undefined` for an absent service instead of throwing. Called HERE, on every
 *   invocation, so a service that appears after `apply` is still found.
 * @param options - label thunk (required for route 2) plus test seams.
 * @returns whether a route was taken. `false` means `onGiveUp` already ran or
 *   there was nothing to fall back to.
 */
export function openPluginSettingsPage(
  get: (name: string) => unknown,
  options: SettingsRouteOptions,
): boolean {
  const { doc = document, label } = options
  const schedule = options.schedule ?? defaultSchedule

  // ---- Route 1: the shell's own store seat (exact, one call) --------------
  let seatResult: 'opened' | 'shell' | undefined
  try {
    seatResult = openThroughStoreSeat(get, TRAE_SETTINGS_ID)
  } catch {
    // The probe itself must not be able to break the button.
    seatResult = undefined
  }
  if (seatResult === 'opened') return true
  // `'shell'`: the dialog is open but on another section — fall through so
  // route 2 can click this plugin's row. The panel being open is exactly the
  // state route 2 detects, so it will not re-click the trigger.

  // ---- Route 2: drive the chrome -----------------------------------------
  try {
    const existing = doc.querySelector(SETTINGS_PANEL_SELECTOR)
    if (existing === null) {
      const triggers = Array.from(doc.querySelectorAll<HTMLButtonElement>(SETTINGS_TRIGGER_SELECTOR))
      const collapsed = triggers.find(button => button.getAttribute('aria-expanded') !== 'true')
      // No trigger at all = this host has no settings panel, or the sidebar is
      // collapsed to the rail. Do not guess: take the fallback rather than
      // leaving a button that does nothing when pressed.
      if (collapsed === undefined) {
        try { options.onGiveUp?.() } catch { /* the fallback failing is still a no-op */ }
        return false
      }
      collapsed.click()
    }

    let clicked = false
    let remaining = RETRY_DELAYS_MS.length
    for (const delay of RETRY_DELAYS_MS) {
      schedule(() => {
        if (clicked) return
        remaining -= 1
        try {
          const scope = doc.querySelector(SETTINGS_PANEL_SELECTOR) ?? doc
          const row = findSectionRow(scope, label())
          if (row !== undefined) {
            clicked = true
            row.click()
            return
          }
        } catch { /* shell shaped differently: this attempt is done, next runs */ }
        // Out of retries and still no row: hand over to the caller's fallback.
        // Deliberately AFTER the last attempt rather than on the first miss — a
        // panel that has mounted while its rows are still rendering is normal.
        if (remaining === 0) {
          try { options.onGiveUp?.() } catch { /* the fallback failing is still a no-op */ }
        }
      }, delay)
    }
    return true
  } catch {
    return false
  }
}
