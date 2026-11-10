/** Independently implemented from the field-compatibility approach in wild-work.
 * Keep explicit zero, reject invalid counters, and preserve the original usage.
 * A missing counter is not evidence that the request was billed without caching.
 */
function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function counter(...values: unknown[]): number | undefined {
  return values.find(value => typeof value === 'number' && Number.isFinite(value) && value >= 0) as number | undefined
}
export function normalizeUsageCache(usage: Record<string, unknown>): Record<string, unknown> {
  const details = record(usage['prompt_tokens_details'])
  const input = record(usage['input_tokens_details'])
  // Existing canonical values win even when zero. Bare cached_tokens is last:
  // some upstreams emit it as zero alongside their nonzero primary counter.
  const read = counter(details['cached_tokens'], usage['prompt_cache_hit_tokens'], usage['cache_read_input_tokens'], input['cached_tokens'], usage['cached_tokens'])
  const write = counter(details['cache_write_tokens'], usage['cache_creation_input_tokens'], input['cache_write_tokens'])
  // Remove invalid canonical counters too: leaving a negative number in the
  // original details object would let the stream decoder forward it unchanged.
  const normalizedDetails = { ...details }
  delete normalizedDetails['cached_tokens']
  delete normalizedDetails['cache_write_tokens']
  if (read === undefined && write === undefined && usage['prompt_tokens_details'] === undefined) return { ...usage }
  return { ...usage, prompt_tokens_details: { ...normalizedDetails,
    ...read === undefined ? {} : { cached_tokens: read },
    ...write === undefined ? {} : { cache_write_tokens: write },
  } }
}
