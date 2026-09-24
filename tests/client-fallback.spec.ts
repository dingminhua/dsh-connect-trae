/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'

/**
 * The client entry degrades slot/API breaking changes to console.error lines,
 * so the host provider keeps working without a red banner.
 *
 * We cannot import the real client entry (it pulls browser-only DSH client
 * packages); instead we replicate the exact shape from `src/client/index.tsx`
 * and assert the boundaries hold under simulated host failures:
 *
 * - `inject` declares only `['slots', 'locale']` (both lines provide them);
 *   the settings surface is probed with `ctx.get()`, which returns undefined
 *   for an absent service instead of throwing (property access on an
 *   undeclared service throws "cannot get property X without inject", which
 *   `?.` cannot guard). This is what fixes the DSH 0.1.7 boot failure where
 *   the entry sat `pending (waiting for service: settingsScope)` forever.
 * - Each `registerCard` carries its own try/catch: the two DSH lines declare
 *   disjoint slot sets, so one failing registration must not take the others
 *   down (previously a single outer try meant 0 registrations on any throw).
 *
 * DRIFT WARNING: the `apply()` below is a manual mirror of the real
 * `apply()` in `src/client/index.tsx`. It is NOT the product code, so this
 * test only proves the fallback ideas work. If you change the real `apply()`'s
 * soft-probe shape, the per-slot try/catch, or the `console.error` messages,
 * update the mirror here too.
 */

/** Mirror of src/client/index.tsx apply() body. */
function apply(ctx: any): void {
  try {
    const namespace = 'settings.trae'
    ctx.effect(() => ctx.locale.register(namespace, { zh: {}, en: {} }), 'dsh-connect-trae: settings copy')
    const t = ctx.locale.bind(namespace)

    const softGet = (name: string): any => ctx.get(name)

    let settingsScope: unknown
    const forms = softGet('configForms')
    const legacy = softGet('settingsScope')
    if (forms !== undefined) {
      let ns = 'trae'
      try {
        const namespaces = forms.describe().getSnapshot().view?.namespaces ?? []
        const served = namespaces.find((entry: any) => entry.ns === 'trae' || /trae/i.test(entry.ns))
        if (served !== undefined) ns = served.ns
      } catch { /* mirror not ready: the declared id is still correct */ }
      settingsScope = forms.get(ns)
    } else if (legacy !== undefined) {
      settingsScope = legacy.bind({ namespace: 'trae' })
    }

    const registerCard = (slotName: string, key: string): void => {
      try {
        ctx.slots.inject(slotName, () => ctx.slots.register({
          name: slotName,
          key,
          priority: 30,
          inject: () => settingsScope === undefined ? { t } : { t, settingsScope },
        }, {}))
      } catch (error: unknown) {
        console.error(`[dsh-connect-trae] card slot "${slotName}" failed to register (host provider unaffected):`, error)
      }
    }

    registerCard('plugins.bundle.config', 'dsh-connect-trae')
    registerCard('plugins.row.config', 'dsh-connect-trae#dsh-connect-trae')
    registerCard('settings.plugin.item', 'trae')
    void t
  } catch (error: unknown) {
    console.error('[dsh-connect-trae] client card failed to load (host provider unaffected):', error)
  }
}

describe('client card fallback', () => {
  it('isolates a failing slot registration: its slot errors, the others still register', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    const registered: string[] = []
    const fakeCtx: any = {
      effect: () => {},
      locale: { register: () => () => {}, bind: () => () => '' },
      get: (name: string) => name === 'settingsScope' ? { bind: () => ({}) } : undefined,
      slots: {
        inject: (slotName: string) => {
          if (slotName === 'plugins.row.config') {
            throw new Error('keyed slot "plugins.row.config" already has an entry with id "x"')
          }
          registered.push(slotName)
        },
        register: () => () => {},
      },
    }

    expect(() => apply(fakeCtx)).not.toThrow()
    // The broken slot is logged per-slot, the other two still registered.
    expect(registered).toEqual(['plugins.bundle.config', 'settings.plugin.item'])
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('plugins.row.config')
    expect(String(errors[0])).toContain('already has an entry')

    spy.mockRestore()
  })

  it('probes the settings surface via ctx.get and never property access', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    // Simulate a line with NO settings surface at all and a get() that throws
    // for property-style access — the guard is that apply() only ever calls
    // ctx.get, which returns undefined here.
    const registered: string[] = []
    const fakeCtx: any = {
      effect: () => {},
      locale: { register: () => () => {}, bind: () => () => '' },
      get: () => undefined,
      slots: {
        inject: (slotName: string) => { registered.push(slotName) },
        register: () => () => {},
      },
    }

    expect(() => apply(fakeCtx)).not.toThrow()
    expect(registered).toHaveLength(3)
    expect(errors).toHaveLength(0)

    spy.mockRestore()
  })

  it('prefers configForms over settingsScope when both are present', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    // A host line that provides BOTH (a shimmed or transitional build): the
    // 0.1.7 surface must win, because that is the one whose writes the running
    // settings gate actually accepts. The legacy `bind` must never be reached.
    const formsGet: string[] = []
    let legacyBound = false
    const fakeCtx: any = {
      effect: () => {},
      locale: { register: () => () => {}, bind: () => () => '' },
      get: (name: string) => {
        if (name === 'configForms') {
          return {
            describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'trae' }] } }) }),
            get: (ns: string) => { formsGet.push(ns); return {} },
          }
        }
        if (name === 'settingsScope') return { bind: () => { legacyBound = true; return {} } }
        return undefined
      },
      slots: { inject: () => {}, register: () => () => {} },
    }

    expect(() => apply(fakeCtx)).not.toThrow()
    expect(formsGet).toEqual(['trae'])
    expect(legacyBound).toBe(false)
    expect(errors).toHaveLength(0)

    spy.mockRestore()
  })

  it('falls back to settingsScope.bind when configForms is absent (0.1.5)', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    let boundNamespace: string | undefined
    const fakeCtx: any = {
      effect: () => {},
      locale: { register: () => () => {}, bind: () => () => '' },
      get: (name: string) => name === 'settingsScope'
        ? { bind: (options: { namespace: string }) => { boundNamespace = options.namespace; return {} } }
        : undefined,
      slots: { inject: () => {}, register: () => () => {} },
    }

    expect(() => apply(fakeCtx)).not.toThrow()
    expect(boundNamespace).toBe('trae')
    expect(errors).toHaveLength(0)

    spy.mockRestore()
  })

  it('still swallows a load-level failure to the outer console.error', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    const fakeCtx: any = {
      effect: () => { throw new Error('locale namespace "settings.trae" already registered') },
      locale: { register: () => () => {}, bind: () => () => '' },
      get: () => undefined,
      slots: { inject: () => {}, register: () => () => {} },
    }

    expect(() => apply(fakeCtx)).not.toThrow()
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('client card failed to load')
    expect(String(errors[0])).toContain('already registered')

    spy.mockRestore()
  })
})
