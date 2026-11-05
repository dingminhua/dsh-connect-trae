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
 * - `inject` declares only `['slots', 'locale']`; the settings surface is
 *   probed with `ctx.get()`, which returns undefined for an absent service
 *   instead of throwing (property access on an undeclared service throws
 *   "cannot get property X without inject", which `?.` cannot guard). This is
 *   what fixed the DSH 0.1.7 boot failure where the entry sat
 *   `pending (waiting for service: settingsScope)` forever.
 * - The settings scope is a RE-BINDING proxy: it resolves the namespace the
 *   host serves from the describe mirror and re-binds whenever the mirror
 *   changes. A card whose entry appeared after the mirror's first load (this
 *   plugin, added to a running profile) would otherwise be stuck on the
 *   declared fallback `trae` and every write would be refused.
 * - Each slot contribution carries its own try/catch: a failed registration
 *   must not take the other slots down.
 *
 * DRIFT WARNING: the `apply()` below is a manual mirror of the real
 * `apply()` in `src/client/index.tsx`. It is NOT the product code, so this
 * test only proves the fallback IDEAS work. The guard that issue #74 actually
 * needed — catching inside the `inject` callback, because `inject` may defer it
 * past any call-site try/catch — is NOT mirrored here; it is asserted against
 * the real entry in `tests/client-activation.spec.tsx`. If you change the real
 * `apply()`'s soft-probe shape, the re-binding proxy, the per-slot disposal, or
 * the `console.error` messages, update the mirror here too.
 */

