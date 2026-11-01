/**
 * The route from the composer credit readout to THIS plugin's settings page.
 *
 * ## Why a module and not three lines inside `apply`
 *
 * The entry (`src/client/index.tsx`) imports browser-only DSH packages the Node
 * test environment cannot load, so anything worth asserting on has to live
 * outside it — the same seam `panel-switch.ts` provides for the sidebar opt-in.
 * The spec then exercises the REAL decision instead of a mirror of it.
 *
 * ## Why two routes
 *
 * On this host line a plugin's settings are not a "page in Settings": the
 * Plugins page owns them, and each bundle's page (`plugins.bundle.config` /
 * `plugins.row.config`) IS the configuration surface — Settings keeps only the
 * read-only built-in inventory. So "open the plugin settings" means "open the
 * Plugins page on this bundle", and the supported way to ask for that is the
 * `pluginNavigation` service the Plugins page provides: `openBundle(packageName)`
 * selects that page without touching the Session.
 *
 * `pluginNavigation` is provided by `@deepseek-ai/dsh-client-ui-plugin-manager`,
 * NOT by the shell. A profile can be composed without it, and plugin load order
 * is not something a contributor may assume — so the probe happens at CALL time
 * rather than at registration time. Probing once in `apply` would capture
 * `undefined` on a page whose Plugins bundle simply applied after ours, and the
 * button would be dead for the rest of the session with nothing to re-evaluate it.
 *
 * The fallback reaches the SAME page through the lower-level `layout` service.
 * `selectPanel('plugins')` is the shipped main key of the Plugins page (the
 * plugin-manager bundle registers `sidebar.panellist` id / `main` key
 * `'plugins'`), so a host without `pluginNavigation` still lands the user where
 * the settings are, one click from the row. It is a fallback and not the primary
 * route deliberately: `'plugins'` is another package's private key, while
 * `openBundle` is that package's published seam. `selectPanel` THROWS when the
 * key is not registered (Plugins page disabled, trimmed profile), so the call is
 * guarded rather than trusted.
 *
 * ## Why `false` rather than an exception
 *
 * The caller is a popover button. There is no supported host line lacking both
 * routes, but "cannot" must not become a thrown error inside a click handler on
 * a user's machine; it becomes a `false` the caller reports, and a button that
 * stays honest about it.
 */

/**
 * The package name the Plugins page knows this plugin by.
 *
 * `openBundle` matches the inventory's `pkg.name` by EXACT equality, and that
 * name is the profile's package name — the npm package name — not the Loader
 * entry id (which on a live Desktop profile can be `include:dsh-connect-trae`).
 * This is the same reason the card registers under every spelling the host has
 * been observed to dispatch: the comparison is exact and the deployment picks
 * the spelling. The inventory side of that comparison is the package name in
 * every composition observed, so that is what `openBundle` is asked for.
 *
 * Deliberately ONE name, not a list: `openBundle` selects a target and an
 * unknown target renders the LIST, so a second call with a spelling the
 * inventory does not hold would undo the first one's navigation.
 */
export const TRAE_PACKAGE_NAME = 'dsh-connect-trae'

/** The shipped `main` / `sidebar.panellist` key of the Plugins page. */
export const PLUGINS_PANEL_ID = 'plugins'

/** The slice of `pluginNavigation` this module calls. */
export interface PluginNavigationLike {
  openBundle?: (packageName: string) => void
}

/** The slice of `layout` this module calls. */
export interface LayoutNavigationLike {
  selectPanel?: (panelId: string | null) => void
}

/**
 * Open this plugin's settings page.
 *
 * @param get - the entry's soft service probe (`ctx.get`), which returns
 *   `undefined` for an absent service instead of throwing. Called HERE, on every
 *   invocation, so a service that appears after `apply` is still found.
 * @returns whether a route was taken. `false` means the caller's control should
 *   report that this host has no way there — see the module note.
 */
export function openPluginSettingsPage(get: (name: string) => unknown): boolean {
  const navigation = get('pluginNavigation') as PluginNavigationLike | undefined
  if (navigation !== undefined && typeof navigation.openBundle === 'function') {
    try {
      navigation.openBundle(TRAE_PACKAGE_NAME)
      return true
    } catch {
      // The page refused (a profile whose inventory does not list this package).
      // Fall through: the Plugins page itself is still a better landing spot
      // than doing nothing, because the row is there to be found.
    }
  }
  const layout = get('layout') as LayoutNavigationLike | undefined
  if (layout !== undefined && typeof layout.selectPanel === 'function') {
    try {
      layout.selectPanel(PLUGINS_PANEL_ID)
      return true
    } catch {
      // `selectPanel` throws when the key has no registration (Plugins page
      // disabled, or a stripped profile). Nothing left to try.
    }
  }
  return false
}
