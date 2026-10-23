import { randomUUID } from 'node:crypto'
import type { TraeCredential } from './auth.ts'
import type { TraeIdentity } from './identity.ts'
import { buildTraeCnHeaders, traeEndpoint } from './protocol.ts'
import { normalizeTraeToolSchema } from './raw-chat.ts'
import { parseTraeActivityDiscount, type TraeActivityDiscount } from './promo.ts'
import { REGION_GATEWAYS, TRAE_ENTERPRISE_HOST, regionOfCredential, type TraeRegion } from './region.ts'
import { parseReasoningCapability, type TraeReasoningCapability } from './reasoning.ts'
import type { TraeChatResult, TraeUpstreamErrorKind } from './upstream.ts'

export const TRAE_SOLO_FUNCTION = 'solo_work_lite'

/**
 * `llm_utils_chat` functions to union per region, in priority order.
 *
 * Trae spreads its callable roster across several SOLO-mode functions, and a
 * model is only usable through the one that lists it: `glm-5.3` is absent from
 * `solo_work_lite` but present in `solo_work_remote` (verified 2026-09-15 —
 * calling it through the former answers `4001 param is invalid`, through the
 * latter streams normally). Rather than betting on a single function, the
 * directory unions them; the first function to provide a config wins, so the
 * order below decides which wire name AND which function a model is called with.
 *
 * THIS LIST IS NOT "directory functions" — it is the set of functions
 * `llm_utils_chat` actually accepts, because ownership here is what the chat
 * call replays. `solo_agent` is deliberately ABSENT (measured 2026-10-01 on a
 * live SG credential, issue #19): it is a Remote-agent roster function, not a
 * chat function. Every model sent with `function: "solo_agent"` — `gpt-5.4`,
 * `gpt-5.6-sol`, `gpt-6-astra`, `glm-5.2`, `kimi-k2.7-code` — answered
 * `event:error {"code":4011}`, while the same model with the same body answered
 * normally under `solo_work_remote` / `solo_work_lite` / `solo_agent_remote`.
 * Issue #33 corrected the reading of that code: `4011` is Trae's rate limit on
 * the route that was asked (its own text says so, and issue #33's reporter hit
 * it on the CORRECT function), and the "this route does not serve that model"
 * condition is `4001` — measured on all 22 functions of a live CN credential.
 * The conclusion for this list is unchanged either way: a route that refuses
 * chat is not a chat route, so `solo_agent` stays out.
 *
 * Note `get_detail_param` DOES answer `solo_agent` with a 43-entry list, so
 * asking it looks helpful while making 8 of the 10 exposed ai-region models
 * uncallable: it won precedence and stamped its own name onto configs it
 * cannot serve. `solo_agent_remote` is the chat-callable half of that roster
 * (it answers `minimax-m3`, `gemini-3.1-pro`, … that no `solo_work_*` lists)
 * and therefore takes the last slot — after the two IDE functions that serve
 * their shared configs without the Remote plan gate.
 *
 * `chat_v3` is the widest chat roster of all (measured 2026-10-01 on live
 * credentials, issue #19 follow-up): its `get_detail_param` answers 40
 * config_names on `ai` — more than any other function except `solo_agent` (43,
 * which cannot serve chat). It lists models NO other chat function names, and
 * it is joined LAST so it only fills gaps: a config two functions list keeps
 * the earlier function, so no precedence is disturbed. The ai models it unlocks
 * were each verified callable end-to-end through the plugin's own
 * `prepareSoloBody` envelope:
 *
 *   ai (+6): kimi-k2.7-code, deepseek-v4-flash-0731, deepseek-v3.2,
 *            gemini-3-flash-premium, gemini_2.5_flash_premium, Dola-Seed-2.0-Code
 *
 * CN joins `chat_v3` and `solo_coder` too (2026-10-02). Both are callable there
 * — verified per model through `prepareSoloBody`, calling each model under a
 * function whose roster names it: `glm-5` / `glm-5.1` / `qwen-3.5` and
 * `deepseek-v4-pro` / `deepseek-v4-flash` under `solo_coder`, and
 * `doubao-seed-2.0-code` under `solo_coder` / `solo_work_remote` /
 * `solo_work_lite`. An earlier note here claimed those three answered `4001`
 * "under every function" — that was a measurement error, not an upstream
 * refusal: the probe had called them by display id while the chat endpoint needs
 * the config_name its owning function returned.
 *
 * This also corrects an older note that `Doubao-Seed-Code` "has no config_name
 * and must stay hidden" (docs/MODEL_MANAGEMENT_DESIGN.md): it does have one,
 * under `chat_v3`.
 *
 * A model in NO chat function's roster is still left to the merge: it ships
 * with no wire target and its call fails with a readable upstream message
 * rather than being hidden (see mergeTraeModelSources).
 */