/** Mirror of src/client/index.tsx apply() body. */
function apply(ctx: any): void {
  try {
    const namespace = 'settings.trae'
    ctx.effect(() => ctx.locale.register(namespace, { zh: {}, en: {} }), 'dsh-connect-trae: settings copy')
    const t = ctx.locale.bind(namespace)

    const softGet = (name: string): any => ctx.get(name)
    const forms = softGet('configForms')

    const settingsScope: any = (() => {
      let current: any
      let currentOff: (() => void) | undefined
      let refreshedOnce = false
      const listeners = new Set<() => void>()
      const notify = (): void => { for (const listener of [...listeners]) listener() }
      const scope = {
        getSnapshot: () => current?.getSnapshot() ?? { status: 'unavailable', value: undefined, writable: false },
        subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
        set: (field: string, value: unknown) => current !== undefined ? current.set(field, value) : Promise.resolve(false),
      }
      const rebind = (): void => {
        let served: { ns: string } | undefined
        try {
          const namespaces = forms?.describe().getSnapshot().view?.namespaces ?? []
          served = namespaces.find((entry: any) => entry.ns === 'trae' || /trae/i.test(entry.ns))
        } catch { /* mirror not ready: keep the current binding */ }
        const next = served === undefined || forms === undefined ? undefined : forms.get(served.ns)
        if (next !== current) {
          currentOff?.()
          current = next
          currentOff = current?.subscribe(notify)
          notify()
        }
        // The mirror may have settled before this entry existed; nudge a
        // re-describe once (answer lands through the mirror update).
        if (next === undefined && !refreshedOnce) {
          refreshedOnce = true
          try { forms?.describe().load?.() } catch { /* ignore */ }
        }
      }
      // Try immediately (the mirror may already be ready), then follow it.
      rebind()
      forms?.describe().subscribe?.(rebind)
      return scope
    })()

    // The configuration page is a `settings.section` entry now, registered from
    // ONE callback together with its nav glyph (see the real entry for why the
    // pairing is structural). The mirror keeps that shape so the per-slot
    // isolation it exercises is the shape the product has.
    const registerSettingsPage = (): void => {
      try {
        ctx.slots.inject('settings.section', () => {
          const disposers: Array<() => void> = []
          disposers.push(ctx.slots.register({
            name: 'settings.section',
            id: 'dsh-connect-trae',
            order: 30,
            label: () => 'Trae',
            locale: namespace,
            inject: () => ({ t, settingsScope, surface: 'section' }),
          }, {}))
          try {
            disposers.push(ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
              name: 'settings.section.icon',
              id: 'dsh-connect-trae',
              locale: namespace,
            }, {})))
          } catch (error: unknown) {
            console.error('[dsh-connect-trae] settings nav icon failed to register (page unaffected):', error)
          }
          return () => { for (const dispose of disposers) dispose() }
        })
      } catch (error: unknown) {
        console.error('[dsh-connect-trae] settings section page failed to register (host provider unaffected):', error)
      }
    }

    registerSettingsPage()

    // Mirror of the model-picker label registration: own try/catch, so a host
    // that does not serve the slot cannot take the card down with it. The
    // priority is mirrored too (issue #74): registering at the default 0 is
    // what collided with the host's own badge and with this plugin's earlier
    // run. The REAL guard lives in `registerSlotEntry` (the catch has to be
    // inside the callback, because `inject` may defer it); this mirror keeps
    // the shape recognisable rather than proving that guard, which
    // `tests/client-activation.spec.tsx` does against the real `apply()`.
    const registerModelLabel = (): void => {
      try {
        ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register(
          { name: 'conversation.input.model.label', priority: -0.25 }, {},
        ))
      } catch (error: unknown) {
        console.error('[dsh-connect-trae] model label slot failed to register (host provider unaffected):', error)
      }
    }

    registerModelLabel()
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
      get: () => undefined,
      slots: {
        inject: (slotName: string) => {
          if (slotName === 'settings.section') {
            throw new Error('slot "settings.section" is already declared by another bundle')
          }
          registered.push(slotName)
        },
        register: () => () => {},
      },
    }

    expect(() => apply(fakeCtx)).not.toThrow()
    // The broken slot is logged per-slot; the others still registered — and in
    // particular the model-picker label, which is on an unrelated seam.
    expect(registered).toEqual(['conversation.input.model.label'])
    expect(errors).toHaveLength(1)
    expect(String(errors[0])).toContain('settings.section')
    expect(String(errors[0])).toContain('already declared')

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
    // Two injects happen at APPLY time: the settings page and the model-picker
    // label. The nav glyph's `inject` lives INSIDE the page's callback, and this
    // double never runs callbacks (the slot is treated as undeclared), which is
    // exactly the deferred case — so it must not appear here either.
    expect(registered).toEqual(['settings.section', 'conversation.input.model.label'])
    expect(errors).toHaveLength(0)

    spy.mockRestore()
  })

  it('binds to the namespace the mirror serves, through configForms only', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    // The 0.1.7 surface is the ONLY settings path. The mirror serves the
    // patch-id namespace (`dsh-connect-trae`), not the declared fallback
    // (`trae`), and the scope must land on it — a legacy `settingsScope`
    // service must be ignored outright.
    const formsGet: string[] = []
    let legacyBound = false
    const fakeCtx: any = {
      effect: () => {},
      locale: { register: () => () => {}, bind: () => () => '' },
      get: (name: string) => {
        if (name === 'configForms') {
          return {
            describe: () => ({ getSnapshot: () => ({ view: { namespaces: [{ ns: 'dsh-connect-trae' }] } }) }),
            get: (ns: string) => { formsGet.push(ns); return { getSnapshot: () => ({ status: 'ready', value: {}, writable: true }), subscribe: () => () => {}, set: () => Promise.resolve(true) } },
          }
        }
        if (name === 'settingsScope') return { bind: () => { legacyBound = true; return {} } }
        return undefined
      },
      slots: { inject: () => {}, register: () => () => {} },
    }

    expect(() => apply(fakeCtx)).not.toThrow()
    expect(formsGet).toEqual(['dsh-connect-trae'])
    expect(legacyBound).toBe(false)
    expect(errors).toHaveLength(0)

    spy.mockRestore()
  })

  it('rebinds when the mirror gains the namespace after apply()', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    // The regression this pins: the plugin's entry appeared AFTER the mirror's
    // first load, so at apply() time the mirror has no trae namespace and the
    // one-shot bind fell back to `trae` — the host refuses every write
    // (`No configurable plugin entry "trae"`). The scope must re-bind once the
    // mirror reports the entry.
    let namespaces: { ns: string }[] = []
    const mirrorListeners = new Set<() => void>()
    const formsGet: string[] = []
    const fakeCtx: any = {
      effect: () => {},
      locale: { register: () => () => {}, bind: () => () => '' },
      get: (name: string) => name === 'configForms'
        ? {
            describe: () => ({
              getSnapshot: () => ({ view: { namespaces } }),
              subscribe: (listener: () => void) => { mirrorListeners.add(listener); return () => { mirrorListeners.delete(listener) } },
            }),
            get: (ns: string) => { formsGet.push(ns); return { getSnapshot: () => ({ status: 'ready', value: {}, writable: true }), subscribe: () => () => {}, set: () => Promise.resolve(true) } },
          }
        : undefined,
      slots: { inject: () => {}, register: () => () => {} },
    }

    expect(() => apply(fakeCtx)).not.toThrow()
    // Nothing to bind yet — the fallback `trae` must NOT be requested.
    expect(formsGet).toEqual([])

    // The mirror populates (profile reload / describe settling) and notifies.
    namespaces = [{ ns: 'dsh-connect-trae' }]
    for (const listener of [...mirrorListeners]) listener()

    expect(formsGet).toEqual(['dsh-connect-trae'])
    expect(errors).toHaveLength(0)

    spy.mockRestore()
  })

  it('nudges the mirror to re-describe once when the entry is missing at apply', () => {
    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    // A mirror that already settled WITHOUT the trae entry would never surface
    // it on its own; the scope must trigger one refresh so the entry (and the
    // host's `settings/document-updated` keep-alive) can arrive.
    const loads: number[] = []
    const fakeCtx: any = {
      effect: () => {},
      locale: { register: () => () => {}, bind: () => () => '' },
      get: (name: string) => name === 'configForms'
        ? {
            describe: () => ({
              getSnapshot: () => ({ view: { namespaces: [] } }),
              subscribe: () => () => {},
              load: () => { loads.push(1) },
            }),
            get: () => { throw new Error('must not bind before the namespace is served') },
          }
        : undefined,
      slots: { inject: () => {}, register: () => () => {} },
    }

    expect(() => apply(fakeCtx)).not.toThrow()
    // Exactly one nudge: repeated mirror updates must not loop re-describes.
    expect(loads).toEqual([1])
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
