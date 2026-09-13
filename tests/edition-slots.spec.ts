import { describe, expect, it } from 'vitest'
import type { TraeModelInfo } from '../src/catalog.ts'
import { traeEditionSlotOf, traeEditionState, traeModelSourceMode, type Config } from '../src/index.ts'

const CN_MODEL: TraeModelInfo = { id: 'glm-4.7', name: 'GLM-4.7', input: ['text'], creditMultiplier: 0.38 }
const SOLO_MODEL: TraeModelInfo = { id: 'kimi-k2.8-preview', name: 'Kimi-K2.8-Preview', input: ['text'], creditMultiplier: 0.98 }

describe('traeEditionSlotOf', () => {
  it('maps each directory mode onto the client that owns it', () => {
    expect(traeEditionSlotOf('wire')).toBe('cn')
    expect(traeEditionSlotOf('remote')).toBe('solo')
    // `merge` is the unverified sg editions; it shares the cn slot rather than
    // inventing a third one.
    expect(traeEditionSlotOf('merge')).toBe('cn')
    expect(traeEditionSlotOf(traeModelSourceMode('cn'))).toBe('cn')
    expect(traeEditionSlotOf(traeModelSourceMode('solo'))).toBe('solo')
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