export const TRAE_DIRECTORY_FUNCTIONS: Readonly<Record<TraeRegion, readonly string[]>> = {
  cn: ['solo_work_remote', TRAE_SOLO_FUNCTION, 'solo_agent_remote', 'chat_v3', 'solo_coder'],
  ai: ['solo_work_remote', TRAE_SOLO_FUNCTION, 'solo_agent_remote', 'chat_v3'],
}
export const TRAE_SOLO_CHAT_PATH = '/api/agent/v3/llm_utils_chat'
export const TRAE_SOLO_MODELS_PATH = '/api/ide/v1/get_detail_param'

function classify(status: number): TraeUpstreamErrorKind {
  if (status === 401 || status === 403) return 'authentication'
  if (status === 402) return 'hard_credit'
  if (status === 429) return 'soft_rate'
  if (status === 404) return 'not_found'
  if (status >= 500) return 'server'
  return 'client'
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function prepareSoloBody(source: string, defaultModel = 'glm-5.2', functionName?: string): string {
  const input = JSON.parse(source) as Record<string, unknown>
  const requestedModel = typeof input['model'] === 'string' && input['model'].trim() !== '' ? input['model'].trim() : defaultModel
  const model = requestedModel
  // llm_utils_chat is not an OpenAI-compatible endpoint. Build its evidenced
  // envelope explicitly so optional Pi/OpenAI fields (temperature, max_tokens,
  // tool_choice, response_format, etc.) cannot make every model fail validation.
  const body: Record<string, unknown> = {
    ...Array.isArray(input['messages']) ? { messages: input['messages'] } : {},
    model,
    config_name: model,
    // The directory function that actually lists this model (see
    // TRAE_DIRECTORY_FUNCTIONS). The bridge may have already stamped the exact
    // function it learned from the directory, which wins over the default.
    function: typeof input['function'] === 'string' && input['function'] !== ''
      ? input['function']
      : (functionName ?? TRAE_SOLO_FUNCTION),
    stream: true,
    ...Array.isArray(input['tools']) ? { tools: input['tools'] } : {},
    ...typeof input['reasoning_effort'] === 'string' ? { reasoning_effort: input['reasoning_effort'] } : {},
  }
  if (Array.isArray(body['messages'])) {
    for (const raw of body['messages']) {
      if (typeof raw !== 'object' || raw === null) continue
      const message = raw as Record<string, unknown>
      // DSH sends the system prompt as the OpenAI `developer` role, which the
      // Trae `llm_utils_chat` upstream rejects with a 400 (it accepts only
      // system / assistant / user / tool / function). Normalise it.
      if (message['role'] === 'developer') message['role'] = 'system'
      if (typeof message['content'] === 'string') message['content'] = [{ type: 'text', text: message['content'] }]
      if (message['role'] === 'assistant' && Array.isArray(message['tool_calls'])) {
        for (const rawCall of message['tool_calls']) {
          if (typeof rawCall !== 'object' || rawCall === null) continue
          const call = rawCall as Record<string, unknown>
          if (typeof call['function'] === 'object' && call['function'] !== null) {
            call['function_call'] = call['function']
            delete call['function']
          }
        }
      }
      if (message['role'] === 'tool') {
        message['role'] = 'tool'
        if (typeof message['tool_call_id'] !== 'string' || message['tool_call_id'] === '') {
          throw new Error('Trae SOLO tool message requires tool_call_id')
        }
      }
    }
  }
  if (Array.isArray(body['tools'])) {
    for (const raw of body['tools']) {
      if (typeof raw !== 'object' || raw === null) continue
      const fn = (raw as Record<string, unknown>)['function']
      if (typeof fn !== 'object' || fn === null) continue
      const record = fn as Record<string, unknown>
      if (typeof record['parameters'] === 'object' && record['parameters'] !== null) {
        // Issue #49: DSH schemastery emits draft-3 `required: true` inside a
        // property schema. The DeepSeek-backed models (deepseek-v4.1-flash, …)
        // validate tools batch-wide and answer `4027 invalid JSON Schema` for
        // the whole request when any tool carries that boolean, while the
        // Zhipu backend tolerates it — so normalise to draft-4 before
        // stringify. Local, idempotent, and credential-free.
        record['parameters'] = JSON.stringify(normalizeTraeToolSchema(record['parameters']))
      }
    }
  }
  return JSON.stringify(body)
}

export interface TraeSoloModel {
  id: string
  name: string
  contextWindow?: number
  maxTokens?: number
  reasoning?: TraeReasoningCapability
  /** Effective (post-discount) credit multiplier, as the Trae IDE shows it. */
  creditMultiplier?: number
  /**
   * The row's `activity_discount` rule, read from `display_contact_config`.
   * Display data only: src/promo.ts decides at paint time whether a badge shows.
   */
  activityDiscount?: TraeActivityDiscount
  /** The directory function that listed this config (replayed when calling it). */
  function?: string
  /**
   * Upstream's `usage` for this config — `chat_completion` for a model,
   * `custom_model` for the account's own custom model, and one value per
   * built-in tool config. Absent means upstream did not say.
   *
   * The merge layer needs it to tell a MODEL from a TOOL (issue #46).
   */
  usage?: string
  /**
   * Upstream's `config_source` — 1 for a Trae preset, 3 for the account's own
   * custom model. Absent means upstream did not say.
   */
  configSource?: number
}

/**
 * Parse this row's `display_contact_config` document.
 *
 * It is a *string* holding a second JSON document, and three different readers
 * (the credit multiplier, the promotion rule, and whatever upstream adds next)
 * need it — so it is decoded once here rather than three times.
 */
function wireContactConfig(config: Record<string, unknown>): Record<string, unknown> | undefined {
  const raw = config['display_contact_config']
  if (typeof raw !== 'string' || raw === '') return undefined
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return undefined }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
  return parsed as Record<string, unknown>
}

