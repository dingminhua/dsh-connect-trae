import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as Trae from '../src/index.ts'
import {
  nextRegionEnabled,
  nextRegionSlots,
  regionEnabledOf,
  unwrapVolatile,
  unwrapVolatileDeep,
} from '../src/status-paths.ts'

/**
 * DSH 0.1.7 changed three things this plugin depends on, and each one fails
 * SILENTLY rather than loudly — which is why they are pinned here:
 *
 *   1. A volatile-marked settings field is handed to `apply()` as a
 *      `{get(): T}` live reference. Reading it directly yields an object (or
 *      `undefined` for a nested lookup), so "settings written but not read
 *      back" is the only symptom.
 *   2. Spreading such a reference produces `{get: <function>}` rather than the
 *      value, so a merge that preserves sibling regions DROPS them.
 *   3. The settings write gate REJECTS every write unless the schema marks its
 *      writable fields volatile (`Plugin entry "trae" has no volatile
 *      fields`), while `set()` still resolves — so a save looks successful and
 *      silently reverts.
 */

/** A live reference, exactly as 0.1.7 delivers a volatile field. */
function live<T>(value: T): { get: () => T } {
  return { get: () => value }
}

describe('unwrapVolatile', () => {
  it('peels one live reference', () => {
    expect(unwrapVolatile(live({ cn: 'acc-1' }))).toEqual({ cn: 'acc-1' })
  })

  it('leaves a plain value untouched', () => {
    const plain = { cn: 'acc-1' }
    expect(unwrapVolatile(plain)).toBe(plain)
    expect(unwrapVolatile(undefined)).toBeUndefined()
  })

  it('does not mistake a plain object with an unrelated shape for a reference', () => {
    expect(unwrapVolatile({ get: 'not-a-function' })).toEqual({ get: 'not-a-function' })
  })
})

describe('unwrapVolatileDeep', () => {
  it('peels nested references, including inside arrays', () => {
    const value = {
      regions: live({
        cn: live({ enabledModelIds: live(['a', 'b']) }),
        ai: live({ enabledModelIds: ['c'] }),
      }),
      accounts: live({ cn: 'acc-1' }),
    }
    expect(unwrapVolatileDeep(value)).toEqual({
      regions: { cn: { enabledModelIds: ['a', 'b'] }, ai: { enabledModelIds: ['c'] } },
      accounts: { cn: 'acc-1' },
    })
  })

  it('rebuilds rather than mutating, so the caller value is untouched', () => {
    const inner = { cn: 'acc-1' }
    const source = { accounts: live(inner) }
    const out = unwrapVolatileDeep(source)
    expect(out).not.toBe(source)
    expect(out.accounts).not.toBe(inner)
    // The original still carries its live reference.
    expect(typeof (source.accounts as { get?: unknown }).get).toBe('function')
  })

  it('passes primitives and null through', () => {
    expect(unwrapVolatileDeep('x')).toBe('x')
    expect(unwrapVolatileDeep(7)).toBe(7)
    expect(unwrapVolatileDeep(null)).toBeNull()
  })
})

describe('region reads over live references (0.1.7)', () => {
  /**
   * The regression this pins: `regions` arrives as a live reference, passes a
   * `typeof === 'object'` check, and every lookup on it returns `undefined`.
   * The user's saved model picks would read back as "nothing saved" while the
   * document plainly holds them.
   */
  it('reads a stored slot through the live reference', () => {
    const value = { regions: live({ cn: live({ enabledModelIds: ['kimi-k2.6'] }) }) }
    expect(regionEnabledOf(value, 'cn')).toBe(true)
    expect(Trae.regionStateOf(value as never, 'cn').enabledModelIds).toEqual(['kimi-k2.6'])
  })

  it('reads the opt-out flag through the live reference', () => {
    const off = { regions: live({ cn: live({ enabled: false }) }) }
    expect(regionEnabledOf(off, 'cn')).toBe(false)
    expect(Trae.regionEnabled(off as never, 'cn')).toBe(false)
  })

  it('carries the sibling region through a merge instead of dropping it', () => {
    // Without unwrapping, `{...ref}` is `{get: fn}`: the CN slot would vanish
    // and a function would leak into the document.
    const value = { regions: live({ cn: live({ enabledModelIds: ['a'] }), ai: live({ enabledModelIds: ['b'] }) }) }
    const next = nextRegionEnabled(value, 'ai', false)
    expect(Object.keys(next).sort()).toEqual(['ai', 'cn'])
    expect((next.cn as { enabledModelIds?: unknown }).enabledModelIds).toEqual(['a'])
    expect((next.ai as { enabled?: unknown }).enabled).toBe(false)
  })

  it('never leaks a function into the value written back', () => {
    const value = { regions: live({ cn: live({ enabled: true }) }) }
    const next = nextRegionSlots(value, 'ai', { enabled: false })
    for (const slot of Object.values(next)) {
      expect(typeof (slot as { get?: unknown }).get).toBe('undefined')
    }
  })
})

