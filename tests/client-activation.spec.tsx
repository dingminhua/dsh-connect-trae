// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import * as clientEntry from '../src/client/index.tsx'

/**
 * Boots the REAL client entry against a simulated host line.
 *
 * This is the test that would have caught the shipped DSH 0.1.7 defect: on that
 * line `settingsScope` does not exist, so the entry's `inject` declaration kept
 * its fiber in `PENDING` forever — the plugin's browser half never ran, and the
 * user saw `web boot: 1 entry did not activate` /
 * `dsh-connect-trae: pending (waiting for service: settingsScope)`.
 *
 * `tests/client-fallback.spec.ts` cannot catch that: it mirrors the entry's
 * body by hand, so it exercises the IDEAS but never the real `inject` array.
 * Importing the real module is possible because its only runtime dependencies
 * are React and local files — every DSH package it names is a type-only import
 * and is erased at build time.
 *
 * The plugin targets DSH 0.1.7-rc.1 and up only, so the simulated lines are the
 * 0.1.7 shape (`configForms`, no `settingsScope`) and the no-settings-surface
 * shape (the card still renders, read-only).
 */

/** The services the 0.1.7 line provides. */
class Slots extends Service {
  readonly registrations: { name: string; key: string }[] = []
  constructor(owner: Context) { super(owner, 'slots') }
  inject(_name: string, callback: () => void): void { callback() }
  register(options: { name: string; key: string }): () => void {
    this.registrations.push({ name: options.name, key: options.key })
    return () => {}
  }
}

class Locale extends Service {
  constructor(owner: Context) { super(owner, 'locale') }
  register(): () => void { return () => {} }
  bind(): (key: string) => string { return key => key }
}

/**
 * The 0.1.7 settings surface: `configForms`, and NO `settingsScope`. The
 * mirror serves the patch-id namespace `dsh-connect-trae` — the shape the real
 * host reports (SettingsForms keys namespaces by `entry.options.id`, which the
 * include-wrapped loader keeps WITHOUT the `include:` prefix). A mutable
 * namespace list models the mirror gaining the entry after the client applied.
 */
class ConfigForms extends Service {
  readonly requested: string[] = []
  namespaces: { ns: string }[] = [{ ns: 'dsh-connect-trae' }]
  private readonly listeners = new Set<() => void>()
  constructor(owner: Context) { super(owner, 'configForms') }
  describe(): {
    getSnapshot(): { view: { namespaces: { ns: string }[] } }
    subscribe(listener: () => void): () => void
  } {
    return {
      getSnapshot: () => ({ view: { namespaces: this.namespaces } }),
      subscribe: (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } },
    }
  }
  get(ns: string): unknown {
    this.requested.push(ns)
    return { getSnapshot: () => ({ status: 'ready', value: {}, writable: true }), subscribe: () => () => {}, set: () => Promise.resolve(true) }
  }
  /** Publish a mirror change to subscribers (what the host does on describe). */
  publish(): void { for (const listener of [...this.listeners]) listener() }
}

type PluginShape = Parameters<Context['plugin']>[0]

async function boot(plugins: PluginShape[]): Promise<Context> {
  const ctx = new Context()
  for (const plugin of plugins) await ctx.plugin(plugin)
  return ctx
}

describe('client entry activation on 0.1.7', () => {
  it('ACTIVATES on a 0.1.7-shaped host and binds the served namespace', async () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    const ctx = await boot([Slots, Locale, ConfigForms])
    const fiber = ctx.plugin(clientEntry as unknown as PluginShape)

    // The regression: with `settingsScope` in `inject`, this fiber stayed
    // PENDING (0) forever because the service never appears.
    await vi.waitFor(() => { expect(fiber.state).toBe(2) /* ACTIVE */ })

    const slots = ctx.get('slots') as unknown as Slots
    const forms = ctx.get('configForms') as unknown as ConfigForms
    // The 0.1.7 slots are registered, and the scope came from configForms
    // bound to the namespace the mirror actually serves (the patch id, not the
    // declared fallback `trae`).
    expect(slots.registrations.map(entry => entry.name).sort())
      .toEqual(['plugins.bundle.config', 'plugins.row.config'])
    expect(forms.requested).toEqual(['dsh-connect-trae'])
    expect(errors).toHaveLength(0)

    spy.mockRestore()
    await ctx.fiber.dispose()
  })

  it('REBINDS the scope when the mirror gains the namespace after apply', async () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    // The regression this pins: this plugin was added to a RUNNING profile, so
    // at client-apply time the mirror had already loaded without the trae
    // entry. A one-shot bind fell back to `trae` and every write was refused
    // (`No configurable plugin entry "trae"`). The scope must re-bind once the
    // mirror reports the entry.
    const ctx = await boot([Slots, Locale, ConfigForms])
    const forms = ctx.get('configForms') as unknown as ConfigForms
    forms.namespaces = [] // mirror already settled before the entry appeared
    const fiber = ctx.plugin(clientEntry as unknown as PluginShape)
    await vi.waitFor(() => { expect(fiber.state).toBe(2) })

    // Nothing to bind yet — the fallback `trae` must NOT be requested.
    expect(forms.requested).toEqual([])

    // The host describe now reports the entry; the mirror notifies.
    forms.namespaces = [{ ns: 'dsh-connect-trae' }]
    forms.publish()
    await vi.waitFor(() => { expect(forms.requested).toEqual(['dsh-connect-trae']) })

    expect(errors).toHaveLength(0)

    spy.mockRestore()
    await ctx.fiber.dispose()
  })

  it('ACTIVATES even with no settings surface at all, degrading to read-only', async () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    const ctx = await boot([Slots, Locale])
    const fiber = ctx.plugin(clientEntry as unknown as PluginShape)
    await vi.waitFor(() => { expect(fiber.state).toBe(2) })

    // A missing settings surface must not cost the card its slots: only saving
    // needs the scope, so the card still registers (the scope stays unbound
    // and read-only).
    const slots = ctx.get('slots') as unknown as Slots
    expect(slots.registrations).toHaveLength(2)
    expect(errors).toHaveLength(0)

    spy.mockRestore()
    await ctx.fiber.dispose()
  })
})
