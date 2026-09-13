import { describe, expect, it } from 'vitest'
import type { TraeModelInfo } from '../src/catalog.ts'
import { traeEditionSlotOf, traeEditionState, traeModelSourceMode, type Config } from '../src/index.ts'

const CN_MODEL: TraeModelInfo = { id: 'glm-4.7', name: 'GLM-4.7', input: ['text'], creditMultiplier: 0.38 }
const SOLO_MODEL: TraeModelInfo = { id: 'kimi-k2.8-preview', name: 'Kimi-K2.8-Preview', input: ['text'], creditMultiplier: 0.98 }

describe('traeEditionSlotOf', () => {
  it('keys the slot on the CLIENT, not on the directory it is served from', () => {
    expect(traeEditionSlotOf('cn')).toBe('cn')
    expect(traeEditionSlotOf('solo')).toBe('solo')
    // The unverified sg editions share the cn slot rather than inventing a
    // third one.
    expect(traeEditionSlotOf('sg')).toBe('cn')
    expect(traeEditionSlotOf('solo-sg')).toBe('solo')
    expect(traeEditionSlotOf('auto')).toBe('cn')
    expect(traeEditionSlotOf(undefined)).toBe('cn')
  })
})

describe('traeModelSourceMode', () => {
  it('maps each client onto the directory that client actually shows', () => {
    // Established by the rate each client renders for `Seed-2.1-Pro`, the one
    // model the two sources price differently: Trae CN shows 0.80, which the
    // Remote directory reports, while TraeWork CN shows the post-discount 0.08
    // that only `get_detail_param` carries.
    expect(traeModelSourceMode('cn')).toBe('remote')
    expect(traeModelSourceMode('solo')).toBe('wire')
    expect(traeModelSourceMode('auto')).toBe('remote')
    // Unverified contracts keep the widest previous behaviour.
    expect(traeModelSourceMode('sg')).toBe('merge')
    expect(traeModelSourceMode('solo-sg')).toBe('merge')
  })
})

describe('traeEditionState', () => {
  it('returns the explicit slot when one exists', () => {
    const config = {
      editions: {
        cn: { lastCatalog: [CN_MODEL], enabledModelIds: ['glm-4.7'] },
        solo: { lastCatalog: [SOLO_MODEL], enabledModelIds: ['kimi-k2.8-preview'] },
      },
    } as Config
    expect(traeEditionState(config, 'cn').enabledModelIds).toEqual(['glm-4.7'])
    expect(traeEditionState(config, 'solo').enabledModelIds).toEqual(['kimi-k2.8-preview'])
    // The two slots are genuinely separate: neither leaks into the other.
    expect(traeEditionState(config, 'cn').lastCatalog?.[0]?.id).toBe('glm-4.7')
    expect(traeEditionState(config, 'solo').lastCatalog?.[0]?.id).toBe('kimi-k2.8-preview')
  })

  it('reads the legacy flat fields as the cn slot only', () => {
    // A config written before the split has only the flat fields. Those were
    // always captured from the Trae IDE, so they migrate to `cn`.
    const legacy = {
      lastCatalog: [CN_MODEL],
      enabledModelIds: ['glm-4.7'],
      imageModelIds: ['glm-4.7'],
      contextBudgets: { 'glm-4.7': 200_000 },
    } as Config
    const cn = traeEditionState(legacy, 'cn')
    expect(cn.lastCatalog?.[0]?.id).toBe('glm-4.7')
    expect(cn.enabledModelIds).toEqual(['glm-4.7'])
    expect(cn.imageModelIds).toEqual(['glm-4.7'])
    expect(cn.contextBudgets).toEqual({ 'glm-4.7': 200_000 })
    // The solo slot must NEVER inherit them: that inheritance is exactly the
    // bug where a CN selection was intersected with the Remote directory and
    // every id it does not list vanished.
    expect(traeEditionState(legacy, 'solo')).toEqual({})
  })

  it('prefers an explicit slot over the legacy fields', () => {
    const config = {
      lastCatalog: [CN_MODEL],
      enabledModelIds: ['glm-4.7'],
      editions: { cn: { lastCatalog: [SOLO_MODEL], enabledModelIds: ['kimi-k2.8-preview'] } },
    } as Config
    expect(traeEditionState(config, 'cn').enabledModelIds).toEqual(['kimi-k2.8-preview'])
  })

  it('still migrates the pre-split generated `models` list as the cn directory', () => {
    const config = { models: [CN_MODEL], enabledModelIds: ['glm-4.7'] } as Config
    expect(traeEditionState(config, 'cn').lastCatalog?.[0]?.id).toBe('glm-4.7')
  })

  it('is empty for an unconfigured plugin', () => {
    expect(traeEditionState({} as Config, 'cn')).toEqual({})
    expect(traeEditionState({} as Config, 'solo')).toEqual({})
  })
})
