import { describe, expect, it } from 'vitest'
import { decodeTraeEvent } from '../src/sse.ts'
import { bridgeTraeSoloStream } from '../src/solo-bridge.ts'
import { normalizeUsageCache } from '../src/usage-cache.ts'

describe('cache usage compatibility', () => {
  it('prefers canonical details including explicit zero and accepts alternate field families', () => {
    const decode = (data: object) => decodeTraeEvent({ event: 'token_usage', data: JSON.stringify(data) })
    expect(decode({ prompt_tokens_details: { cached_tokens: 0 }, cache_read_input_tokens: 80 })).toMatchObject({ cacheReadTokens: 0 })
    expect(decode({ prompt_cache_hit_tokens: 70, cached_tokens: 0 })).toMatchObject({ cacheReadTokens: 70 })
    expect(decode({ input_tokens_details: { cached_tokens: 40, cache_write_tokens: 12 } })).toMatchObject({ cacheReadTokens: 40, cacheWriteTokens: 12 })
    expect(decode({ cache_read_input_tokens: -1, prompt_tokens_details: { cached_tokens: 30 } })).toMatchObject({ cacheReadTokens: 30 })
    expect(decode({ prompt_tokens_details: {}, cached_tokens: null })).not.toHaveProperty('cacheReadTokens')
  })
  it('preserves original usage fields and supplies canonical details on the actual stream', async () => {
    const original = { prompt_tokens: 100, completion_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 3, custom_metric: 9 }
    const response = new Response('event: token_usage\ndata: '+JSON.stringify(original)+'\n\nevent: done\ndata: {"finish_reason":"stop"}\n\n')
    const output = await bridgeTraeSoloStream(response, 'demo-model').text()
    const chunks = output.split('\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6)))
    const usage = chunks.find(chunk=>chunk.usage)?.usage
    expect(usage).toMatchObject({ ...original, prompt_tokens_details: { cached_tokens: 80, cache_write_tokens: 3 } })
  })
  it('omits invalid canonical counters instead of forwarding negative or nonfinite usage', () => {
    for (const invalid of [-1, NaN, Infinity, '20', null]) {
      const input = { prompt_tokens_details: { cached_tokens: invalid, cache_write_tokens: invalid, audio_tokens: 4 } }
      expect(normalizeUsageCache(input)).toEqual({ prompt_tokens_details: { audio_tokens: 4 } })
      expect(input.prompt_tokens_details.cached_tokens).toBe(invalid)
    }
    expect(decodeTraeEvent({ event: 'token_usage', data: JSON.stringify({
      prompt_tokens_details: { cached_tokens: -3, cache_write_tokens: -2 },
    }) })).toEqual({ type: 'usage' })
  })
  it('falls back from invalid canonical fields and keeps missing usage missing', () => {
    expect(normalizeUsageCache({ prompt_tokens_details: { cached_tokens: -1 }, prompt_cache_hit_tokens: 7 }))
      .toEqual({ prompt_tokens_details: { cached_tokens: 7 }, prompt_cache_hit_tokens: 7 })
    expect(normalizeUsageCache({ prompt_tokens: 10 })).toEqual({ prompt_tokens: 10 })
    expect(normalizeUsageCache({ prompt_tokens_details: [], input_tokens_details: { cached_tokens: 3 } }))
      .toMatchObject({ prompt_tokens_details: { cached_tokens: 3 } })
  })
})