describe('asVolatile', () => {
  /**
   * The marker is what 0.1.7's write gate looks for. The helper probes the
   * resolved schemastery's capability (the no-op arm guards a resolution older
   * than 3.18.3) rather than assuming it, so the test is meaningful on either
   * pin — asserted against the ACTUAL capability so it cannot pass on a
   * hardcoded expectation.
   */
  it('matches the capability of the schemastery actually installed', () => {
    const schema = { description: () => schema } as unknown as Parameters<typeof Trae.asVolatile>[0]
    const supports = typeof (schema as { volatile?: unknown }).volatile === 'function'
    const marked = Trae.asVolatile(schema)
    if (supports) {
      // A supporting schemastery returns its own (possibly new) schema.
      expect(marked).toBeDefined()
    } else {
      // The no-op arm must be identity, not a copy.
      expect(marked).toBe(schema)
    }
  })

  it('is an identity no-op when volatile() is absent', () => {
    const schema = { description: () => schema, toJSON: () => ({}) } as unknown as Parameters<typeof Trae.asVolatile>[0]
    if (typeof (schema as { volatile?: unknown }).volatile === 'function') return
    expect(Trae.asVolatile(schema)).toBe(schema)
  })
})

describe('settings service shape (0.1.7)', () => {
  /**
   * `SettingsForms` (0.1.7) dropped `installSection` and exposes
   * `configure({auto}, owner)`. Calling the removed method unconditionally made
   * `apply()` throw on 0.1.7 (`ctx.settings.installSection is not a function`);
   * because the call sat inside a nested `ctx.inject` callback, the throw
   * landed in THAT child fiber — the providers still registered, but the `trae`
   * settings namespace never did, so the card's settings area silently
   * disappeared. Since 2.3.0 the plugin supports 0.1.7-rc.1 and up only, so
   * `configure` is the sole path, called unconditionally.
   */
  let context: Context | undefined
  let restoreHome: (() => void) | undefined
  afterEach(async () => {
    // Settle before disposing: the plugin starts a loopback shim (a real HTTP
    // server), and disposing mid-startup races its `close()` into an
    // "Server is not running" unhandled rejection.
    await context?.fiber.dispose()
    context = undefined
    restoreHome?.()
    restoreHome = undefined
  })

  it('uses configure() when the service provides it, and never installSection', async () => {
    const ctx = new Context()
    context = ctx
    const calls: { auto?: boolean }[] = []

    // A real Service subclass whose shape matches 0.1.7: `configure` present,
    // `installSection` absent. Registering it as a genuine service is what
    // makes the plugin's `ctx.inject(['settings'], …)` callback fire exactly
    // as it would against a real 0.1.7 host.
    class ConfigureOnlySettings extends Service {
      constructor(owner: Context) { super(owner, 'settings') }
      configure(presentation: { auto?: boolean }): () => void {
        calls.push(presentation)
        return () => {}
      }
    }

    const errors: unknown[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args) })

    // Isolate the plugin from the machine's real Trae state and DSH home, the
    // same way `settings-integration.spec.ts` does.
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-trae-compat-home-'))
    restoreHome = () => {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }

    await ctx.plugin(LlmRuntime)
    await ctx.plugin(ConfigureOnlySettings)
    await ctx.plugin(Trae, { edition: 'auto', authFile: '/nonexistent/dsh-connect-trae-test-storage.json' })

    // Let startup finish (shim ready) so teardown is orderly, then assert.
    await expect.poll(() => ctx.llm.listProviders().map(provider => provider.id)).toContain('trae')
    await vi.waitFor(() => { expect(calls.length).toBeGreaterThan(0) })

    // The 0.1.7-shaped service is reached and `configure` is the path taken.
    expect(calls[0]).toEqual({ auto: true })
    // And nothing threw an installSection TypeError into the loader.
    expect(errors.filter(entry => String((entry as unknown[])[0]).includes('installSection'))).toHaveLength(0)

    spy.mockRestore()
  })
})