/** The promotion rule from `display_contact_config`, when the row carries one. */
function wireActivityDiscount(config: Record<string, unknown>): TraeActivityDiscount | undefined {
  return parseTraeActivityDiscount(wireContactConfig(config)?.['activity_discount'])
}

/**
 * Read the effective credit multiplier from a `get_detail_param` row.
 *
 * The rate the Trae IDE renders lives in `display_contact_config` — a *string*
 * holding a second JSON document — and its `consumption_rate.data.rate` is
 * already the post-discount value (verified 2026-09-13, commit 1.4.2: the
 * Remote directory reports the undiscounted figure, e.g. `0.8`, while the IDE
 * and this field both say `0.08` under a 限时 1 折 promotion — up to a 10x
 * difference). The wire figure therefore wins over the Remote one during the
 * merge; this parser is what feeds it.
 *
 * The international (ai) gateway serves no `consumption_rate` anywhere (its
 * subscription models carry only `features.cost` tags), so rows without the
 * field keep their bare name — parsed-but-absent, never fabricated.
 */
function wireCreditMultiplier(config: Record<string, unknown>): number | undefined {
  const parsed = wireContactConfig(config)
  if (parsed === undefined) return undefined
  const consumption = parsed['consumption_rate']
  if (typeof consumption !== 'object' || consumption === null) return undefined
  const entry = consumption as Record<string, unknown>
  if (entry['enable'] !== true) return undefined
  const data = entry['data']
  if (typeof data !== 'object' || data === null) return undefined
  return finitePositive((data as Record<string, unknown>)['rate'])
}

