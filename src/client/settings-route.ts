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
export function openPluginSettingsPage(get: (name: string) => unknown): boolean {
  const slots = get('slots') as SlotsLike | undefined
  if (slots === undefined || typeof slots.entries !== 'function') return false

  let seat: unknown
  try {
    // `entries` is a plain ledger read, but it is another bundle's service and a
    // composed profile can replace `slots` with something that throws here.
    seat = slots.entries(SETTINGS_SLOT)[0]?.store
  } catch {
    return false
  }
  if (seat === null || typeof seat !== 'object') return false

  const handle = seat as SettingsShellHandleLike
  if (typeof handle.create !== 'function') return false

  try {
    const instance = handle.create()
    const openSection = instance?.actions?.openSection
    if (typeof openSection === 'function') {
      openSection(TRAE_SETTINGS_ID)
      return true
    }
    // An older shell line whose store predates `openSection`: the dialog can
    // still be opened, just not preselected. That lands the user in Settings
    // with this plugin's nav row in front of them — one click from the page,
    // which is strictly better than a press that does nothing.
    const open = instance?.actions?.open
    if (typeof open === 'function') {
      open()
      return true
    }
  } catch {
    // `create()` or a baked action threw. Nothing left to try.
  }
  return false
}
