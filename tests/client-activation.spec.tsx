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
 */

/** The services every line provides. */
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

/** The 0.1.7 settings surface: `configForms`, and NO `settingsScope`. */
class ConfigForms extends Service {
  readonly requested: string[] = []
  constructor(owner: Context) { super(owner, 'configForms') }
  describe(): { getSnapshot(): { view: { namespaces: { ns: string }[] } } } {
    return { getSnapshot: () => ({ view: { namespaces: [{ ns: 'trae' }] } }) }
  }
  get(ns: string): unknown {
    this.requested.push(ns)
    return { getSnapshot: () => ({ status: 'ready', value: {}, writable: true }), subscribe: () => () => {}, set: () => Promise.resolve(true) }
  }
}

type PluginShape = Parameters<Context['plugin']>[0]

async function boot(plugins: PluginShape[]): Promise<Context> {
  const ctx = new Context()
  for (const plugin of plugins) await ctx.plugin(plugin)
  return ctx
}

describe('client entry activation across host lines', () => {
  it('ACTIVATES on a 0.1.7-shaped host that provides configForms and no settingsScope', async () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    const ctx = await boot([Slots, Locale, ConfigForms])
    const fiber = ctx.plugin(clientEntry as unknown as PluginShape)

    // The regression: with `settingsScope` in `inject`, this fiber stayed
    // PENDING (0) forever because the service never appears.
    await vi.waitFor(() => { expect(fiber.state).toBe(2) /* ACTIVE */ })

    const slots = ctx.get('slots') as unknown as Slots
    const forms = ctx.get('configForms') as unknown as ConfigForms
    // The 0.1.7 slots are registered, and the scope came from configForms.
    expect(slots.registrations.map(entry => entry.name).sort())
      .toEqual(['plugins.bundle.config', 'plugins.row.config', 'settings.plugin.item'])
    expect(forms.requested).toEqual(['trae'])
    expect(errors).toHaveLength(0)

    spy.mockRestore()
    await ctx.fiber.dispose()
  })

  it('ACTIVATES on a 0.1.5-shaped host that provides settingsScope and no configForms', async () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    const bound: string[] = []
    class LegacySettingsScope extends Service {
      constructor(owner: Context) { super(owner, 'settingsScope') }
      bind(options: { namespace: string }): unknown {
        bound.push(options.namespace)
        return { getSnapshot: () => ({ status: 'ready', value: {}, writable: true }), subscribe: () => () => {}, set: () => Promise.resolve() }
      }
    }

    const ctx = await boot([Slots, Locale, LegacySettingsScope])
    const fiber = ctx.plugin(clientEntry as unknown as PluginShape)
    await vi.waitFor(() => { expect(fiber.state).toBe(2) })

    expect(bound).toEqual(['trae'])
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

    // A missing settings surface must not cost the card its slot: only saving
    // needs the scope, so the card still registers and renders read-only.
    const slots = ctx.get('slots') as unknown as Slots
    expect(slots.registrations).toHaveLength(3)
    expect(errors).toHaveLength(0)

    spy.mockRestore()
    await ctx.fiber.dispose()
  })
})