export interface TraeSoloClientOptions {
  credential(): Promise<TraeCredential>
  identity(): Promise<TraeIdentity>
  baseUrl?: string
  /**
   * Which chat gateway this client is pinned to. Omitted = `solo`, the consumer
   * pool. `enterprise` targets the tenant-billed `console.enterprise` gateway
   * and stamps the per-call `session_id` it requires (see
   * {@link TRAE_ENTERPRISE_HOST}).
   *
   * Pinned per CLIENT, never chosen per call: a turn must not be able to drift
   * from the pool the user picked, so the route is fixed when the provider is
   * built and every request that client makes stays on it.
   */
  route?: TraeChatRoute
  fetchImpl?: typeof fetch
  log?: (message: string, detail?: unknown) => void
}

/** Which chat pool a client is pinned to. */
export type TraeChatRoute = 'solo' | 'enterprise'

/**
 * Thrown by {@link TraeSoloUpstreamClient.fetchModels} when every requested
 * directory function answered HTTP 200 but with an EMPTY `config_info_list`
 * (no rows at all), so the aggregate roster is empty. This is issue #39's root
 * signal: the upstream has published NO SOLO function config for this account /
 * route. It is a server-side, usually transient gap — the reporter's roster
 * returned empty and later self-resolved with rows per function — NOT a local
 * credential, plugin or account fault, and not something to re-login for. The
 * caller can catch this type to tell "the upstream published no config" apart
 * from "all directory functions errored" (which surfaces as a generic failure).
 */
export class TraeEmptySoloDirectory extends Error {
  override name = 'TraeEmptySoloDirectory'
  constructor() {
    super('Trae\u2019s server returned NO SOLO function config (an empty directory for every requested function) \u2014 an upstream-side gap that usually clears on its own; retry later instead of re-checking credentials or the plugin')
  }
}

export class TraeSoloUpstreamClient {
  private readonly fetchImpl: typeof fetch
  constructor(private readonly options: TraeSoloClientOptions) { this.fetchImpl = options.fetchImpl ?? fetch }

