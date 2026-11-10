/** Independently implemented from the field-compatibility approach in wild-work.
 * Keep explicit zero, reject invalid counters, and preserve the original usage.
 * A missing counter is not evidence that the request was billed without caching.
 */

/**
 * A plain object, or `{}`.
 *
 * The guard matters because the input is an UPSTREAM PAYLOAD, not a typed
 * record: `released v4.18.0` only ever consumed individually type-checked
 * fields from a decoded event, so a non-object `token_usage` payload was
 * harmless. Normalization reads the payload as a whole, which made
 * `data: null` throw inside the stream's `start()` and kill a live answer —
 * see the regression test in `tests/cache-compat.spec.ts`. Arrays are also
 * excluded: spreading one turns `[1,2]` into `{"0":1,"1":2}`, which would be
 * forwarded as a usage object.
 */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** First finite, non-negative candidate; anything else is "upstream did not say". */
function counter(...values: unknown[]): number | undefined {
  return values.find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) as number | undefined
}

/**
 * Normalize cache accounting into the OpenAI spelling pi-ai reads.
 *
 * @param usage - the `token_usage` payload exactly as upstream sent it. Typed
 * `unknown` rather than `Record<string, unknown>` on purpose: the caller has
 * only just parsed JSON, and a payload of `null` / an array / a scalar is a
 * shape this function must survive rather than a type the caller guarantees.
 */
export function normalizeUsageCache(usage: unknown): Record<string, unknown> {
  const source = record(usage)
  const details = record(source['prompt_tokens_details'])
  const input = record(source['input_tokens_details'])
  // Existing canonical values win even when zero. Bare cached_tokens is last:
  // some upstreams emit it as zero alongside their nonzero primary counter.
  const read = counter(details['cached_tokens'], source['prompt_cache_hit_tokens'], source['cache_read_input_tokens'], input['cached_tokens'], source['cached_tokens'])
  const write = counter(details['cache_write_tokens'], source['cache_creation_input_tokens'], input['cache_write_tokens'])
  // Remove invalid canonical counters too: leaving a negative number in the
  // original details object would let the stream decoder forward it unchanged.
  const normalizedDetails = { ...details }
  delete normalizedDetails['cached_tokens']
  delete normalizedDetails['cache_write_tokens']
  if (read === undefined && write === undefined && source['prompt_tokens_details'] === undefined) return { ...source }
  return { ...source, prompt_tokens_details: { ...normalizedDetails,
    ...read === undefined ? {} : { cached_tokens: read },
    ...write === undefined ? {} : { cache_write_tokens: write },
  } }
}
