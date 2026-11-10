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

  /**
   * A `token_usage` payload that is not an object must not reach the wire as a
   * usage object, and must not throw either.
   *
   * This is a REGRESSION the first cut of this file introduced: normalizing the
   * whole payload (rather than reading individually type-checked fields, as
   * `v4.18.0` did) made `data: null` throw `Cannot read properties of null`
   * inside the stream's `start()`, killing a live answer mid-flight. It passed
   * every other case here because they all use object payloads, and the stream
   * tests never sent a malformed one. Measured: released `v4.18.0` completes the
   * same input with its finish chunk intact.
   */
  it('survives a usage payload that is not an object', async () => {
    for (const payload of ['null', '[1,2]', '"foo"', '42', 'true']) {
      // The accessor is the same one the decoder uses; `{}` is the honest
      // answer for "upstream sent something that is not a usage object".
      expect(normalizeUsageCache(JSON.parse(payload) as unknown), payload).toEqual({})
      const response = new Response(
        `event: token_usage\ndata: ${payload}\n\nevent: done\ndata: {"finish_reason":"stop"}\n\n`,
      )
      const output = await bridgeTraeSoloStream(response, 'demo-model').text()
      // The stream must finish rather than reject: a throw here is what killed
      // the answer, and a missing finish chunk is what pi-ai reports as
      // "Stream ended without finish_reason".
      expect(output, payload).toContain('"finish_reason":"stop"')
      const usage = output.split('\n')
        .filter(line => line.startsWith('data: {'))
        .map(line => JSON.parse(line.slice(6)) as { usage?: unknown })
        .find(chunk => chunk.usage !== undefined)?.usage
      expect(usage, payload).toEqual({})
    }
  })
})
