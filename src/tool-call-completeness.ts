/**
 * Whether a streamed tool call is WHOLE.
 *
 * Issue #93: the bridge reported `finish_reason: "tool_calls"` for every
 * stream that contained a tool call, so a call the upstream had cut off was
 * indistinguishable from a finished one. Downstream that is fatal: pi-ai
 * parses the accumulated arguments as JSON, a truncated argument string fails
 * to parse, and dsh-llm-pi-ai tolerates that ONLY when the turn's stop reason
 * is `length` — otherwise it raises `MALFORMED_RESPONSE` and the whole turn
 * dies (`Tool call "run_code": Unexpected end of JSON input`).
 *
 * So the bridge has to answer one question the upstream does not always
 * answer: when the stream ended, was the tool call whole?
 */

/** One streamed tool call, accumulated across its deltas. */
export interface ToolCallDraft {
  /** The last non-empty function name seen for this call. */
  name: string
  /** Every argument fragment seen for this call, concatenated in order. */
  arguments: string
}

/** Why a draft is not whole: it never named a tool, or its arguments do not close. */
export type ToolCallDefect = 'name' | 'arguments'

/**
 * Whether the argument text could still be the prefix of a whole JSON object.
 *
 * STRUCTURAL, not a parse. An argument string that ends inside an unterminated
 * string, or with an unclosed brace/bracket, cannot be complete — that is what
 * a cut-off stream leaves behind. Anything else is deliberately left to the
 * downstream parser, which reports malformed arguments far more precisely than
 * this bridge could; a "closed but invalid" argument is the model's own
 * mistake, not a truncation, and hiding it behind `length` would turn a clear
 * error into a silent retry.
 *
 * The scan tracks string state because arguments carry escaped quotes
 * (`{"code": "print(\"hi\")"}`) — a brace inside a string must not count.
 */
export function argumentsLookTruncated(text: string): boolean {
  let depth = 0
  let inString = false
  let escaped = false
  for (const char of text) {
    if (inString) {
      if (escaped) { escaped = false; continue }
      if (char === '\\') { escaped = true; continue }
      if (char === '"') inString = false
      continue
    }
    if (char === '"') { inString = true; continue }
    if (char === '{' || char === '[') depth += 1
    else if (char === '}' || char === ']') depth -= 1
  }
  return depth > 0 || inString
}

/**
 * What is missing from one accumulated call, if anything.
 *
 * A call with no name is treated as cut off for the same reason as one with
 * unclosed arguments: the downstream cannot invoke a tool it cannot name, and
 * reporting `length` lets the model write the call again instead of failing
 * the turn.
 */
export function toolCallDefect(draft: ToolCallDraft): ToolCallDefect | undefined {
  if (draft.name === '') return 'name'
  if (argumentsLookTruncated(draft.arguments)) return 'arguments'
  return undefined
}

/**
 * The first defect among the accumulated calls, or undefined when they are all
 * whole.
 */
export function toolCallsDefect(drafts: Iterable<ToolCallDraft>): ToolCallDefect | undefined {
  for (const draft of drafts) {
    const defect = toolCallDefect(draft)
    if (defect !== undefined) return defect
  }
  return undefined
}
