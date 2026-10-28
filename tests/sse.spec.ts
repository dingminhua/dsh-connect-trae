import { describe, expect, it } from 'vitest'
import { decodeTraeEvent, SseDecoder } from '../src/sse.ts'

describe('SseDecoder', () => {
  it('handles arbitrary chunk boundaries, CRLF, comments and multiline data', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('event: out')).toEqual([])
    expect(decoder.push('put\r\ndata: {"response":')).toEqual([])
    expect(decoder.push('"hello"}\r\n: keepalive\r\n\r\n')).toEqual([{ event: 'output', data: '{"response":"hello"}' }])
  })

  it('supports data-only SSE instead of silently dropping it', () => {
    const decoder = new SseDecoder()
    expect(decoder.push('data: {"response":"x"}\n\n')).toEqual([{ data: '{"response":"x"}' }])
    expect(decodeTraeEvent({ data: '{"response":"x"}' })).toEqual({ type: 'delta', text: 'x' })
  })

  it('decodes queue, reasoning, done and unknown events', () => {
    expect(decodeTraeEvent({ event: 'request_wait_in_queue', data: '{"position":2}' })).toEqual({ type: 'queue', position: 2 })
    expect(decodeTraeEvent({ event: 'progress_notice', data: '"Processing_123"' })).toEqual({ type: 'progress', notice: 'Processing_123' })
    expect(decodeTraeEvent({ event: 'output', data: '{"reasoning_content":"r","response":"t"}' })).toEqual({ type: 'delta', text: 't', reasoning: 'r' })
    expect(decodeTraeEvent({ event: 'done', data: '{"finish_reason":"stop"}' })).toEqual({ type: 'done', finishReason: 'stop' })
    expect(decodeTraeEvent({ data: '[DONE]' })).toEqual({ type: 'done', finishReason: 'stop' })
    expect(decodeTraeEvent({ event: 'other', data: 'plain' })).toEqual({ type: 'unknown', event: 'other', data: 'plain' })
  })

  it('flushes a final event without a trailing blank line', () => {
    const decoder = new SseDecoder()
    decoder.push('event: done\ndata: {"finish_reason":"stop"}')
    expect(decoder.finish()).toEqual([{ event: 'done', data: '{"finish_reason":"stop"}' }])
  })

  it('keeps Trae cache accounting on token_usage events', () => {
    // Real captured event (docs/ISSUE10_DIAGNOSIS.md): cache fields are a
    // subset of prompt_tokens and must survive decoding.
    expect(decodeTraeEvent({
      event: 'token_usage',
      data: '{"prompt_tokens":9224,"completion_tokens":173,"total_tokens":9397,"cache_creation_input_tokens":0,"cache_read_input_tokens":9216,"reasoning_tokens":171}',
    })).toEqual({
      type: 'usage',
      inputTokens: 9224,
      outputTokens: 173,
      totalTokens: 9397,
      reasoningTokens: 171,
      cacheReadTokens: 9216,
      cacheWriteTokens: 0,
    })
    // A token_usage event without cache fields gains no cache keys.
    expect(decodeTraeEvent({ event: 'token_usage', data: '{"prompt_tokens":2,"completion_tokens":3}' }))
      .toEqual({ type: 'usage', inputTokens: 2, outputTokens: 3 })
  })

  it('keeps the upstream cache-pool fact from metadata and timing_cost (issue #67)', () => {
    // Real captured events (docs/ISSUE67_DIAGNOSIS.md). `metadata` carries the
    // ONLY upstream signal for whether a prompt-cache pool was attached; it
    // used to fall through to `unknown` and was dropped, which made "upstream
    // attached no pool" indistinguishable from "the plugin lost the numbers".
    expect(decodeTraeEvent({
      event: 'metadata',
      data: '{"model":"","session_id":"5a0f6c1e-0f2a-4a1c-9f3e-2b7d8c4a1e60","prompt_completion_id":0,"ab_versions":null,"app_version":"","ide_version":null,"prompt_cache_pool_record":null}',
    })).toEqual({ type: 'diagnostic', promptCachePoolRecord: null })
    expect(decodeTraeEvent({
      event: 'timing_cost',
      data: '{"name":"llm_raw_chat_v2","preprocess_timing":84,"queue_timing":15,"platform_first_token_timing":2638,"first_sse_event_time":2826,"provider_model_name":"ep-20261020221437-cfj9b"}',
    })).toEqual({ type: 'diagnostic', pipeline: 'llm_raw_chat_v2', providerModelName: 'ep-20261020221437-cfj9b' })
    // Absent is NOT the same as null: only an explicit field is reported.
    expect(decodeTraeEvent({ event: 'metadata', data: '{"model":""}' })).toEqual({ type: 'diagnostic' })
    // Diagnostics must never masquerade as answer text or usage.
    expect(decodeTraeEvent({ event: 'timing_cost', data: '{"name":"x"}' }).type).toBe('diagnostic')
  })
})