  /**
   * Read the callable roster for this credential's region.
   *
   * Every function in {@link TRAE_DIRECTORY_FUNCTIONS} is asked, in order, and
   * their answers are unioned: the first function to list a `config_name` owns
   * it. Trae splits its roster across SOLO modes, and a model is only callable
   * through the function that lists it (glm-5.3 exists solely under
   * `solo_work_remote` on the CN gateway). Asking one function therefore
   * silently hides models that the other one serves. The remote directory
   * remains the merge skeleton, so agent-internal entries (search_agent_*,
   * paygo variants) never surface even though they appear here.
   */
  async fetchModels(signal?: AbortSignal): Promise<TraeSoloModel[]> {
    const [credential, identity] = await Promise.all([this.options.credential(), this.options.identity()])
    const region = regionOfCredential(credential)
    // Same gateway as this client's chat route: the two pools publish DIFFERENT
    // rosters (`DeepSeek-V4.1-Flash` is enterprise-only), so a consumer-pinned
    // client that read the consumer roster would never discover it.
    const base = this.options.baseUrl ?? this.chatBaseOf(credential)
    const headers = { ...buildTraeCnHeaders(credential, identity), Accept: 'application/json' }
    const byId = new Map<string, TraeSoloModel>()
    const failures: string[] = []
    for (const directoryFunction of TRAE_DIRECTORY_FUNCTIONS[region]) {
      let list: unknown[]
      try {
        const response = await this.fetchImpl(traeEndpoint(base, TRAE_SOLO_MODELS_PATH), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            function: directoryFunction,
            config_names: null,
            need_prompt: false,
            current_config_info: null,
            poly_prompt: true,
            mode_type: null,
            agent_type: null,
          }),
          signal: signal ?? AbortSignal.timeout(30_000),
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const document = await response.json() as Record<string, unknown>
        list = Array.isArray(document['config_info_list']) ? document['config_info_list'] : []
      } catch (error: unknown) {
        // One function failing must not hide the others' rosters.
        failures.push(`${directoryFunction}: ${String(error).slice(0, 80)}`)
        continue
      }
      this.collectModels(list, directoryFunction, byId)
    }
    const models = [...byId.values()]
    if (models.length === 0) {
      // No failures AND no rows: every requested function answered HTTP 200 with
      // an empty config_info_list — the upstream published NO function config
      // (issue #39's root signal), which is distinct from a transport failure.
      // Surface it with the honest dedicated error so the caller can tell the
      // two situations apart; otherwise keep the generic per-function message.
      if (failures.length === 0) throw new TraeEmptySoloDirectory()
      throw new Error(`Trae SOLO models response contained no models (${failures.join('; ')})`)
    }
    return models
  }

  /** Merge one function's config list into the shared catalogue (first wins). */
  private collectModels(list: readonly unknown[], directoryFunction: string, byId: Map<string, TraeSoloModel>): void {
    for (const raw of list) {
      if (typeof raw !== 'object' || raw === null) continue
      const config = raw as Record<string, unknown>
      const id = typeof config['config_name'] === 'string' ? config['config_name'] : ''
      if (id === '') continue
      const display = typeof config['display_config'] === 'object' && config['display_config'] !== null ? config['display_config'] as Record<string, unknown> : {}
      const details = Array.isArray(config['model_detail_list']) ? config['model_detail_list'] : []
      const detail = typeof details[0] === 'object' && details[0] !== null ? details[0] as Record<string, unknown> : {}
      // The row's OWN display name, kept apart from the fallback below.
      //
      // Upstream publishes a DIFFERENT `display_name` for the same config
      // depending on which function asked (issue #46, measured 2026-10-22 on
      // a live CN credential): `doubao-for-auto` is `''` under `chat_v3` and
      // `Seed-Code` under `solo_coder`; `glm-4.7-auto` is `''` and `GLM-4.7`;
      // `Doubao-Seed-2.0-Code` is `Doubao-Seed-2.1-Turbo` under the two
      // `solo_work_*` functions and `Doubao-Seed-2.0-Code` under `solo_coder`.
      //
      // The first function to list the id wins the row, and with it the
      // FUNCTION (which is what makes the model callable), so the NAME is
      // collected separately and the richest one is kept: a function that
      // publishes an empty name must not blank out a name another function
      // published for the same config.
      const rawName = typeof display['display_name'] === 'string' ? display['display_name'] : ''
      // get_detail_param's real field names (verified 2026-08-30): the context
      // window is `model_detail_list[].prompt_max_tokens` (or the top-level
      // `context_window_tokens.dev`), and max output is `model_detail_list[].max_tokens`.
      // There are no `max_input_tokens` / `max_output_tokens` fields; reading them
      // made every row's windows nil. The wire `config_name` (what `llm_utils_chat`
      // accepts) is `config_name` itself — NOT `model_name` (a `__dev`/`__max`
      // variant that only names the underlying checkpoint).
      const contextTokens = typeof config['context_window_tokens'] === 'object' && config['context_window_tokens'] !== null ? config['context_window_tokens'] as Record<string, unknown> : {}
      const promptMaxTokens = finitePositive(detail['prompt_max_tokens'])
      const devTokens = finitePositive(contextTokens['dev'])
      const contextWindow = promptMaxTokens ?? devTokens
      const maxTokens = finitePositive(detail['max_tokens'])
      const reasoning = parseReasoningCapability({ ...config, ...detail })
      const creditMultiplier = wireCreditMultiplier(config)
      const activityDiscount = wireActivityDiscount(config)
      // What this config is FOR, and where it came from (verified 2026-10-22
      // on a live CN credential). `usage` is `chat_completion` for a real
      // model, `custom_model` for the account's own custom model, and one
      // value per built-in tool config (`summary`, `title_generation`,
      // `fast_apply`, `input_optimization`, …). `config_source` is 1 for a
      // Trae preset and 3 for the account's own custom model.
      //
      // The merge layer needs both to tell a MODEL from a TOOL and a Trae
      // preset from the user's own model — without them it would promote the
      // IDE's helper configs into the model picker (issue #46).
      const usage = typeof config['usage'] === 'string' && config['usage'] !== '' ? config['usage'] : undefined
      const configSource = typeof config['config_source'] === 'number' && Number.isFinite(config['config_source']) ? config['config_source'] : undefined
      // First function to list a config_name owns it: TRAE_DIRECTORY_FUNCTIONS
      // is ordered by precedence, and this is what makes a model callable (the
      // chat call replays this exact function).
      //
      // The owning ROW is kept as published (its function, its context, its
      // output cap), but the NAME is upgraded when a later function published a
      // real one for the same config: the owning function is the one that
      // decides callability, and it is not the one that always knows the
      // name. Measured: `doubao-for-auto` is nameless under `chat_v3` (the
      // owning function) and named `Seed-Code` under `solo_coder`.
      const existing = byId.get(id)
      if (existing !== undefined) {
        // A name is only an UPGRADE when it is a REAL one: upstream publishes
        // the placeholder `-` for a config it has no name for (`sagitta`,
        // `aquila`), and adopting that placeholder would put a bare `-` in
        // front of the user as a model name.
        if (existing.name === id && rawName !== '' && rawName !== '-') {
          existing.name = rawName
        }
        continue
      }
      byId.set(id, {
        id,
        name: rawName !== '' && rawName !== '-' ? rawName : id,
        ...contextWindow === undefined ? {} : { contextWindow },
        ...maxTokens === undefined ? {} : { maxTokens },
        ...reasoning === undefined ? {} : { reasoning },
        ...creditMultiplier === undefined ? {} : { creditMultiplier },
        ...activityDiscount === undefined ? {} : { activityDiscount },
        ...usage === undefined ? {} : { usage },
        ...configSource === undefined ? {} : { configSource },
        function: directoryFunction,
      })
    }
  }

  async chatStream(bodyJson: string, signal?: AbortSignal, functionName?: string): Promise<TraeChatResult> {
    let prepared: string
    try { prepared = prepareSoloBody(bodyJson, undefined, functionName) }
    catch { return { ok: false, status: 400, kind: 'client', message: 'invalid JSON request' } }
    const [credential, identity] = await Promise.all([this.options.credential(), this.options.identity()])
    const headers = buildTraeCnHeaders(credential, identity)
    const base = this.options.baseUrl ?? this.chatBaseOf(credential)
    if (this.options.route === 'enterprise') {
      // The tenant gateway requires a per-call correlation id; the consumer
      // gateway rejects a body that carries one (`4001`), so this stays inside
      // the enterprise branch rather than being stamped for everyone.
      try {
        const parsed = JSON.parse(prepared) as Record<string, unknown>
        if (parsed['session_id'] === undefined) parsed['session_id'] = randomUUID()
        prepared = JSON.stringify(parsed)
      } catch {
        return { ok: false, status: 400, kind: 'client', message: 'invalid JSON request' }
      }
    }
    let response: Response
    try {
      response = await this.fetchImpl(traeEndpoint(base, TRAE_SOLO_CHAT_PATH), {
        method: 'POST', headers, body: prepared, signal: signal ?? AbortSignal.timeout(120_000),
      })
    } catch (error: unknown) {
      return { ok: false, status: 0, kind: 'server', message: `transport error: ${String(error)}` }
    }
    if (response.ok) {
      /**
       * The enterprise gateway reports a refusal as **HTTP 200** whose first
       * SSE frame is `event:error`. Handing that stream back as a success would
       * surface the refusal as an empty assistant turn, so it is converted to
       * a real error here — the same shape the consumer gateway uses for its
       * non-2xx failures.
       */
      if (this.options.route !== 'enterprise') return { ok: true, response }
      const classified = await classifyEnterpriseResponse(response)
      if ('response' in classified) return { ok: true, response: classified.response }
      this.options.log?.('dsh-connect-trae: enterprise llm_utils_chat refused', {
        status: 200,
        model: JSON.parse(prepared)['model'],
        configName: JSON.parse(prepared)['config_name'],
        body: classified.refusal,
      })
      return { ok: false, status: 200, kind: 'client', message: classified.refusal }
    }
    const text = (await response.text()).slice(0, 1024)
    this.options.log?.('dsh-connect-trae: llm_utils_chat rejected', {
      status: response.status,
      model: JSON.parse(prepared)['model'],
      configName: JSON.parse(prepared)['config_name'],
      reasoningEffort: JSON.parse(prepared)['reasoning_effort'],
      body: text,
    })
    return { ok: false, status: response.status, kind: classify(response.status), message: text || `Trae SOLO returned HTTP ${response.status}` }
  }

  /** Chat gateway for this client's pinned route. */
  private chatBaseOf(credential: TraeCredential): string {
    if (this.options.route === 'enterprise') return TRAE_ENTERPRISE_HOST
    return REGION_GATEWAYS[regionOfCredential(credential)].chat
  }
}

