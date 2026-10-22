import { describe, expect, it } from 'vitest'
import { nextRegionDirectory, nextRegionPool, regionPoolOf } from '../src/status-paths.ts'
import { mergeTraeModelSources, isPromotableWireModel } from '../src/catalog.ts'
import { TRAE_REMOTE_DIRECTORY_FUNCTIONS } from '../src/solo-remote.ts'

/**
 * The two defects reported around issue #46, end to end.
 *
 *   1. The account-pool switch did not survive a save.
 *   2. The model list did not include the models the IDE offers.
 */

describe('1. the account-pool switch survives every write', () => {
  const stored = {
    cn: {
      enabled: true,
      lastCatalog: [],
      enabledModelIds: [],
      imageModelIds: [],
      contextBudgets: {},
      creditPosition: 'stats',
      pool: { enabled: true, targetModelId: 'glm-5.2', memberAccountIds: ['acc-1'], probeInputTokens: 0 },
    },
  }
  const directory = {
    enabled: true, lastCatalog: [{ id: 'glm-5.2', name: 'GLM-5.2' }],
    enabledModelIds: ['glm-5.2'], imageModelIds: [], contextBudgets: {},
  }

  it('survives the model-directory save', () => {
    const next = nextRegionDirectory(stored, 'cn', directory)
    expect(regionPoolOf(next, 'cn').enabled).toBe(true)
    expect(regionPoolOf(next, 'cn').memberAccountIds).toEqual(['acc-1'])
    expect((next.cn as { creditPosition?: string }).creditPosition).toBe('stats')
  })

  it('survives the pool save itself', () => {
    const next = nextRegionPool(stored, 'cn', { enabled: true, memberAccountIds: ['acc-1', 'acc-2'] })
    expect(regionPoolOf(next, 'cn').memberAccountIds).toEqual(['acc-1', 'acc-2'])
    expect((next.cn as { creditPosition?: string }).creditPosition).toBe('stats')
  })
})

describe('2. the model list includes the models the IDE offers', () => {
  it('asks the Remote directory for the groups that carry models', () => {
    // `inline_chat` alone carries `kimi-k2` — the `Kimi-K2-0905` snapshot.
    expect(TRAE_REMOTE_DIRECTORY_FUNCTIONS.cn).toContain('inline_chat')
    expect(TRAE_REMOTE_DIRECTORY_FUNCTIONS.cn).toContain('chat')
    expect(TRAE_REMOTE_DIRECTORY_FUNCTIONS.ai).toContain('inline_chat')
  })

  it('promotes a wire-only model the Remote skeleton does not know', () => {
    const remote = [
      { id: 'deepseek-v4.1-flash', name: 'DeepSeek-V4.1-Flash', multimodal: true, contextWindow: 200_000, reasoningSupported: true },
    ]
    const wire = [
      { id: 'kimi-k2-0905', name: 'Kimi-K2-0905', contextWindow: 200_000, maxTokens: 32_000, function: 'solo_coder', usage: 'chat_completion', configSource: 1 },
    ]
    const merged = mergeTraeModelSources(remote, wire)
    expect(merged.some(m => m.id === 'kimi-k2-0905')).toBe(true)
  })

  it('still refuses a tool config, a custom model and an alias', () => {
    expect(isPromotableWireModel({ id: 'title_generation', name: 'title_generation', usage: 'title_generation', configSource: 1 })).toBe(false)
    expect(isPromotableWireModel({ id: 'custom_model_gpt-6', name: 'GPT-5.6', usage: 'custom_model', configSource: 3 })).toBe(false)
    expect(isPromotableWireModel({ id: 'sagitta', name: 'sagitta', usage: 'chat_completion', configSource: 1 })).toBe(false)
  })
})