/**
 * Return the refusal frame of an enterprise 200, or `undefined` when the stream
 * is a real answer.
 *
 * Reads (and re-plays) only the first SSE frame: a refusal is emitted before
 * any output token, so peeking that far is enough to classify the call, and
 * the stream is rebuilt so a caller that got `undefined` still sees every byte.
 */
function concatStream(head: string, reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (head !== '') controller.enqueue(new TextEncoder().encode(head))
      const drain = (): void => {
        reader.read().then((result) => {
          if (result.done) { controller.close(); return }
          controller.enqueue(result.value)
          drain()
        }).catch((error: unknown) => controller.error(error))
      }
      drain()
    },
  })
}

/**
 * Classify an enterprise 200.
 *
 * Returns `{ refusal }` when the first SSE frame is `event:error`, otherwise
 * `{ response }` carrying a REBUILT response whose body re-emits every byte —
 * including the peeked frame. A refusal is emitted before any output token, so
 * peeking one frame is enough to classify the call.
 *
 * The response is rebuilt rather than patched: the original's body has been
 * partially read, so its `text()`/`json()` would keep failing with "Body has
 * already been read" even after `body` is swapped.
 */
async function classifyEnterpriseResponse(response: Response): Promise<{ refusal: string } | { response: Response }> {
  const body = response.body
  if (body === null) return { response }
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let head = ''
  try {
    while (!head.includes('\n\n')) {
      const { done, value } = await reader.read()
      if (done) break
      head += decoder.decode(value, { stream: true })
      if (head.length > 8192) break
    }
  } catch {
    return { response }
  }
  const frame = head.split('\n\n')[0] ?? ''
  const event = /^event:(\S+)/m.exec(frame)?.[1]
  const data = frame.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim() ?? ''
  if (event !== 'error') {
    return {
      response: new Response(concatStream(head, reader), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }),
    }
  }
  try { await reader.cancel() } catch { /* already drained */ }
  return { refusal: data === '' ? 'enterprise gateway refused the request' : data }
}
