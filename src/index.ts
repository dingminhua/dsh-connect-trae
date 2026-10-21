import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  createTraeAdapter,
  displayNameOfTraeProvider,
  regionOfTraeProvider,
  routeOfTraeProvider,
  TRAE_AI_PROVIDER,
  TRAE_ENTERPRISE_PROVIDER,
  TRAE_PROVIDER,
  TRAE_PROVIDER_DISPLAY_NAMES,
  TRAE_PROVIDER_IDS,
  TRAE_PROVIDERS,
} from './adapter.ts'
import type { TraeWebAccountState, TraeWebCredits } from './status-paths.ts'
import type { TraeCheckinClaim, TraeCheckinStatus } from './usage.ts'
import { configuredAccountsOf, unwrapVolatile, unwrapVolatileDeep } from './status-paths.ts'
import type { TraeAdapter } from './adapter.ts'
import { isTraeAccountId, traeAccountId, TraeCredentialStore } from './auth.ts'
import { piAiRuntimeInfo } from './pi-ai-runtime.ts'
import { applyImageSelection, deriveCatalog, discoveredCatalog, FALLBACK_TRAE_MODELS, fallbackModelsFor, mergeTraeModelSources, sanitizeCatalog, TraeCatalog, traeInputModalities, traeModelDisplayName, withChatCallableFunctions, type TraeModelInfo } from './catalog.ts'
import { refreshTraeCredential, type TraeRefreshDevice } from './refresh.ts'
import { readTraeIdentity, resolveTraeIdentity, type TraeIdentity } from './identity.ts'
import { traeStorageCandidates, type TraeEdition } from './paths.ts'
import { panelOfProvider, providerOfPanel, regionOfCredential, regionOfEdition, regionOfHost, regionOfPanel, regionOfUserRegion, REGION_GATEWAYS, TRAE_PANELS, type TraePanel, type TraeRegion, type TraeRegionGateways } from './region.ts'
import { createTraeShim } from './shim.ts'
import type { TraeShim, TraeShimPool, TraeShimRoute } from './shim.ts'
import { TRAE_DIRECTORY_FUNCTIONS, TraeSoloUpstreamClient } from './solo.ts'
import type { TraeChatRoute } from './solo.ts'
import type { TraeChatResult, TraeUpstreamClient, TraeUpstreamErrorKind } from './upstream.ts'
import { TraeSoloBridge, wireTargetsOf } from './solo-bridge.ts'
import type { TraeWireTarget } from './solo-bridge.ts'
import { TraeSoloRemoteCatalogClient } from './solo-remote.ts'
import { TraeRawChatUpstreamClient } from './raw-upstream.ts'
import { createTraeRawGateway } from './raw-gateway.ts'
import { resolveTraeRawRuntime } from './raw-resolver.ts'
import type { TraeRawDiagnostic } from './raw-diagnostic.ts'
import { TraeDelegatingUpstreamClient } from './delegating-upstream.ts'
import { MAX_PROBE_INPUT_TOKENS, probeBody, probeModelsSequentially, probeOneModel } from './model-probe.ts'
import { TraeUsageClient } from './usage.ts'
import { registerTraeUsageRoute, toCheckin, toCredits, type TraePoolCheckinState, type TraePoolDeps } from './web-status.ts'
import type { TraePoolPreferences } from './status-paths.ts'
import { billableMembers, effectiveMembersOf, pickAccount, poolKeyOfPanel, rankPool, resolveTargetModel } from './account-pool.ts'
import type { TraePoolCredits, TraePoolMember, TraePoolOutcome, TraePoolProbe } from './account-pool.ts'
import { checkinAllAccounts, probeUpdatesOf, testAllAccounts, type TraePoolRunnerDeps } from './account-pool-run.ts'
import type { TraePoolCheckinRow, TraePoolTestRow } from './account-pool-run.ts'
import { dropTraePoolProbe, readTraePoolProbes, writeTraePoolProbes } from './account-pool-store.ts'

export {
  adaptLegacyPiAiContext,
  adaptModernPiAiContext,
  createTraeAdapter,
  displayNameOfTraeProvider,
  regionOfTraeProvider,
  routeOfTraeProvider,
  TRAE_AI_PROVIDER,
  TRAE_ENTERPRISE_PROVIDER,
  TRAE_PROVIDER,
  TRAE_PROVIDER_DISPLAY_NAMES,
  TRAE_PROVIDER_ID_DISPLAY_NAMES,
  TRAE_PROVIDER_IDS,
  TRAE_PROVIDER_ROUTES,
  TRAE_PROVIDERS,
  TRAE_STREAM_IDLE_TIMEOUT_MS,
  withContextAdaptation,
  type TraeAdapter,
  type TraeProviderRoute,
} from './adapter.ts'
export { decidePiAiGeneration, generationOf, piAiRuntimeInfo, type PiAiGeneration, type PiAiRuntimeInfo } from './pi-ai-runtime.ts'
export {
  isEnterpriseAccount,
  legacyTraeOwnAuthPath,
  normalizeTraeCredential,
  traeOwnAuthPath,
  TraeCredentialStore,
  type TraeCredential,
} from './auth.ts'
export {
  panelOfKey,
  panelOfProvider,
  providerOfPanel,
  regionOfCredential,
  regionOfEdition,
  regionOfHost,
  regionOfPanel,
  regionOfUserRegion,
  REGION_GATEWAYS,
  TRAE_PANELS,
  type TraePanel,
  type TraeRegion,
  type TraeRegionGateways,
} from './region.ts'
export { applyContextBudgets, applyImageSelection, deriveCatalog, discoveredCatalog, FALLBACK_TRAE_MODELS, FALLBACK_TRAE_MODELS_AI, fallbackModelsFor, mergeTraeModelSources, sanitizeCatalog, TraeCatalog, traeInputModalities, traeModelDisplayName, type TraeContextBudget, type TraeInputModality, type TraeModelInfo, type TraeWireModel } from './catalog.ts'
export { decryptTraeStorageValue, parseTraeAuthValue, parseTraeStorageDocument } from './decrypt.ts'
export { identityHeaders, pickTraeStorageIdentity, readTraeCliIdentity, readTraeIdentity, resolveTraeIdentity, type TraeIdentity } from './identity.ts'
export { parseObservedModelConfig, type TraeObservedModelConfig } from './model-config.ts'
export { parseTraeCachedModel, readTraeCachedModel, traeStateDatabaseCandidates, TRAE_STATE_DB_FILENAME, type TraeCachedModelConfig } from './model-cache.ts'
export { parseTraeModelExtraConfigLogLine, parseTraeRawChatBehaviorConfig, type TraeRawChatBehaviorConfig } from './model-extra-config.ts'
export { buildTraeModelDetailRequest, TRAE_MODEL_DETAIL_FUNCTIONS, TRAE_MODEL_DETAIL_PATH, type TraeModelDetailRequest } from './model-detail.ts'
export { parseTraeRemoteModel, type TraeDiscoveredModel, type TraeDiscoveredReasoning } from './model-metadata.ts'
export { traeStorageCandidates, traeWindowsAppNames, type TraeEdition, type TraeStorageCandidate } from './paths.ts'
export { describeIdShape, describeNameShape, maskUserPath } from './redact.ts'
export { buildTraeAgentTaskBody, buildTraeCnHeaders, normalizeTraeVersionCode, TRAE_CN_AGENT_TASK_PATH, TRAE_CN_TITLE_PATH, TRAE_VERSION_CODE_FALLBACK, traeEndpoint } from './protocol.ts'
export { buildTraeRawChatDraft, decodeRawChatChunk, TRAE_RAW_CHAT_V1_PATH, TRAE_RAW_CHAT_V2_PATH, type RawChatDelta, type RawChatMessage, type RawChatTool } from './raw-chat.ts'
export { buildTraeFusionRawChatEnvelope, hashTraeRawChatArg, type TraeFusionRawChatEnvelope } from './raw-envelope.ts'
export { buildTraeRawChatRuntimeConfig, traeRawChatExtraInfo, type TraeRawChatRuntimeConfig } from './raw-runtime-config.ts'
export { resolveTraeRawRuntime, type TraeRawResolverResult } from './raw-resolver.ts'
export { rawCapabilityFingerprint } from './raw-fingerprint.ts'
export { rawCapabilityDiagnostic, type TraeRawDiagnostic, type TraeRawDiagnosticState } from './raw-diagnostic.ts'
export { createTraeRawGateway, type TraeRawGateway, type TraeRawGatewayOptions } from './raw-gateway.ts'
export { classifyTraeRawChatFailure, TraeRawChatUpstreamClient, type TraeRawChatClientOptions, type TraeRawChatConfig, type TraeRawChatFailureReason } from './raw-upstream.ts'
export { probeTraeRawChatCapability, type TraeRawChatCapability } from './raw-capability.ts'
export { TraeRawCapabilityState, type TraeRawCapabilitySnapshot } from './raw-capability-state.ts'
export { TraeRawCapabilityController, type TraeRawCapabilityControllerOptions } from './raw-capability-controller.ts'
export { TraeFallbackUpstreamClient, type TraeFallbackUpstreamOptions } from './fallback-upstream.ts'
export { TraeGatedUpstreamClient, type TraeGatedUpstreamOptions } from './gated-upstream.ts'
export { applyReasoningEffort, parseReasoningCapability, TRAE_REASONING_EFFORTS, type TraeReasoningCapability, type TraeReasoningEffort } from './reasoning.ts'
export { refreshTraeCredential, type TraeRefreshDevice } from './refresh.ts'
export { decodeTraeEvent, SseDecoder, type SseEvent, type TraeStreamEvent } from './sse.ts'
export { prepareSoloBody, TraeSoloUpstreamClient, TRAE_SOLO_CHAT_PATH, TRAE_SOLO_FUNCTION, TRAE_SOLO_MODELS_PATH, type TraeSoloClientOptions } from './solo.ts'
export { bridgeTraeSoloStream, describeTraeFailure, TraeSoloBridge, wireTargetsOf, type TraeFailure, type TraeWireTarget } from './solo-bridge.ts'
export { TraeSoloRemoteCatalogClient, TRAE_SOLO_REMOTE_BASE, type TraeSoloRemoteCatalogOptions } from './solo-remote.ts'
export { TraeDelegatingUpstreamClient } from './delegating-upstream.ts'
export { TRAE_PAY_BASE, TraeUsageClient, type TraeActivityRule, type TraeCheckinClaim, type TraeCheckinStatus, type TraeUsageOptions, type TraeUsagePack, type TraeUsageSnapshot, type TraeUsageSummary, type TraeUsageView } from './usage.ts'
export { registerTraeUsageRoute, traeWebUsage, type TraeUsageRouteOptions } from './web-status.ts'
export {
  regionOfTraeStatusUrl,
  regionEnabledOf,
  regionCreditPositionOf,
  nextRegionEnabled,
  nextRegionCreditPosition,
  nextRegionSlots,
  TRAE_ACCOUNT_STATUS_PATH,
  TRAE_CHECKIN_PATH,
  TRAE_REGION_PARAM,
  TRAE_REGIONS,
  TRAE_USAGE_PATH,
  unwrapVolatile,
  unwrapVolatileDeep,
  withTraeRegion,
  type TraeWebAccountState,
  type TraeWebActivity,
  type TraeWebCheckin,
  type TraeWebCheckinClaim,
  type TraeWebCredits,
  type TraeWebUsage,
  configuredAccountsOf,
} from './status-paths.ts'
import type { TraeCreditPosition } from './status-paths.ts'
export { createTraeShim, type TraeShim } from './shim.ts'
export { UnconfiguredTraeUpstreamClient, type TraeChatResult, type TraeUpstreamClient } from './upstream.ts'
export { classifyProbeError, classifyProbeResult, MAX_PROBE_INPUT_TOKENS, probeBody, probeModelsSequentially, probeOneModel, TRAE_PROBE_TIMEOUT_MS, type TraeProbeResult, type TraeProbeVerdict } from './model-probe.ts'
export { TRAE_MODELS_TEST_PATH, type TraeModelsTestResponse, type TraeModelProbeVerdict } from './status-paths.ts'

export const name = 'dsh-connect-trae'
export const inject = ['llm']
/**
 * Settings namespace, as a plain lowercase literal. DSH 0.1.2 removed the
 * `settingsNamespace` brand constructor from the npm package, and every
 * consumer of this constant takes it as a kebab string — so no branding is
 * needed. It is the FALLBACK namespace; the namespace the host actually serves
 * comes from {@link settingsNamespaceOf} (0.1.7 keys settings by the Loader
 * entry id, which a profile patch may mount as `dsh-connect-trae` or
 * `include:dsh-connect-trae`).
 */
export const TRAE_SETTINGS_NS = 'trae'

/**
 * The namespace the HOST actually serves this plugin under.
 *
 * On DSH 0.1.7 `SettingsForms.describe()` keys every namespace by the Loader
 * entry id, and the harness looks a provider's namespace up by EXACT match —
 * advertising `trae` while the host serves `include:dsh-connect-trae` made the
 * provider read as "not configured": its configure affordance and model
 * discovery both silently went dead.
 *
 * `ctx.fiber.entry` is added by the Loader, not by Cordis itself, so it is not
 * in Cordis's public types and is absent on hosts that mount a plugin without a
 * Loader entry (a test harness, or `ctx.plugin()` called directly). Hence the
 * probe plus the documented fallback, mirroring the first-party plugins:
 * `const settingsNs = ctx.fiber.entry?.options.id ?? NS`.
 */
export function settingsNamespaceOf(ctx: unknown): string {
  const id = (ctx as { fiber?: { entry?: { options?: { id?: unknown } } } })?.fiber?.entry?.options?.id
  return typeof id === 'string' && id !== '' ? id : TRAE_SETTINGS_NS
}

/** One region's saved model state: its own directory and the user's selection within it. */
export interface TraeRegionState {
  /**
   * Whether this region's provider is switched on. Opt-out: only an explicit
   * `false` disables it, so a config predating this switch keeps both providers
   * running. A disabled region is fully withdrawn from the harness — its
   * adapter route and its configurable-provider entry both hold zero routes, so
   * it disappears from DSH's model picker instead of lingering as an
   * unselectable row (see `syncRegionRegistration`).
   */
  enabled?: boolean
  /** The last-refreshed raw directory for this region; what the card displays. */
  lastCatalog?: TraeModelInfo[]
  /** The user's selection in this region, as model ids (= Trae name). */
  enabledModelIds?: string[]
  /** Models the user explicitly enabled for image input in this region. */
  imageModelIds?: string[]
  /** Local DSH context budget per model in this region. */
  contextBudgets?: Record<string, number>
  /**
   * WHERE this region's credit readout sits (learned from dsh-connect-workbuddy
   * issue #62).
   *
   * Two seats, because the first one is not always available:
   *
   *   - `composer` — the composer tool row (`conversation.input.left`), shared
   *     with the shell's own controls. It is the closer, more glanceable seat,
   *     and it is the default so nothing moves for anyone who does not choose.
   *   - `stats` — the ambient dock below the composer card
   *     (`conversation.composer.dock`), where the shell renders its own
   *     round/step/token pills. That row is a LIST seat whose shipped occupant
   *     registers separately, so a third-party plugin that ALSO parks something
   *     in the composer row cannot crowd this readout out of existence.
   *
   * The report behind this (workbuddy #62) was exactly that: with another
   * plugin installed, the readout vanished from the composer row. Making the
   * seat a choice is what keeps one plugin's presence from deciding another's.
   * Trae already lost this readout once to a shared seat — see the sibling
   * plugin's note about the sidebar foot, where this line was clipped to "Tr"
   * beside dsh-connect-workbuddy's rows — so the setting applies here too.
   */
  creditPosition?: TraeCreditPosition
  /**
   * This region's account pool (issue #44), as the card saves it.
   *
   * Read through {@link regionStateOf} and written by the card's pool section.
   * `enabled` absent means OFF: an account pool decides where money is spent, so
   * it is opt-in and a config written before it existed must keep billing the
   * account the user picked.
   */
  pool?: TraePoolPreferences
}

export interface Config {
  authFile?: string
  edition?: 'auto' | 'cn' | 'sg' | 'solo' | 'solo-sg'
  /**
   * @deprecated Legacy single-slot account selector from before the dual
   * provider split. It is attributed to whichever region the account actually
   * belongs to (resolved once at startup from the local account scan); new
   * writes go to {@link Config.accounts}.
   */
  accountId?: string
  /**
   * Per-region account selections, keyed `cn` | `ai`. Each region's tab writes
   * its own slot; tokens remain outside settings.
   */
  accounts?: Partial<Record<TraePanel, string>>
  /**
   * Show the credit readout in the composer tool row: `Trae CN · <n>`, rendered
   * ONLY while the session's selected model belongs to this plugin, clickable
   * for the account/balances panel.
   *
   * This field first gated the sidebar credit line (issue #26, contributed by
   * JiewiW); when that line was removed in 2.13.0 the composer readout replaced
   * it and rendered unconditionally; 2.13.3 restores the switch, because the
   * user went looking for it and a readout inside the SHARED composer row
   * deserves the same opt-in the sidebar line had. The field is REUSED so an
   * existing `true` keeps the readout on across the upgrade.
   *
   * OFF by default. The card's checkbox is the only writer, so exactly one path
   * can change it. Declared volatile alongside `accounts`/`regions` so the
   * settings form can both read and write it.
   */
  showPointsInMainUi?: boolean
  /**
   * Per-region model state, keyed `cn` | `ai`. The CN and international apps
   * expose different rosters, so each keeps its own directory and selection
   * and switching accounts never drops the other region's picks.
   */
  regions?: Partial<Record<TraePanel, TraeRegionState>>
  /**
   * @deprecated Legacy single-slot fields from before the region split. They
   * predate international support and are read as the CN region's state when
   * `regions.cn` is absent; new writes go to `regions`.
   */
  lastCatalog?: TraeModelInfo[]
  /** @deprecated See {@link Config.lastCatalog}. */
  enabledModelIds?: string[]
  /** @deprecated See {@link Config.lastCatalog}. */
  contextBudgets?: Record<string, number>
  /** @deprecated See {@link Config.lastCatalog}. */
  imageModelIds?: string[]
  /** @deprecated Legacy generated runtime catalog; kept for backwards compatibility. */
  models?: TraeModelInfo[]
}

/**
 * One panel's saved state. A config written before the region split has only
 * the flat fields: those were always captured from the CN endpoint (the
 * plugin had no international support), so they are read as the CN state and
 * only when no explicit CN slot exists. The ai region never inherits them —
 * that inheritance is exactly the bug where a stale CN directory would be
 * intersected with the international catalog and silently drop the user's
 * picks (the same failure workbuddy fixed with its region split).
 *
 * Keyed by PANEL (`cn` | `enterprise` | `ai`), because each panel carries its
 * own switch, account binding and model selection. `enterprise` has no legacy
 * equivalent: it starts from an EMPTY state (its own directory, its own model
 * picks) and never inherits CN's, so switching it on cannot silently activate
 * a model list the user never chose for the tenant pool.
 */
export function regionStateOf(config: Config, panel: TraePanel): TraeRegionState {
  // Unwrap first: on DSH 0.1.7 a volatile-marked field arrives as a `{get(): T}`
  // live reference, so `config.regions?.[region]` would read `undefined` and
  // every region would silently fall back to its defaults ("settings written
  // but not read back").
  const regions = unwrapVolatile(config.regions)
  const stored = unwrapVolatile(regions?.[panel])
  if (stored !== undefined) return stored
  if (panel !== 'cn') return {}
  return {
    ...config.lastCatalog === undefined ? {} : { lastCatalog: config.lastCatalog },
    ...config.enabledModelIds === undefined ? {} : { enabledModelIds: config.enabledModelIds },
    ...config.imageModelIds === undefined ? {} : { imageModelIds: config.imageModelIds },
    ...config.contextBudgets === undefined ? {} : { contextBudgets: config.contextBudgets },
  }
}

/**
 * Whether one panel's provider is switched on (issue #11). Opt-out semantics:
 * only an explicit `false` disables it, so every config written before this
 * switch existed — including the pre-region-split flat fields, which never
 * carry `enabled` — keeps both providers running exactly as before. The card
 * reads the same rule through `regionEnabledOf`, so the two halves can never
 * disagree about a region's state.
 *
 * The ENTERPRISE panel is the one deliberate exception: it defaults OFF. A
 * consumer-only account (`tenant 7o2d894p7dr0o4`) cannot use that pool at all,
 * so opting every existing user into a second CN provider would put a route in
 * their model picker that fails on first use. It is switched on from its card
 * tab, by someone whose account actually belongs to a tenant.
 */
export function regionEnabled(config: Config, panel: TraePanel): boolean {
  const stored = regionStateOf(config, panel).enabled
  if (stored !== undefined) return stored !== false
  return panel !== 'enterprise'
}

/**
 * WHERE one region's credit readout sits (learned from workbuddy #62).
 *
 * A local reader rather than a bare schema default, so a config written before
 * the setting existed reads as `composer` — the seat that was the only one, so
 * an upgrade moves nothing on screen — and so a hand-edited value the schema
 * does not know falls back to a seat that renders rather than to nowhere.
 *
 * Shared with the browser half by construction: the card renders the Host's
 * answer for this field, so the control cannot disagree with the readout.
 */
export function creditPosition(config: Config, region: TraeRegion): TraeCreditPosition {
  return regionStateOf(config, region).creditPosition === 'stats' ? 'stats' : 'composer'
}

/**
 * Mark a schema's field as volatile.
 *
 * `volatile()` exists from schemastery 3.18.3; since 2.3.0 the peer range
 * requires `>=3.18.4`, so it is always present on a supported host. The probe
 * is kept as a safety net for a consumer that resolves an older schemastery
 * anyway (where the helper must degrade to identity — hand-writing
 * `meta.volatile = true` would bypass schemastery's own `validateVolatileSchema`
 * checks) and to keep both arms deterministically testable.
 *
 * Without the marker, 0.1.7's settings write gate REJECTS every write with
 * `Plugin entry "trae" has no volatile fields` while the scope's `set()` still
 * resolves — so the card would look like it saved and silently revert.
 */
export function asVolatile<S>(schema: S): S {
  if (typeof (schema as { volatile?: () => S }).volatile === 'function') {
    return (schema as { volatile: () => S }).volatile()
  }
  return schema
}

const modelConfig = z.object({
  id: z.string().required(),
  name: z.string().required(),
  contextWindow: z.number().step(1).min(1),
  maxTokens: z.number().step(1).min(1),
  input: z.array(z.union(['text', 'image'])),
  // Declared so the multiplier survives future hosts whose settings schema
  // might strip unknown fields; it feeds the DSH-facing display name.
  creditMultiplier: z.number(),
  // The directory function this model must be called through (Trae's roster is
  // split across SOLO-mode functions; glm-5.3 answers only solo_work_remote).
  // Persisted so a saved directory keeps working after a restart.
  wireFunction: z.string(),
  // The gateway's own `config_name` when it differs from the display id.
  //
  // Declared for the same reason as `wireFunction`, and it was the missing half
  // of that invariant: the DSH settings channel rebuilds the document through
  // THIS schema, so a field absent here is dropped on every save. The gateways
  // are case-sensitive (`deepseek-v4.1-flash` is the Remote directory id while
  // `DeepSeek-V4.1-Flash` is the `config_name`), so losing this mapping turned
  // every save into "this model answers 4001 until the next discovery". Absent
  // on rows saved before this field existed; the bridge then falls back to the
  // discovered row's own id.
  wireConfigName: z.string(),
  // Trae's own image capability flag. Persisted for the same reason as
  // `wireFunction`: the runtime catalog is re-derived from `lastCatalog` on
  // every save and every restart, so a flag dropped here would switch "auto
  // image input" back off the moment the user saved anything, and again after a
  // restart (issue #16). Absent on rows saved before this field existed, which
  // reads as "not capable" rather than "assume capable".
  multimodal: z.boolean(),
})

/**
 * One panel's saved state. Panels are keyed `cn | enterprise | ai` — see
 * {@link TraePanel}; `enterprise` is a second CN provider with its own switch,
 * account binding and model selection.
 */
const regionStateConfig = z.object({
  // Enterprise defaults OFF: a consumer-only account cannot use that pool, so
  // opting every existing user into it would put a failing route in their model
  // picker. Everything else keeps opt-out semantics (`false` withdraws it).
  enabled: z.boolean().description('Whether this panel\'s provider is offered to DSH (false withdraws it entirely)'),
  lastCatalog: z.array(modelConfig).default([]),
  enabledModelIds: z.array(z.string()).default([]),
  imageModelIds: z.array(z.string()).default([]),
  contextBudgets: z.dict(z.number().step(1).min(1)).default({}),
  // WHERE this region's credit readout sits (learned from workbuddy #62).
  // Defaults to `composer` because that is the seat that already existed, so an
  // upgrade moves nothing on screen; `stats` is what a user reaches for when
  // another plugin occupies the composer row. Declared in the schema so the DSH
  // settings form can read it, and read back through `regionCreditPositionOf`
  // rather than from a schema default alone — a profile written before this
  // field existed must still read as `composer`.
  creditPosition: z.union([z.const('composer'), z.const('stats')]).default('composer').description('积分读数显示位置："composer" = 输入框工具栏（默认），"stats" = 输入框下方（与「轮次 / 步数 / token」统计同一行）。装了别的插件后读数不显示时改成 stats。'),
  // Account pool (issue #44): which accounts this panel may bill, which model a
  // test probes, and whether the pool routes at all. Declared HERE because the
  // settings channel rebuilds the document through this schema, and a field
  // absent here is dropped on every save — the failure that once reset
  // `wireConfigName` and turned every save into a 4001.
  //
  // DEFAULTS ARE DECLARED, not merely documented, so this slot reads the same
  // everywhere it is read: the settings form's initial values, `regionStateOf()`
  // output, and the draft the card compares against. Without them schemastery
  // materialises `pool` as `{ memberAccountIds: [] }` and DROPS `enabled` /
  // `targetModelId`, which would surface on the settings form as an
  // uninitialised control instead of the OFF/auto the code actually means.
  //
  // `probeInputTokens` is deliberately ABSENT (unlike the WorkBuddy pool): that
  // knob sizes a probe against a measured context threshold, while Trae's probe
  // is a fixed minimal chat — offering a size selector here would promise a
  // measurement the probe does not make.
  pool: z.object({
    enabled: z.boolean().default(false).description('账号池：打开后本面板由池中可用账号轮流计费（关闭时按下面的绑定账号）'),
    targetModelId: z.string().default('').description('账号池测速使用的模型 id（留空 = 自动选择免费模型）'),
    memberAccountIds: z.array(z.string()).default([]).description('加入本面板账号池的账号 id（显式勾选，默认为空）'),
    // 0 = the historical one-word probe. A larger value pads the probe request so
    // a size-based refusal shows up in the test instead of in the user's real turn.
    probeInputTokens: z.number().default(0).description('账号池测试请求填充的 token 量（0 = 最小请求，不填充）'),
  }).default({}),
})

const accountSelectionConfig = z.object({
  cn: z.string().description('Selected domestic (CN) account id (never a token)'),
  ai: z.string().description('Selected international account id (never a token)'),
  // The enterprise panel draws on the SAME cn credentials but keeps its own
  // binding: pointing the consumer tab at a personal account must not move the
  // tenant tab. Absent means "this region's default", exactly like the others.
  enterprise: z.string().description('Selected account id for the CN enterprise pool (never a token)'),
})

export const Config: z<Config> = z.object({
  authFile: asVolatile(z.string().description('Optional Trae storage.json path override')),
  edition: asVolatile(z.union(['auto', 'cn', 'sg', 'solo', 'solo-sg']).default('auto').description('Trae edition hint')),
  accountId: z.string().description('Deprecated: pre-split account selector, attributed to its own region'),
  // The cast is required because `asVolatile` returns `z<T>` with `T` inferred
  // from the wrapped schema, which is narrower than the optional
  // `Partial<Record<TraeRegion, string>>` the Config interface declares. The
  // schema is unchanged either way — this only restores the assignment.
  // GATES the composer-row credit readout, restored as a real switch in 2.13.3
  // after the user looked for it in settings. History: it first gated the
  // sidebar credit line (issue #26), was retired when that line was removed in
  // 2.13.0 (the composer readout replaced it and rendered unconditionally), and
  // is back because a readout inside the SHARED composer row deserves the same
  // opt-in the sidebar line had. The same field is REUSED on purpose: a user
  // who already enabled the old switch keeps the readout after the upgrade
  // instead of finding it silently off.
  // OFF by default, matching the stated preference for the sidebar line: a row
  // inside the shared composer toolbar is something to ask for, not to impose.
  showPointsInMainUi: asVolatile(z.boolean().default(false).description('在输入框工具栏显示积分读数「Trae CN · <数值>」（仅当选中的模型属于本插件时出现，可点击查看账号与积分明细）')),
  accounts: asVolatile(accountSelectionConfig.description('Per-panel account selections, keyed cn | enterprise | ai')) as z<Partial<Record<TraePanel, string>>>,
  regions: asVolatile(z.dict(regionStateConfig).default({}).description('Per-panel model directory and selection, keyed cn | enterprise | ai')),
  lastCatalog: z.array(modelConfig).description('Deprecated: pre-region-split CN model directory') as z<TraeModelInfo[]>,
  enabledModelIds: z.array(z.string()).default([]).description('Deprecated: pre-region-split CN selection'),
  contextBudgets: z.dict(z.number().step(1).min(1)).default({}).description('Deprecated: pre-region-split CN context budgets'),
  imageModelIds: z.array(z.string()).default([]).description('Deprecated: pre-region-split CN image opt-in'),
  models: z.array(modelConfig).description('Legacy generated Trae model list') as z<TraeModelInfo[]>,
})

/** Every region, in card tab order. */
const REGION_KEYS: readonly TraeRegion[] = ['cn', 'ai']

/**
 * How long a measured check-in state stays usable (issue #77).
 *
 * The upstream rewards ONE check-in per device per day, so a figure measured
 * minutes ago cannot have changed; re-reading it is a pure upstream round-trip.
 * Ten minutes matches the sibling plugin's cache and is comfortably shorter than
 * a day, so a genuine second check-in still shows up on the next poll after it.
 */
const CHECKIN_CACHE_MS = 10 * 60_000

/**
 * What ONE failed real request means for the account that served it (issue #44).
 *
 * The shim only reports account-scoped kinds here, so this table never has to
 * interpret `not_found` (a model the account cannot see) or `client` (our own bad
 * body) — both would exclude a healthy account for good over something that is
 * not about the account at all.
 *
 * `credential-rejected` is the one permanent entry, and deliberately so: a 401
 * from the chat gateway means the stored token cannot be refreshed into one that
 * works, and the honest recovery is a re-login (which the card offers), not a
 * silent retry every half hour.
 */
const POOL_OUTCOME_BY_KIND: Readonly<Record<TraeUpstreamErrorKind, TraePoolOutcome>> = {
  authentication: 'credential-rejected',
  hard_credit: 'out-of-credit',
  soft_rate: 'rate-limited',
  server: 'unavailable',
  not_found: 'not-found',
  client: 'failed',
  unconfigured: 'failed',
}

/**
 * One region's complete runtime stack: its own credential store, model
 * catalog, wire map, upstream clients, and loopback shim. The two regions are
 * fully parallel provider stacks, so a domestic and an international account
 * serve simultaneously and a change on one side (account switch, catalog
 * refresh) never touches the other.
 */
/**
 * One provider id's chat plumbing: the pool it bills, the client pinned to that
 * pool, the bridge that resolves display ids to wire names, and the bearer
 * secret its adapter authenticates to the shim with.
 */
interface TraeProviderRouteClient {
  provider: string
  route: TraeChatRoute
  /** Raw SOLO client pinned to this route's gateway. */
  client: TraeSoloUpstreamClient
  /** The shim-visible client (bridge → delegating), what the adapter calls. */
  upstream: TraeDelegatingUpstreamClient
  /** Bearer secret this provider's adapter presents to the shim. */
  secret: string
}

interface TraeRegionStack {
  region: TraeRegion
  store: TraeCredentialStore
  catalog: TraeCatalog
  shim: TraeShim
  delegating: TraeDelegatingUpstreamClient
  /**
   * One entry per provider id this region publishes, in picker order.
   *
   * Each provider gets its OWN chat client pinned to its billing pool and its
   * own bearer secret, so the pool a turn reaches is decided by which provider
   * the model was requested under — never by a per-call guess.
   */
  routeClients: Record<string, TraeProviderRouteClient>
  usageClient: TraeUsageClient
  /**
   * CN credit balance of an account other than the bound one, read without
   * rebinding the store (issue #25). Throws when that account's token is
   * unusable; callers treat a throw as "no answer for this account".
   */
  creditsOfAccount(accountId: string): Promise<TraeWebCredits | undefined>
  /**
   * Per-account status for one account row of the card's table: CN → check-in
   * + balances, ai → subscription. Read through a throwaway client bound to
   * that account, so the store's selection (and every in-flight chat request)
   * is never disturbed. Throwing is treated by callers as "no status for this
   * account", which keeps the row visible without a figure.
   */
  accountStateOf(accountId: string): Promise<TraeWebAccountState | undefined>
  /**
   * Claim today's check-in reward FOR ONE NAMED ACCOUNT through a throwaway
   * client bound to that account (same shared device id), so the row's own
   * button can claim without first switching the whole binding — and without
   * moving billing, which stays wherever the user put it. Undefined when that
   * account's token cannot be read; otherwise the upstream claim + the
   * refreshed check-in state.
   */
  claimCheckinOf(accountId: string): Promise<{ claim: TraeCheckinClaim; checkin: TraeCheckinStatus } | undefined>
  /** Re-read this region's live directory from the upstream. */
  discoverModels(signal?: AbortSignal): Promise<readonly TraeModelInfo[]>
  /** Test the given model ids for availability (one real minimal call each). */
  probeModels(ids: readonly string[]): Promise<{ results: { id: string; verdict: string; detail: string }[]; skipped?: string[] }>
  /** Rebuild the adapter snapshot after `catalog.set`; no-op before registration. */
  invalidateAdapter: () => void
  /**
   * The most recent successful discovery for THIS panel, or an empty list
   * before the first one lands.
   *
   * Kept next to the stack because applySelection needs it: every settings
   * write rebuilds the catalog from the saved rows, and saved rows predating
   * wireConfigName carry wireFunction alone -- without this the write would
   * strip the case mapping the bridge just taught it.
   */
  lastDiscovery: readonly TraeModelInfo[]
  /** Raw-Chat capability state for this region's card route. */
  rawDiagnostic: () => TraeRawDiagnostic
  /**
   * Display id → wire `config_name` for THIS region. Exposed so the account pool
   * can build a bridge for an account that is not the selected one and still
   * resolve ids exactly as a real chat would.
   */
  wireResolver: (displayId: string) => TraeWireTarget | undefined
  /** This region's best-effort device identity (the shared `x-device-id`). */
  identity: () => Promise<TraeIdentity>
  /** The route this panel's primary provider bills through. */
  routeOf: (provider: string) => TraeChatRoute
}

export function apply(ctx: Context, config: Config): void {
  // The namespace the host actually serves (see `settingsNamespaceOf`). On
  // 0.1.7 this is the Loader entry id, and the harness looks a provider's
  // namespace up by EXACT match — advertising anything else makes the provider
  // read as unconfigured (issue #13-class regression, workbuddy 2.0.16).
  const settingsNs = settingsNamespaceOf(ctx)
  let current = () => config
  const enabledSet = (value: Config, panel: TraePanel): ReadonlySet<string> => new Set(regionStateOf(value, panel).enabledModelIds ?? [])
  const imageSet = (value: Config, panel: TraePanel): ReadonlySet<string> => new Set(regionStateOf(value, panel).imageModelIds ?? [])
  /**
   * Per-region wire state. Each region's discovery owns its own maps: the CN
   * and international rosters overlap (and spell some ids differently), so a
   * shared map would let one region's answer filter the other region's
   * catalog. Display keys (lowercased id AND name) of every model known to be
   * callable via `llm_utils_chat` are recorded by that region's discovery; a
   * model whose id and name are both absent is a dead config_name (Remote
   * advertises it, `get_detail_param` has no match, e.g. `Doubao-Seed-Code` /
   * `glm-5.3`) and must never be served — even from a stale saved
   * `lastCatalog` / `models` / `enabledModelIds` that still lists it.
   */
  const wireState = {} as Record<TraePanel, {
    callableKeys: Set<string>
    /**
     * Whether discovery has actually produced a directory this run. Only a
     * completed merge may filter anything: an empty `callableKeys` means "no
     * wire answer yet" (no credentials, startup discovery failed or still in
     * flight) and must not be read as "nothing is callable".
     */
    resolved: boolean
    byId: Map<string, TraeWireTarget>
    byName: Map<string, TraeWireTarget>
  }>
  for (const panel of TRAE_PANELS) {
    wireState[panel] = { callableKeys: new Set(), resolved: false, byId: new Map(), byName: new Map() }
  }
  /**
   * Warm the wire map before anything spends quota.
   *
   * The bridge resolves a model's directory function from the wire map,
   * falling back to the catalog row. Right after a restart neither may be
   * populated yet — discovery only runs when the host refreshes its model list
   * — and a probe sent without the function is answered `4001` for every model
   * that a non-default function serves (`Doubao-Seed-Code` lives on
   * `solo_agent_remote`). One discovery here is cheaper than telling the user
   * that a working account is unavailable.
   */
  const warmWireMap = async (panel: TraePanel): Promise<void> => {
    if (wireState[panel].resolved) return
    try {
      await stacks[panel].discoverModels()
    } catch {
      // Not the probe's failure: it still runs and reports what upstream says.
    }
  }
  // Drop dead rows from a (possibly stale) saved directory. No-op when that
  // region's wire map has not been resolved yet, so a transient network
  // failure never hides the whole catalog.
  const dropDeadModels = (rows: readonly TraeModelInfo[], panel: TraePanel): readonly TraeModelInfo[] => {
    const wire = wireState[panel]
    if (!wire.resolved) return rows
    return rows.filter(model =>
      wire.callableKeys.has(model.id.trim().toLowerCase()) || wire.callableKeys.has(model.name.trim().toLowerCase()))
  }
  // Runtime catalog derives from the last-refreshed raw directory plus the
  // user's selection and context budgets. Legacy `models` and pre-budget
  // `lastCatalog` rows are sanitized, so saved `@1m` variants cannot return.
  // Dead config_names are dropped against the live wire map, so a stale save
  // cannot resurrect `Doubao-Seed-Code` / `glm-5.3`. An empty selection serves
  // the whole directory, so a never-configured plugin still exposes models.
  // Built-in last resort. It is this plugin's own static list, never a row
  // Remote advertised, so it must NOT be run through `dropDeadModels`: the
  // live wire map can only ever confirm the ids it happens to know, and
  // filtering against it would let a partial catalog delete the safety net
  // precisely when it is needed. Its ids are the well-known Trae model names.
  // Region-scoped: the two regions expose different rosters, so an account
  // must never see the other region's fallback list.
  // The static fallback list is per REGION (the rosters differ), not per panel:
  // the enterprise panel reuses the CN list, which is the closest safety net it
  // has when its own directory has never been refreshed.
  const fallbackModels = (value: Config, panel: TraePanel): readonly TraeModelInfo[] =>
    applyImageSelection(fallbackModelsFor(regionOfPanel(panel)), imageSet(value, panel))
  const derive = (value: Config, raw: readonly TraeModelInfo[], panel: TraePanel): readonly TraeModelInfo[] => {
    const selectedImages = imageSet(value, panel)
    const derived = deriveCatalog(applyImageSelection(sanitizeCatalog(dropDeadModels(raw, panel)), selectedImages), enabledSet(value, panel), regionStateOf(value, panel).contextBudgets ?? {})
    return derived.length > 0 ? derived : fallbackModels(value, panel)
  }
  // Runtime catalog for one region: that region's saved directory (explicit
  // slot, else the pre-split flat fields which are CN-only), else the legacy
  // `models` list (also CN-only), else the region's fallback.
  const configuredModels = (value: Config, panel: TraePanel): readonly TraeModelInfo[] => {
    const state = regionStateOf(value, panel)
    // The legacy flat `models` list is CN-only AND consumer-only: the
    // enterprise pool has no legacy equivalent, so it must not inherit it.
    return state.lastCatalog?.length ? derive(value, state.lastCatalog, panel)
      : panel === 'cn' && value.models?.length ? derive(value, value.models, panel)
        : fallbackModels(value, panel)
  }
  // What the plugin card displays: the region's last-refreshed raw directory,
  // so the user re-reads the current Trae catalog rather than a stale snapshot.
  const displayModels = (value: Config, panel: TraePanel): readonly TraeModelInfo[] => {
    const state = regionStateOf(value, panel)
    return state.lastCatalog?.length ? dropDeadModels(sanitizeCatalog(state.lastCatalog), panel)
      : panel === 'cn' && value.models?.length ? dropDeadModels(sanitizeCatalog(value.models), panel)
        : fallbackModelsFor(regionOfPanel(panel))
  }
  /**
   * Legacy migration for the pre-split single `accountId`: its region is
   * resolved once from the local account scan and the selection is then
   * attributed to that region ONLY — the other region keeps its documented
   * default (first discovered account of that region) instead of silently
   * inheriting a selection that belongs to the other side of the split.
   */
  let legacyAccountRegion: TraeRegion | undefined
  /**
   * Which account a panel is bound to.
   *
   * Keyed by PANEL: the enterprise pool draws on the same CN credentials but
   * keeps its OWN binding, so pointing the consumer tab at a personal account
   * never moves the enterprise tab (and vice versa). A panel with no explicit
   * binding falls through to that REGION's default selection, which is the
   * store's own "preferred account for this region".
   */
  const effectiveAccountFor = (panel: TraePanel, value: Config): string | undefined => {
    // `accounts` is volatile on the 0.1.7 line: the raw value is a live
    // reference, so `value.accounts?.[panel]` would read `undefined` and the
    // user's saved account selection would be silently ignored.
    const explicit = unwrapVolatile(value.accounts)?.[panel]
    if (explicit !== undefined) return explicit
    const region = regionOfPanel(panel)
    // The legacy pre-split selection belongs to its own region's CONSUMER tab,
    // never to the enterprise one.
    if (panel === 'enterprise') return undefined
    return legacyAccountRegion === region ? value.accountId : undefined
  }

  /**
   * Retry a directory read once. The gateways answer an intermittent 401 for a
   * credential that works moments later (observed 2026-09-15), and a failed
   * skeleton read would otherwise drop the runtime catalog back to the saved
   * snapshot — hiding every model added since that save (issue #7's glm-5.3
   * among them).
   */
  async function withDirectoryRetry<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read()
    } catch (first: unknown) {
      await new Promise(resolve => setTimeout(resolve, 800))
      try {
        return await read()
      } catch {
        throw first
      }
    }
  }

  /**
   * One stack per PANEL.
   *
   * `cn` and `enterprise` share a credential REGION but not a directory, a wire
   * map or a model selection: the two pools publish different rosters, so a
   * shared catalog would let one pool's answer filter the other's models. Each
   * panel therefore gets its own catalog, wire state, clients and shim routes,
   * and the credential store below is the only thing they have in common.
   */
  const stacks = {} as Record<TraePanel, TraeRegionStack>
  for (const panel of TRAE_PANELS) {
    const region = regionOfPanel(panel)
    /**
     * Whether tenant (enterprise) accounts are also offered by the CONSUMER
     * panels.
     *
     * Off by default, so a published build offers an enterprise login only
     * under the enterprise panel. Opt-in per machine, and intentionally not
     * surfaced in user-facing documentation.
     */
    const tenantLocal = process.env['DSH_TRAE_TENANT_IN_CONSUMER'] === '1'
    const catalog = new TraeCatalog(region)
    const wire = wireState[panel]
    /**
     * Best-effort device identity for this region's installation. Prefer the
     * selected credential's own edition so an international account reads its
     * own installation's identity (machine/device ids are per-install),
     * mirroring the credential store's account binding; the explicit `edition`
     * config still wins as the user's own narrowing. Candidates are then
     * narrowed to THIS region's editions, so the CN stack can never read an
     * international install's identity (and vice versa).
     */
    const identity = async () => {
      let preferred: TraeEdition | undefined
      try { preferred = (await store.current())?.edition } catch { /* fall through to every candidate */ }
      // `authFile` and `edition` are volatile on the 0.1.7 line, so the raw
      // config value is a `{get(): T}` live reference: reading it directly
      // would make the storage path an object and the edition a truthy non-enum
      // (silently mis-resolving every credential).
      const authFile = unwrapVolatile(config.authFile)
      const edition = unwrapVolatile(config.edition)
      const explicit = edition !== undefined && edition !== 'auto' ? edition : undefined
      const hint = explicit ?? preferred
      // Pick the first desktop candidate whose storage file actually exists,
      // mirroring the credential store's skip-missing semantics. Windows
      // machines often install only SOLO, so pinning the first (cn) candidate
      // and reading a missing file used to throw ENOENT and break every
      // refresh/chat request.
      const candidates = authFile === undefined
        ? traeStorageCandidates().filter(item => item.source === 'desktop'
          && (hint !== undefined ? item.edition === hint : regionOfEdition(item.edition) === region))
        : [{ edition: hint ?? (region === 'ai' ? 'sg' as const : 'solo' as const), path: authFile, source: 'desktop' as const }]
      // Desktop storage first; a machine with only the CLI (`traecli`, the WSL2
      // case) has no storage.json at all, and identity resolution falls back to
      // the CLI home's own deterministic identifiers instead of failing every
      // directory refresh and chat request.
      const cliEdition = hint ?? (region === 'ai' ? 'solo-sg' as const : 'cn' as const)
      return resolveTraeIdentity(candidates, cliEdition)
    }
    /**
     * The current refresh contract signs a DeviceProof with the install's own
     * registered keypair, so every field the server reads must come from the
     * SAME installation the credential belongs to.
     *
     * Resolution failures leave `deviceKeyPair` absent, and the refresh then
     * degrades to the superseded contract instead of sending an unsigned
     * request the server answers with `20405 Device proof required`.
     */
    const refreshDeviceSafe = async (): Promise<TraeRefreshDevice | undefined> => {
      try {
        const value = await identity()
        return {
          deviceId: value.deviceId,
          machineId: value.machineId,
          ...value.deviceName === undefined ? {} : { deviceName: value.deviceName },
          ...value.deviceModel === undefined ? {} : { deviceModel: value.deviceModel },
          ...value.deviceBrand === undefined ? {} : { deviceBrand: value.deviceBrand },
          ...value.deviceCpu === undefined ? {} : { deviceCpu: value.deviceCpu },
          ...value.osVersion === undefined ? {} : { osVersion: value.osVersion },
          ...value.appVersion === undefined ? {} : { appVersion: value.appVersion },
          ...value.deviceKeyPair === undefined ? {} : { deviceKeyPair: value.deviceKeyPair },
        }
      } catch {
        return undefined
      }
    }
    const store = new TraeCredentialStore({
      region,
      // The enterprise panel may only bill through a TENANT account. Its store
      // therefore refuses a personal binding (falls back to the preferred
      // tenant account) and never picks one by default — the tenant gateway
      // hands a personal account a full directory, so this is the only place
      // the difference can be enforced before a turn fails with `4019`.
      ...panel === 'enterprise' ? { requireTenant: true } : { hideTenantAccounts: !tenantLocal },
      ...unwrapVolatile(config.authFile) === undefined ? {} : { storagePath: unwrapVolatile(config.authFile) },
      edition: unwrapVolatile(config.edition) ?? 'auto',
      // The refresh callback resolves the device identity lazily so an
      // international SOLO account refreshes with its own installation's
      // machine/device ids (the official client sends a DeviceInfo body there).
      refresh: async credential => refreshTraeCredential(credential, undefined, await refreshDeviceSafe()),
    })
    // No baseUrl: the chat gateway follows the selected credential's region
    // (`trae-api-cn.mchost.guru` for CN, `coresg-normal.trae.ai` for ai).
    //
    // The DISCOVERY client is pinned to this PANEL's routing. A tenant pool
    // publishes a roster of its own (DeepSeek-V4.1-Flash is served only by the
    // enterprise gateway), so an enterprise-panel discovery that read the
    // consumer gateway would never see the config_names of its own pool, and
    // the wire mapping would be absent for every one of them.
    const solo = new TraeSoloUpstreamClient({
      credential: () => store.resolve(),
      identity,
      ...panel === 'enterprise' ? { route: 'enterprise' as const } : {},
      log: (message, detail) => ctx.logger.warn(message, detail),
    })
    const remoteCatalog = new TraeSoloRemoteCatalogClient({
      credential: () => store.resolve(),
      // The directory falls back to the chat-gateway base in restricted
      // networks; surface when that happened (and when the fallback is reused)
      // so "why am I on a different host" is diagnosable in the log.
      log: (message, detail) => ctx.logger.warn(message, detail),
    })
    // Keep the native llm_utils_chat bridge as the only chat route: unlike the
    // polling Remote session API, it preserves Trae's structured tool_calls so
    // DSH can execute local read/write/bash tools and continue the agent loop.
    // A wire resolver maps each display model id to its real llm_utils_chat
    // config_name. It is populated once at startup from get_detail_param and
    // never depends on a user-refreshed or re-saved directory, so Seed-Code and
    // other models whose wire id differs from the display id resolve correctly
    // even on a fresh install. The map is per region: the two rosters overlap
    // but are not identical, and a shared map would cross-resolve ids.
    const wireResolver = (displayId: string): TraeWireTarget | undefined =>
      wire.byId.get(displayId) ?? wire.byName.get(displayId.trim().toLowerCase())
    /**
     * One client + bridge per provider id.
     *
     * `routeOfTraeProvider` pins each to its billing pool: the consumer ids get
     * the region gateway exactly as before, `trae-enterprise` gets the tenant
     * gateway and stamps the `session_id` it requires. The discovery client
     * below stays UNROUTED on purpose — it owns the roster/probe path and, for
     * a tenant credential, reads both pools so the shared catalogue keeps every
     * model either one serves.
     */
    /**
     * Latest successful discovery for this panel, mutated by discoverModels
     * and READ by applySelection (via the stack): a settings write rebuilds
     * the catalog from saved rows that may predate wireConfigName, and the
     * merge below is what keeps the case mapping alive across it.
     */
    const latestDiscovery: TraeModelInfo[] = []
    const routeClients = {} as Record<string, TraeProviderRouteClient>
    const shimRoutes: TraeShimRoute[] = []
    // Exactly ONE provider per panel. The route label is the shim's bearer
    // key and must be unique within a shim, so a panel never publishes the
    // other panels' ids either.
    for (const provider of [providerOfPanel(panel)]) {
      const route = routeOfTraeProvider(provider) ?? 'solo'
      const client = new TraeSoloUpstreamClient({
        credential: () => store.resolve(),
        identity,
        route,
        log: (message, detail) => ctx.logger.warn(message, detail),
      })
      const bridge = new TraeSoloBridge(client, catalog, wireResolver)
      // The shim always sees a stable client; the Raw gateway may replace the
      // delegate asynchronously, but it stays disabled until a probe succeeds.
      const delegating = new TraeDelegatingUpstreamClient(bridge)
      routeClients[provider] = { provider, route, client, upstream: delegating, secret: '' }
      shimRoutes.push({ label: route, client: delegating, pool: poolShimHooksOf(panel) })
    }
    const shim = createTraeShim({ catalog, routes: shimRoutes, logger: ctx.logger })
    for (const entry of Object.values(routeClients)) entry.secret = shim.tokenOf(entry.route)
    /**
     * The region's PRIMARY provider plumbing, used by region-wide paths that
     * are not pool-specific: model probing, Raw-Chat status, and the stack's
     * `delegating` handle. Per-provider turns never go through this.
     */
    const primary = routeClients[providerOfPanel(panel)] as TraeProviderRouteClient
    let rawDiagnostic = (): TraeRawDiagnostic => ({ state: 'disabled' })

    // Raw Chat is probed on the DOMESTIC panel only: the probe model
    // (`qwen-3.7-plus`) is CN-only, and the gateway stays disabled either way
    // — SOLO remains the only live path. The enterprise panel is a second view
    // of the same CN credential, so probing it too would spend a second probe
    // for the same answer; it reports `disabled` like the international one.
    if (panel === 'cn') {
      void (async () => {
        try {
          const probeModel = 'qwen-3.7-plus'
          const resolved = await resolveTraeRawRuntime(store, probeModel)
          const rawClient = new TraeRawChatUpstreamClient({
            credential: () => store.resolve(),
            identity: async () => resolved.identity,
            config: { model: resolved.runtime.modelName, configName: resolved.runtime.configName, passBackReasoning: true, runtime: resolved.runtime },
          })
          const gateway = createTraeRawGateway({
            raw: rawClient,
            solo: new TraeSoloBridge(primary.client, catalog, wireResolver),
            endpoint: `${REGION_GATEWAYS.cn.chat}/api/ide/v2/llm_raw_chat`,
            edition: resolved.identity.edition,
            identity: { appVersion: resolved.identity.appVersion ?? '', buildVersion: resolved.identity.buildVersion ?? '' },
            runtime: resolved.runtime,
            // Raw Chat stays opt-in and unverified; SOLO remains the only live path.
            enabled: false,
          })
          primary.upstream.replace(gateway.upstream)
          rawDiagnostic = () => gateway.diagnostic()
          ctx.effect(() => () => gateway.invalidate(), 'dsh-connect-trae: Raw capability invalidation')
        } catch (error: unknown) {
          ctx.logger.warn('dsh-connect-trae: Raw gateway unavailable; continuing with native SOLO tool-call channel', error)
        }
      })()
    }

    // Usage/credit summary served to the browser half. Optional on the
    // `webServer` seam; absent in headless runs, the host provider still
    // works.
    //
    // Account selection is strictly the user's choice: the store resolves the
    // explicitly selected `accountId` verbatim, and only falls back to the
    // first discovered account when nothing has been selected yet. The plugin
    // must NOT silently switch to a different account that happens to have
    // general credits — that would bill the wrong account against the user's
    // intent.
    //
    // `deviceId` feeds the check-in routes only: the claim endpoint refuses a
    // request without `x-device-id` (business code 9004, verified 2026-09-24),
    // and it must be THIS installation's id — the same one the chat path sends.
    // Resolved lazily and best-effort, so a machine whose identity cannot be
    // read still gets the read-only usage panel.
    const usageClient = new TraeUsageClient({
      credential: () => store.resolve(),
      deviceId: async () => (await identity()).deviceId,
    })

    stacks[panel] = {
      region,
      store,
      catalog,
      shim,
      lastDiscovery: latestDiscovery,
      // The region's PRIMARY (first published) provider is what region-wide
      // diagnostics — probe, raw-chat status, "test this model" — speak for.
      // Per-provider turns go through `routeClients` and never touch this.
      delegating: routeClients[providerOfPanel(panel)]?.upstream as TraeDelegatingUpstreamClient,
      routeClients,
      usageClient,
      /**
       * Credit balance of one named account, WITHOUT rebinding the store
       * (issue #25). The card asks this only after it saw the bound account
       * come back empty, so it can point at a login that still works.
       *
       * A throwaway client is used on purpose: the shared `usageClient` reads
       * `store.resolve()`, which is bound to the selected account, and calling
       * `selectAccount` to look at a neighbour would both race concurrent chat
       * requests and persist a switch the user never made. The credential is
       * resolved (not merely looked up) so an account whose short-lived access
       * token lapsed overnight still answers: its refresh token is good for
       * months, and reporting `—` for a recoverable account is a lie.
       */
      creditsOfAccount: async (accountId: string) => {
        const credential = await store.resolveCredentialOf(accountId)
        if (credential === undefined) return undefined
        const snapshot = await new TraeUsageClient({ credential: async () => credential }).snapshot()
        return toCredits(snapshot)
      },
      accountStateOf: async (accountId: string) => {
        const state: TraeWebAccountState = { id: accountId }
        // The BOUND account's stored token is normally expired and `resolve()`
        // refreshes it on read, so its row reads through the SHARED client. Any
        // other account goes through a throwaway client so the binding (and
        // every in-flight chat request sharing it) is never disturbed — the
        // same rule `traeAccountCredits` already follows.
        const selectedCredential = await store.current()
        const bound = selectedCredential !== undefined && traeAccountId(selectedCredential) === accountId
        const client = bound
          ? usageClient
          : (() => {
            const credential = store.resolveCredentialOf(accountId)
            return new TraeUsageClient({
              credential: async () => credential,
              deviceId: async () => (await identity()).deviceId,
            })
          })()
        if (region === 'ai') {
          // International accounts are subscription-based: read their pay
          // status; a failure keeps the row without a subscription figure.
          state.payStatus = await client.payStatus()
          return state
        }
        // CN accounts carry check-in + balances, settled independently so one
        // failure does not take the whole row down.
        const [snapshot, checkin] = await Promise.allSettled([client.snapshot(), client.checkinStatus()])
        if (snapshot.status === 'fulfilled') state.credits = toCredits(snapshot.value)
        if (checkin.status === 'fulfilled') state.checkin = toCheckin(checkin.value)
        return state
      },
      claimCheckinOf: async (accountId: string) => {
        const selectedCredential = await store.current()
        const bound = selectedCredential !== undefined && traeAccountId(selectedCredential) === accountId
        const client = bound
          ? usageClient
          : (() => {
            const credential = store.resolveCredentialOf(accountId)
            return new TraeUsageClient({
              credential: async () => credential,
              deviceId: async () => (await identity()).deviceId,
            })
          })()
        const claim = await client.claimCheckin()
        const checkin = await client.checkinStatus()
        return { claim, checkin }
      },
      discoverModels: async (signal?: AbortSignal): Promise<readonly TraeModelInfo[]> => {
        // The Remote /models directory is the model skeleton (display id, name,
        // context, credit, reasoning). get_detail_param only supplies the real
        // llm_utils_chat config_name for models whose display id differs from
        // the wire id (e.g. Seed-Code); it does not define the catalog itself.
        // The remote directory is the merge skeleton (it is what filters
        // agent-internal configs out of the wire roster). Trae's directory
        // endpoints rate-limit aggressively — observed as an intermittent
        // HTTP 401 on a credential that answers 200 seconds earlier — so a
        // transient rejection must not silently collapse the whole catalog to
        // the saved snapshot. Retry it once before giving up.
        const remote = await withDirectoryRetry(() => remoteCatalog.fetchModels(signal))
        const wireModels = await solo.fetchModels(signal)
        const merged = mergeTraeModelSources(remote, wireModels)
        // A row whose function is a NON-chat roster (solo_agent, builder_v3) is
        // not callable through llm_utils_chat BY THAT FUNCTION — asking answers
        // 4011/4001. The row is KEPT and only the function is cleared, so the
        // bridge falls back to the default chat function. Dropping it would
        // re-hide the nine `solo_agent`-only models issue #19 was opened about
        // (gpt-5.5, gpt-5.6-*, gpt-6-astra, glm-5.2, kimi-k2.7-code,
        // Dola-Seed-2.0-Code, deepseek-v4-flash-0731) precisely on a restricted
        // network, where the directory group is the only attribution there is —
        // and those models DO answer under the default function (measured). See
        // `withChatCallableFunctions` for the full trail.
        const callable = withChatCallableFunctions(merged, TRAE_DIRECTORY_FUNCTIONS[region])
        const chatFunctions = TRAE_DIRECTORY_FUNCTIONS[region]
        for (const model of merged) {
          if (model.wireFunction === undefined || chatFunctions.includes(model.wireFunction)) continue
          ctx.logger.warn(`model directory row is pinned to a non-chat function and will be called through the default chat function instead: ${model.id} (pinned to function ${model.wireFunction})`)
        }
        // Record every callable display key (id and name) so stale saved
        // catalogs are filtered against the live wire map and dead
        // config_names cannot be resurrected from an old `lastCatalog` /
        // `models` / `enabledModelIds`.
        wire.callableKeys.clear()
        for (const model of callable) {
          wire.callableKeys.add(model.id.trim().toLowerCase())
          wire.callableKeys.add(model.name.trim().toLowerCase())
        }
        // Mark the wire map authoritative only once a merge produced rows. A
        // live Trae account that reports only part of the catalog (or an
        // edition whose `/models` list is a subset) would otherwise let this
        // filter delete every model it did not mention — including the
        // built-in fallback set, which Remote never advertised and so can
        // never appear in `callableKeys`.
        wire.resolved = callable.length > 0
        // Populate the startup wire resolver (display id and display name →
        // wire config_name + the directory function it was discovered under) so
        // the chat bridge resolves the real wire target even when the persisted
        // catalog lacks the row entirely.
        //
        // EVERY callable row is registered, not only the ones whose wire
        // config_name differs from the display id. A pool can name a target
        // model the user never enabled for chat: the runtime catalog filters by
        // `enabledModelIds`, so the bridge then sees no row at all -- and with
        // no resolver entry it sent the raw id under the DEFAULT function,
        // which answers `4001 config_name rejected` (Doubao-Seed-Code is
        // served only by `solo_agent_remote`; `solo_work_lite` rejects it).
        // The identity mapping is what keeps that function knowledge alive.
        const wireTargets = wireTargetsOf(callable)
        wire.byId = wireTargets.byId
        wire.byName = wireTargets.byName
        // Discovery is a pure data return (workbuddy semantics): the card's
        // "refresh" drafts this list for an explicit save, and the startup
        // seed installs it into the live catalog. Writing it here would leak
        // un-enabled models into the runtime catalog until the next save --
        // but the merge is KEPT on the stack: applySelection re-merges the
        // wire fields into the saved rows on every settings write.
        latestDiscovery.length = 0
        latestDiscovery.push(...callable)
        return callable
      },
      /**
     * One-click availability test. The ids come from the card, so each one is
     * checked against THIS region's live catalog first: a caller must not be
     * able to spend quota probing arbitrary upstream config names, and a row the
     * region does not know is reported as skipped rather than silently dropped.
     *
     * The probe goes through `upstream` — the same bridge real chats use — so
     * wire resolution, function stamping and error translation all match what
     * the user gets when they actually send a message.
     */
    probeModels: async (ids: readonly string[]) => {
      const known = new Set<string>()
      for (const model of [...catalog.current(), ...displayModels(current(), region)]) {
        known.add(model.id.trim().toLowerCase())
        known.add(model.name.trim().toLowerCase())
      }
      const testable: string[] = []
      const skipped: string[] = []
      for (const id of ids) {
        if (known.has(id.trim().toLowerCase())) testable.push(id)
        else skipped.push(id)
      }
      const results = await probeModelsSequentially(
        // Probe through the region's primary pool: a test call must spend the
        // pool that region-wide diagnostics are understood to spend.
        (body, signal) => primary.upstream.chatStream(body, signal),
        testable,
      )
      return skipped.length === 0 ? { results } : { results, skipped }
    },
    invalidateAdapter: () => {},
      rawDiagnostic: () => rawDiagnostic(),
      // Exposed so the pool can build a bridge for an account that is NOT the
      // selected one: without it a batch probe would resolve display ids through
      // a resolver of its own making and could probe a different config_name
      // than a real chat.
      wireResolver,
      identity,
      routeOf: provider => routeOfTraeProvider(provider) ?? 'solo',
    }
  }
  /**
   * Mirror each region's Trae login into the plugin's OWN copy as soon as the
   * plugin loads.
   *
   * `accounts()` performs the mirror, so a card read creates the copy — but only
   * for the tab the user actually opens. Signing in to Trae and never opening
   * the panel would leave the copy missing until the next visit, which reads as
   * "the plugin never made a copy". This fire-and-forget pass makes the copies
   * exist from start-up. Failures are swallowed on purpose: the next card read
   * retries, and a read-only file system must not break the plugin load.
   */
  for (const panel of TRAE_PANELS) void stacks[panel].store.accounts().catch(() => undefined)

  /** This panel's saved pool preferences, unwrapped and defaulted to OFF. */
  const poolPreferencesOf = (panel: TraePanel): TraePoolPreferences =>
    unwrapVolatileDeep(regionStateOf(current(), panel).pool) ?? {}

  /**
   * Project one account's card credits onto the pool's ranking shape.
   *
   * The pool's `total` is the figure a request can SPEND, which on Trae is the
   * General bucket alone (SOLO chat never drains Work). The card's `total` is the
   * wider `available` figure, so it is deliberately NOT reused here: ranking by it
   * would put an account with a large Work balance and no General credit in front
   * of one that can actually serve. `undefined` (the read failed) stays undefined
   * so `rankPool` treats it as zero rather than as full.
   */
  /**
   * Credit totals the pool ranks on, cached per account.
   *
   * The CHAT path must not spend an upstream round-trip per candidate just to
   * decide who bills: {@link poolMembersOf} reads every balance, which is right
   * for the card (one read per poll) and far too slow per request. So the card's
   * poll warms this cache and the router only reads it.
   *
   * A cold cache means "unknown", not "no credit": `rankPool` orders a missing
   * figure as zero and then falls back to token freshness, so a cold start still
   * picks a member — the user chose the roster — instead of refusing to bill.
   */
  const poolCreditCache: Record<TraePanel, Map<string, TraePoolCredits>> = {
    cn: new Map(),
    enterprise: new Map(),
    ai: new Map(),
  }

  /**
   * Today's check-in state per account, measured by the LAST full read.
   *
   * Issue #77: the check-in column used to be an upstream call per account with
   * no memory at all, so every open of the card paid for every member twice (the
   * pool's own membership pass plus one `checkinStatus()` each). The first-paint
   * document may not wait for any of that, and re-measuring what was measured
   * minutes ago buys nothing: a check-in happens at most once per device per day.
   *
   * Entries older than {@link CHECKIN_CACHE_MS} are treated as absent rather than
   * as stale truth, so a document never claims "already checked in" off yesterday's
   * measurement. A cold cache means "not read", which the card renders as unknown.
   */
  const checkinStateCache: Record<TraePanel, Record<string, { state: TraePoolCheckinState; atMs: number }>> = {
    cn: {},
    enterprise: {},
    ai: {},
  }

  const poolCreditsOfAccount = async (panel: TraePanel, accountId: string): Promise<TraePoolCredits | undefined> => {
    const credits = await stacks[panel].creditsOfAccount(accountId)
    if (credits === undefined) return undefined
    const within3d = credits.expiry?.within3d
    const projected: TraePoolCredits = {
      // The SPENDABLE figure, not the wider `available`: SOLO chat only drains the
      // General bucket, so ranking by the total would put an account with a large
      // Work balance and no General credit in front of one that can serve.
      total: credits.generalAvailable,
      generalAvailable: credits.generalAvailable,
      workAvailable: credits.workAvailable,
      expiringSoon: within3d?.total ?? 0,
      ...within3d?.earliestExpiresAtMs === undefined ? {} : { nearestExpiryMs: within3d.earliestExpiresAtMs },
    }
    // Every successful read is also the router's copy of this balance.
    poolCreditCache[panel].set(accountId, projected)
    return projected
  }

  /**
   * Assemble one pool member per LOCAL account, in the store's order.
   *
   * "Member" means the account still has a sign-in this machine can use: a saved
   * id whose desktop credentials vanished is a ghost, and a ghost cannot be tested
   * or checked in, so listing it as a member would enable a batch over nothing.
   * The saved list is intersected separately (see
   * {@link TraePoolDeps.effectiveMemberAccountIds}) — here the store is the source.
   *
   * Balance reads are settled independently: one account whose credit read fails
   * must not take the whole pool document down, and it ranks as zero rather than
   * disappearing.
   */
  const poolMembersOf = async (panel: TraePanel): Promise<readonly TraePoolMember[]> => {
    const probes = await readTraePoolProbes(poolKeyOfPanel(panel))
    const choices = await stacks[panel].store.accounts()
    const members = await Promise.all(choices.map(async choice => {
      const credits = await poolCreditsOfAccount(panel, choice.id).catch((): undefined => undefined)
      return {
        account: { id: choice.id, accountName: choice.accountName },
        ...credits === undefined ? {} : { credits },
        ...probes[choice.id] === undefined ? {} : { probe: probes[choice.id] },
        ...choice.tokenExpiresAtMs === undefined ? {} : { tokenExpiresAtMs: choice.tokenExpiresAtMs },
      } satisfies TraePoolMember
    }))
    return members
  }

  /**
   * The catalog a pool test resolves its target model against.
   *
   * The LAST discovery wins, and the saved/live catalog is the fallback: a test
   * clicked before the first discovery lands must still find the free models the
   * region already knows, and one clicked after it must not be judged against a
   * roster the upstream has since replaced.
   */
  const poolCatalogOf = (panel: TraePanel): readonly TraeModelInfo[] =>
    stacks[panel].lastDiscovery.length > 0 ? stacks[panel].lastDiscovery : stacks[panel].catalog.current()

  /** Id → display name for one panel, for the rows a batch reports. */
  const poolMemberNamesOf = async (panel: TraePanel): Promise<Record<string, string>> => {
    const names: Record<string, string> = {}
    for (const member of await poolMembersOf(panel)) names[member.account.id] = member.account.accountName
    return names
  }

  /**
   * The accounts a batch runs on: the SAVED member list, narrowed to what this
   * machine can still reach, in the user's own order.
   *
   * Order is the user's, not the ranking's, on purpose: a batch result table that
   * reorders itself between presses is hard to read row by row, and the ranking
   * is already shown by the table above it.
   */
  const poolTargetsOf = async (panel: TraePanel): Promise<{ accountId: string; accountName: string }[]> => {
    const saved = poolPreferencesOf(panel).memberAccountIds ?? []
    const names = await poolMemberNamesOf(panel)
    return effectiveMembersOf(saved, new Set(Object.keys(names)))
      .map(accountId => ({ accountId, accountName: names[accountId] ?? '' }))
  }

  /**
   * Today's check-in state from the cells already measured — the first-paint read
   * (issue #77).
   *
   * Synchronous and local by contract: it never starts a request, so the card's
   * first paint cannot be held by the upstream. Only FRESH cells are returned; an
   * expired entry is dropped rather than reported, because "checked in" from four
   * hours ago is a claim about a day that may already be over.
   */
  function cachedCheckinStateOf(panel: TraePanel): Record<string, TraePoolCheckinState> {
    const nowMs = Date.now()
    const state: Record<string, TraePoolCheckinState> = {}
    for (const [accountId, entry] of Object.entries(checkinStateCache[panel])) {
      if (nowMs - entry.atMs >= CHECKIN_CACHE_MS) continue
      state[accountId] = entry.state
    }
    return state
  }

  /**
   * Pool members from LOCAL state only: the store's logins, the saved probes and
   * the cached credit totals. No upstream call, so it is safe on the request
   * path (see {@link poolCreditCache} for why the cache exists).
   */
  async function localPoolMembers(panel: TraePanel): Promise<readonly TraePoolMember[]> {
    const probes = await readTraePoolProbes(poolKeyOfPanel(panel)).catch((): Record<string, TraePoolProbe> => ({}))
    const choices = await stacks[panel].store.accounts().catch(() => [])
    const cache = poolCreditCache[panel]
    return choices.map(choice => {
      const credits = cache.get(choice.id)
      return {
        account: { id: choice.id, accountName: choice.accountName },
        ...credits === undefined ? {} : { credits },
        ...probes[choice.id] === undefined ? {} : { probe: probes[choice.id] },
        ...choice.tokenExpiresAtMs === undefined ? {} : { tokenExpiresAtMs: choice.tokenExpiresAtMs },
      } satisfies TraePoolMember
    })
  }

  /**
   * The members that may actually be billed: the user's SAVED opt-in list
   * intersected with what this machine can still reach, minus the accounts that
   * already failed this request (`billableMembers` is the one definition of that
   * rule, shared with the batch paths).
   */
  async function poolBillableMembers(
    panel: TraePanel,
    tried: readonly string[] = [],
  ): Promise<readonly TraePoolMember[]> {
    const members = await localPoolMembers(panel)
    const saved = poolPreferencesOf(panel).memberAccountIds ?? []
    return billableMembers(members, saved, tried)
  }

  /**
   * Point the NEXT request at the best pooled account, or back at the bound one
   * when the pool is off (issue #44).
   *
   * Returns the account it chose. Both the chat path and the card's usage read go
   * through here, so "currently serving" on screen and the next real request
   * cannot disagree — one rule, one answer.
   *
   * When EVERY member is excluded the rotation is cleared rather than pointed at
   * an excluded account: the bound account then serves, which is the user's own
   * explicit choice and the only account a refusal would not have served anyway.
   * The card reports the exclusion reasons, so this is never silent.
   */
  async function applyPoolSelection(panel: TraePanel): Promise<string | undefined> {
    const store = stacks[panel].store
    if (poolPreferencesOf(panel).enabled !== true) {
      // Switching the pool off must restore the user's own choice immediately,
      // with no rebind: clearing the override IS the undo.
      store.setRotatedAccount(undefined)
      return undefined
    }
    try {
      const winner = pickAccount(await poolBillableMembers(panel), Date.now())
      store.setRotatedAccount(winner?.id)
      return winner?.id
    } catch {
      // A pool that cannot rank must not move billing: leave the binding in
      // charge rather than guessing at an account.
      store.setRotatedAccount(undefined)
      return undefined
    }
  }

  /**
   * The client for the next account worth trying, bound to THAT account.
   *
   * Built per attempt from the account's own stored credential, so a failover
   * never rebinds the store and never disturbs a request that is already billing
   * the chosen account (the same rule per-account probes follow, issue #25). The
   * bridge is the same one a normal turn uses, so display ids still resolve to
   * their wire names.
   */
  async function failoverClientFor(
    panel: TraePanel,
    tried: readonly string[],
  ): Promise<{ accountId: string; client: TraeUpstreamClient } | undefined> {
    const next = pickAccount(await poolBillableMembers(panel, tried), Date.now())
    if (next === undefined) return undefined
    const stack = stacks[panel]
    const accountId = next.id
    const client = new TraeSoloUpstreamClient({
      credential: async () => {
        const credential = await stack.store.resolveCredentialOf(accountId)
        if (credential === undefined) throw new Error(`no stored credential for account ${accountId}`)
        return credential
      },
      identity: () => stack.identity(),
      route: stack.routeOf(providerOfPanel(panel)),
      log: (message, detail) => ctx.logger.warn(message, detail),
    })
    return { accountId, client: new TraeSoloBridge(client, stack.catalog, stack.wireResolver) }
  }

  /**
   * Persist what a real request taught us about an account (issue #44).
   *
   * Written as a `live-request` probe so the card can tell a measurement taken by
   * a batch from one taken by traffic, and so the ranking excludes the account on
   * its next turn instead of walking back into the same limit.
   */
  async function recordPoolFailure(
    panel: TraePanel,
    accountId: string,
    kind: TraeUpstreamErrorKind,
    message: string,
  ): Promise<void> {
    const outcome = POOL_OUTCOME_BY_KIND[kind]
    if (outcome === undefined) return
    await writeTraePoolProbes(poolKeyOfPanel(panel), {
      [accountId]: { outcome, atMs: Date.now(), source: 'live-request', message: `${kind}: ${message}` },
    }).catch(() => {})
  }

  /**
   * Why nothing else could serve, as one clause for the error the caller sees.
   *
   * `undefined` when the pool is off (the plain upstream error is the whole
   * story) or when there was in fact a candidate left — the shim asked because it
   * ran out of attempts, not out of accounts.
   */
  async function poolShortfallOf(panel: TraePanel, tried: readonly string[]): Promise<string | undefined> {
    if (poolPreferencesOf(panel).enabled !== true) return undefined
    let members: readonly TraePoolMember[]
    let remaining: readonly TraePoolMember[]
    try {
      members = await poolBillableMembers(panel)
      if (members.length === 0) return 'the account pool is enabled but has no usable member'
      remaining = await poolBillableMembers(panel, tried)
    } catch {
      return undefined
    }
    // Two different failures, two different sentences: "everything was tried" is
    // not the same thing as "the ones left are unusable", and the user can only
    // act on the second one (by fixing a sign-in or waiting out a limit).
    if (remaining.length === 0) return `all ${members.length} pooled account(s) were tried for this request`
    const ranked = rankPool(remaining, Date.now())
    const reasons = [...new Set(ranked.flatMap(entry => entry.excludedBy === undefined ? [] : [entry.excludedBy]))]
    return reasons.length === 0 ? undefined : `every remaining pooled account is excluded (${reasons.join(', ')})`
  }

  /**
   * The shim's view of one panel's pool.
   *
   * Declared as a hoisted function because the shim's route table is built ABOVE
   * this point in `apply`; only the bodies run later, on a real request.
   */
  function poolShimHooksOf(panel: TraePanel): TraeShimPool {
    return {
      prepare: () => applyPoolSelection(panel),
      next: tried => failoverClientFor(panel, tried),
      failed: (accountId, kind, message) => recordPoolFailure(panel, accountId, kind, message),
      shortfall: tried => poolShortfallOf(panel, tried),
    }
  }

  /**
   * The pool's dependency bag for ONE panel.
   *
   * Every member re-reads the store on each call rather than capturing a list:
   * a batch runs for minutes, and a sign-in the user performed half-way through
   * must be visible to the rows it has not reached yet.
   *
   * The bag is built per REQUEST, so it captures the panel and never has to be
   * told which tab asked.
   */
  const poolDepsOf = (panel: TraePanel): TraePoolDeps => {
    // One `chatStream` bridge PER credential for the life of this bag: a test
    // batch must address the account it is measuring, never whichever account is
    // currently selected (issue #25's rule — looking at a neighbour is not a
    // switch, and a test must not move billing).
    const bridges = new Map<string, (body: string, signal?: AbortSignal) => Promise<TraeChatResult>>()
    const chatBridgeFor = (accountId: string): ((body: string, signal?: AbortSignal) => Promise<TraeChatResult>) => {
      const existing = bridges.get(accountId)
      if (existing !== undefined) return existing
      const stack = stacks[panel]
      const client = new TraeSoloUpstreamClient({
        credential: async () => {
          const credential = await stack.store.resolveCredentialOf(accountId)
          if (credential === undefined) throw new Error(`no stored credential for account ${accountId}`)
          return credential
        },
        identity: () => stack.identity(),
        route: stack.routeOf(providerOfPanel(panel)),
        log: (message, detail) => ctx.logger.warn(message, detail),
      })
      // The wire resolver is the stack's live one, so a display id resolves to the
      // same config_name a real chat would use.
      const bridge = new TraeSoloBridge(client, stack.catalog, stack.wireResolver)
      const chat = (body: string, signal?: AbortSignal): Promise<TraeChatResult> => bridge.chatStream(body, signal)
      bridges.set(accountId, chat)
      return chat
    }
    const probeDeps = (): TraePoolRunnerDeps => ({
      credentialFor: accountId => stacks[panel].store.resolveCredentialOf(accountId),
      checkinStatusOf: async credential => {
        const client = new TraeUsageClient({ credential: async () => credential, deviceId: async () => (await stacks[panel].identity()).deviceId })
        return client.checkinStatus()
      },
      claimCheckinOf: async credential => {
        const client = new TraeUsageClient({ credential: async () => credential, deviceId: async () => (await stacks[panel].identity()).deviceId })
        return client.claimCheckin()
      },
      chatFor: credential => chatBridgeFor(traeAccountId(credential)),
    })
    /** How much text a probe should carry for this panel (0 = the minimal probe). */
    const probeInputTokensOf = (stored: TraePanel): number => {
      const tokens = poolPreferencesOf(stored).probeInputTokens
      return typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0 ? Math.min(tokens, MAX_PROBE_INPUT_TOKENS) : 0
    }
    /** One account's row, through the same bridge and probe the batch uses. */
    const testWith = async (target: { accountId: string; accountName: string }, modelId: string, probeInputTokens: number): Promise<TraePoolTestRow> => {
      await warmWireMap(panel)
      const [row] = await testAllAccounts([target], modelId, (chatFor, credential, id) => {
        if (credential === undefined) {
          return Promise.resolve({ id, verdict: 'auth' as const, detail: 'no stored credential for this account' })
        }
        return probeOneModel(chatFor(credential), id, undefined, probeInputTokens)
      }, probeDeps())
      return row as TraePoolTestRow
    }
    return {
      preferences: stored => poolPreferencesOf(stored),
      members: stored => poolMembersOf(stored),
      effectiveMemberAccountIds: async stored => {
        const saved = poolPreferencesOf(stored).memberAccountIds ?? []
        return effectiveMembersOf(saved, new Set((await poolMembersOf(stored)).map(member => member.account.id)))
      },
      memberNames: async stored => {
        const names: Record<string, string> = {}
        for (const member of await poolMembersOf(stored)) names[member.account.id] = member.account.accountName
        return names
      },
      otherAccounts: async stored => (await poolMembersOf(stored)).map(member => member.account),
      currentAccountId: async stored => {
        const configured = configuredAccountsOf(current())[stored]
        return isTraeAccountId(configured) ? configured : undefined
      },
      catalog: stored => poolCatalogOf(stored),
      checkinSupported: stored => regionOfPanel(stored) === 'cn',
      checkin: async stored => checkinAllAccounts(await poolTargetsOf(stored), probeDeps()),
      checkinState: async stored => {
        const state = cachedCheckinStateOf(stored)
        const nowMs = Date.now()
        for (const target of await poolTargetsOf(stored)) {
          const credential = await stacks[stored].store.resolveCredentialOf(target.accountId)
          if (credential === undefined) continue
          const client = new TraeUsageClient({ credential: async () => credential, deviceId: async () => (await stacks[stored].identity()).deviceId })
          try {
            const status = await client.checkinStatus()
            const measured: TraePoolCheckinState = { checkedIn: status.checkedIn, deviceCheckedIn: status.didCheckedIn, enabled: status.enabled }
            state[target.accountId] = measured
            // Shared with the first-paint read below: a measurement is worth the
            // same whether somebody watched it happen or found it here.
            checkinStateCache[stored][target.accountId] = { state: measured, atMs: nowMs }
          } catch {
            // An unreadable row simply carries no check-in figure.
          }
        }
        return state
      },
      cachedCheckinState: stored => cachedCheckinStateOf(stored),
      test: async (stored, modelId, onRow) => {
        await warmWireMap(stored)
        const probeInputTokens = probeInputTokensOf(stored)
        const rows = await testAllAccounts(
          await poolTargetsOf(stored),
          modelId,
          (chatFor, credential, id) => {
            if (credential === undefined) {
              return Promise.resolve({ id, verdict: 'auth' as const, detail: 'no stored credential for this account' })
            }
            return probeOneModel(chatFor(credential), id, undefined, probeInputTokens)
          },
          probeDeps(),
          onRow,
        )
        // Persisted AFTER the batch (one write, one timestamp for the run) so the
        // card's "tested N minutes ago" describes the batch, not its first row.
        await writeTraePoolProbes(poolKeyOfPanel(stored), probeUpdatesOf(rows))
        return rows
      },
      testOne: async (stored, accountId) => {
        const model = resolveTargetModel(poolCatalogOf(stored), poolPreferencesOf(stored).targetModelId)
        if (model.modelId === undefined) return undefined
        const names = await poolMemberNamesOf(stored)
        const row = await testWith({ accountId, accountName: names[accountId] ?? '' }, model.modelId, probeInputTokensOf(stored))
        await writeTraePoolProbes(poolKeyOfPanel(stored), probeUpdatesOf([row]))
        return row
      },
      removeOne: async (stored, accountId) => {
        // The MEASUREMENT is only half of a removal: membership lives in settings,
        // which has its own single writer. Forgetting the probe here is what stops
        // a re-added account from inheriting an old exclusion.
        await dropTraePoolProbe(poolKeyOfPanel(stored), accountId)
        return true
      },
    }
  }

  // Same-origin routes backing the card. Each request names the region whose
  // tab it belongs to; the region-scoped accessors below then read (and the
  // save writes back into) that region's own slot.
  ctx.inject(['webServer'], (webCtx) => registerTraeUsageRoute(webCtx, {
    store: panel => stacks[panel].store,
    client: panel => stacks[panel].usageClient,
    displayModels: panel => displayModels(current(), panel),
    enabledModelIds: panel => regionStateOf(current(), panel).enabledModelIds ?? [],
    regionEnabled: panel => regionEnabled(current(), panel),
    discoverModels: (panel, signal) => stacks[panel].discoverModels(signal),
    probeModels: async (panel, ids) => {
      await warmWireMap(panel)
      return stacks[panel].probeModels(ids)
    },
    rawDiagnostic: panel => stacks[panel].rawDiagnostic(),
    // CN credit balance of an account that is NOT the bound one, read through a
    // throwaway client so the store's selection (and every in-flight chat
    // request using it) is left alone (issue #25).
    creditsOfAccount: (panel, accountId) => stacks[panel].creditsOfAccount(accountId),
    // Delete ONE account's plugin-owned credential copy (never Trae's own login);
    // the store reports whether the account is still signed in to the app, which
    // the card echoes as a sign-out hint rather than a failed deletion.
    deleteAccountOf: (panel, accountId) => stacks[panel].store.deleteAccount(accountId),
    // Name the file that holds this panel's copies, so "the plugin keeps a real
    // copy" is verifiable instead of a claim in a sentence.
    copiesOf: async panel => ({
      path: stacks[panel].store.ownAuthPath(),
      count: (await stacks[panel].store.accounts()).length,
    }),
    // Per-account status for one row of the card's account table (check-in /
    // balances / subscription), read without disturbing which account is bound.
    accountStateOf: (panel, accountId) => stacks[panel].accountStateOf(accountId),
    // Claim today's check-in FOR one named account, leaving the binding alone.
    claimCheckinOf: (panel, accountId) => stacks[panel].claimCheckinOf(accountId),
    // The account pool (issue #44). Built per request so the bag always describes
    // the panel that asked, and so a batch sees sign-ins the user added while an
    // earlier batch was still running.
    pool: {
      preferences: panel => poolPreferencesOf(panel),
      members: panel => poolMembersOf(panel),
      // Issue #77: the first-paint source. Same roster, without the per-account
      // balance read — a member whose credits were never measured simply carries
      // none, which the card renders as `—` and the next full document corrects.
      localMembers: panel => localPoolMembers(panel),
      // The fast pool's name map, from the same local membership (no balance read).
      localMemberNames: async panel => {
        const names: Record<string, string> = {}
        for (const member of await localPoolMembers(panel)) names[member.account.id] = member.account.accountName
        return names
      },
      effectiveMemberAccountIds: async panel => {
        const saved = poolPreferencesOf(panel).memberAccountIds ?? []
        return effectiveMembersOf(saved, new Set((await poolMembersOf(panel)).map(member => member.account.id)))
      },
      memberNames: panel => poolMemberNamesOf(panel),
      otherAccounts: async panel => (await poolMembersOf(panel)).map(member => member.account),
      currentAccountId: async panel => {
        // The account that would bill the NEXT request, not the saved binding:
        // with the pool on, those differ, and the card's "serving now" line must
        // match what the router actually does.
        await applyPoolSelection(panel).catch(() => undefined)
        const credential = await stacks[panel].store.current().catch(() => undefined)
        return credential === undefined ? undefined : traeAccountId(credential)
      },
      catalog: panel => poolCatalogOf(panel),
      checkinSupported: panel => regionOfPanel(panel) === 'cn',
      checkin: panel => poolDepsOf(panel).checkin?.(panel) ?? Promise.resolve([]),
      checkinState: panel => poolDepsOf(panel).checkinState?.(panel) ?? Promise.resolve({}),
      // Issue #77: the first paint reads the measurement cache the line above
      // fills, instead of paying one upstream read per account.
      cachedCheckinState: panel => cachedCheckinStateOf(panel),
      test: (panel, modelId, onRow) => poolDepsOf(panel).test?.(panel, modelId, onRow) ?? Promise.resolve([]),
      testOne: (panel, accountId) => poolDepsOf(panel).testOne?.(panel, accountId) ?? Promise.resolve(undefined),
      removeOne: (panel, accountId) => poolDepsOf(panel).removeOne?.(panel, accountId) ?? Promise.resolve(false),
    },
  }))

  /**
   * Live registration handles per region, filled once the shim is listening.
   * A disabled region holds ZERO routes while staying registered: DSH allows
   * `replace([])` for exactly this case ("a settings section that emptied holds
   * zero routes while staying registered"), which is what makes the on/off
   * switch reversible without a restart. Withdrawing the adapter route is what
   * actually removes the region's models from DSH's model picker — hiding the
   * card tab alone would leave every model selectable.
   */
  const registration: Record<TraePanel, {
    /** The handle publishing this panel's provider id. */
    adapters: { provider: string; handle: AdapterRegistrationHandle }[]
    directory?: DirectoryRegistrationHandle
  }> = { cn: { adapters: [] }, enterprise: { adapters: [] }, ai: { adapters: [] } }

  /** Release every live registration this apply() created. */
  const disposeRegistration = (): void => {
    for (const panel of TRAE_PANELS) {
      for (const entry of registration[panel].adapters) entry.handle()
      registration[panel].adapters.length = 0
    }
    registration.cn.directory?.()
    delete registration.cn.directory
  }

  /**
   * Publish each region's on/off state to the harness (issue #11). Both swaps
   * are single synchronous sections, so no request can observe a half-applied
   * state, and `replace` announces itself through `llm/adapters-updated`, which
   * is what makes third-party consumers (e.g. a vision router deriving
   * `<provider>-vision` variants) drop the region too. No-op until the shim has
   * registered; `applySelection` runs again on every card write, so a toggle
   * lands immediately.
   */
  const syncRegionRegistration = (value: Config): void => {
    for (const panel of TRAE_PANELS) {
      // Each panel keeps its OWN registration, so a per-panel switch replaces
      // exactly that panel: withdrawing the adapter route is what actually
      // removes its models from DSH's picker.
      const enabled = regionEnabled(value, panel)
      for (const entry of registration[panel].adapters) entry.handle.replace(enabled ? [entry.provider] : [])
    }
    // The directory is ONE registration holding every panel's entry: `replace`
    // sets the complete entry set, so it is called once with the full enabled
    // list. Replacing per panel would make the last one win and silently drop
    // the others — a disabled panel would take its enabled siblings with it.
    registration.cn.directory?.replace(TRAE_PANELS
      .filter(panel => regionEnabled(value, panel))
      .map(panel => ({
        provider: providerOfPanel(panel),
        displayName: displayNameOfTraeProvider(providerOfPanel(panel)),
        settingsNs,
        settingsPath: [],
        declared: false,
      })))
  }

  /** Push the current config into every panel's store selection and catalog. */
  const applySelection = (value: Config): void => {
    for (const panel of TRAE_PANELS) {
      const stack = stacks[panel]
      // Unwrap the volatile fields here too: `current()` hands them over as
      // live references, so passing one through would make the storage path an
      // object and the edition a truthy non-enum.
      stack.store.setSource(
        unwrapVolatile(value.authFile),
        unwrapVolatile(value.edition) ?? 'auto',
        effectiveAccountFor(panel, value),
      )
      /**
       * Re-merge the wire mapping the last discovery taught us.
       *
       * configuredModels rebuilds from the SAVED rows, and rows saved before
       * wireConfigName existed carry wireFunction alone. Every settings write
       * goes through here (card writes, follow-app-login, the initial seed),
       * so without this each write would strip the case mapping until the next
       * discovery -- the exact window that turns deepseek-v4.1-flash into a
       * 4001, because the gateway is case-sensitive and the lowercase
       * directory id is the one spelling it refuses.
       */
      const known = new Map<string, TraeModelInfo>()
      for (const model of stack.lastDiscovery) {
        known.set(model.id, model)
        known.set(model.id.trim().toLowerCase(), model)
        if (model.name.trim() !== '') known.set(model.name.trim().toLowerCase(), model)
      }
      const rows = configuredModels(value, panel).map(model => {
        const match = known.get(model.id)
          ?? known.get(model.id.trim().toLowerCase())
          ?? (model.name.trim() !== '' ? known.get(model.name.trim().toLowerCase()) : undefined)
        if (match === undefined) return model
        const wireConfigName = model.wireConfigName ?? match.wireConfigName
        const wireFunction = model.wireFunction ?? match.wireFunction
        if (wireConfigName === model.wireConfigName && wireFunction === model.wireFunction) return model
        return { ...model, ...wireConfigName === undefined ? {} : { wireConfigName }, ...wireFunction === undefined ? {} : { wireFunction } }
      })
      stack.catalog.set(rows)
      stack.invalidateAdapter()
    }
    syncRegionRegistration(value)
  }

  // Initial wiring: selections and per-region catalogs from the saved state.
  applySelection(config)

  // Attribute the legacy single-account selection to its own region once the
  // local scan can tell which one that is, then re-apply. Until this resolves
  // (or when no legacy field exists) both regions simply run their defaults.
  void (async () => {
    const id = current().accountId
    if (id === undefined) return
    try {
      for (const region of REGION_KEYS) {
        const accounts = await stacks[region].store.accounts()
        if (accounts.some(account => account.id === id)) {
          legacyAccountRegion = region
          applySelection(current())
          return
        }
      }
      // The saved account vanished (Trae replaced its sign-in): no attribution,
      // both regions keep their defaults, and the card lets the user re-select.
    } catch {
      // Scan failure: keep defaults; the next card-driven scan converges.
    }
  })()
  // Settings registration (0.1.7+ only).
  //
  // `SettingsForms` dropped `installSection` entirely and exposes
  // `configure({auto}, owner)`; calling the removed method unconditionally made
  // `apply()` throw on 0.1.7 (`ctx.settings.installSection is not a function`)
  // and took down the WHOLE plugin. Since 2.3.0 the plugin supports DSH
  // 0.1.7-rc.1 and up only, so `configure` is the sole path and is called
  // unconditionally — the pre-0.1.7 `SettingsProvider.installSection` branch
  // is gone with the line it served.
  //
  // The call goes through a narrow local type rather than a blanket `any`: the
  // installed typings describe the settings service surface, and the local
  // shape names the pieces this plugin touches.
  interface SettingsShapes {
    configure: (presentation: { auto?: boolean }, owner?: unknown) => () => void
  }

  // `inject` rather than a direct read: `settings` is an optional service, and
  // the callback runs once it is actually present. `configure` returns a
  // disposer that must be registered with the calling plugin's effects, or the
  // presentation policy leaks past disposal (the first-party plugins do the
  // same: `child.effect(() => child.settings.configure({ auto: false }, …))`).
  ctx.inject(['settings'], settingsCtx => {
    const settings = settingsCtx.settings as unknown as SettingsShapes
    ctx.effect(() => settings.configure({ auto: true }, ctx.fiber))
  })

  // 0.1.7 hands volatile values back as live references and announces each
  // write on this event, so the selections are re-read after one — the live
  // references resolve to the updated document, which is how `current()` picks
  // a card write up without a `setSource` hook (there is none on 0.1.7).
  ;(ctx as unknown as { on(name: string, listener: () => void): unknown })
    .on('loader/volatile-update', () => {
      applySelection(current())
    })

  let stopped = false
  ctx.effect(() => () => {
    stopped = true
    for (const panel of TRAE_PANELS) void stacks[panel].shim.close()
  })

  void Promise.all(TRAE_PANELS.map(panel => stacks[panel].shim.ready)).then(async () => {
    if (stopped) return
    try {
      // Mixed-generation installs are the silent kind of broken (issue #27):
      // the plugin's own pi-ai copy decides the context shape it can consume,
      // and it is NOT necessarily the host's copy. Print what was resolved so a
      // future mismatch is visible in the log instead of only as a crash.
      const piAi = piAiRuntimeInfo()
      ctx.logger.info(
        `dsh-connect-trae: pi-ai ${piAi.version ?? 'unknown'} (${piAi.generation} generation)`
        + `${piAi.inspected ? '' : ' — not resolved locally, the host supplies it'}`,
      )
      for (const panel of TRAE_PANELS) {
        const stack = stacks[panel]
        const provider = providerOfPanel(panel)
        const entry = stack.routeClients[provider]
        if (entry === undefined) continue
        const trae = createTraeAdapter({
          shim: stack.shim,
          catalog: stack.catalog,
          provider,
          displayName: displayNameOfTraeProvider(provider),
          secret: entry.secret,
          resolveAttachments: () => ctx.get('attachments'),
        })
        stack.invalidateAdapter = () => { trae.invalidate() }
        // Always register the route first: an empty INITIAL registration is
        // invalid (`INVALID_ADAPTER`), while `replace([])` on a live one is
        // explicitly legal. `syncRegionRegistration` below then withdraws the
        // route for a panel the user has switched off, in the same synchronous
        // section, so nothing observes the transient route.
        registration[panel].adapters.push({ provider, handle: ctx.llm.registerAdapter([provider], trae.adapter) })
      }
      ctx.llm.registerModelDiscovery(settingsNs, async (request, signal) => {
        const panel = panelOfProvider(request.provider ?? '')
        if (panel === undefined) return []
        // A switched-off panel advertises nothing: its route is withdrawn, so
        // this is defence in depth against a stale model-picker refresh.
        if (!regionEnabled(current(), panel)) return []
        // Discovery must advertise the same image capability as the live
        // adapter catalog. The upstream flag is deliberately ignored; only the
        // user's explicit `imageModelIds` selection is authoritative.
        //
        // DSH 0.1.2 moved discovery cancellation from `request.signal` onto
        // the callback's second argument; 0.1.1 hosts still pass it on the
        // request object, so read both.
        const cancellation = signal ?? (request as { signal?: AbortSignal }).signal
        const next = applyImageSelection(
          await stacks[panel].discoverModels(cancellation),
          imageSet(current(), panel),
        )
        // Same name the adapter publishes for this provider, rate included
        // only where it is actually billed (see traeModelDisplayName).
        const withRate = panel !== 'enterprise'
        return next.map(model => ({
          id: model.id,
          name: traeModelDisplayName(model, withRate),
          ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
          ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
          // Current dsh-llm discovery types do not yet declare this field, but
          // model-management consumers already understand it. Keep the value
          // aligned with the adapter catalog; DSH core may discard it today.
          inputModalities: traeInputModalities(model),
        }))
      })
      registration.cn.directory = ctx.llm.registerConfigurableProviders(TRAE_PANELS.map(panel => ({
        provider: providerOfPanel(panel),
        displayName: displayNameOfTraeProvider(providerOfPanel(panel)),
        settingsNs,
        settingsPath: [],
        declared: false,
      })))
      // Converge both regions on the saved state: a region switched off while
      // the harness was down is withdrawn here, before the startup seed below.
      syncRegionRegistration(current())
    } finally {
      if (
        registration.cn.adapters.length === 0
        || registration.ai.adapters.length === 0
        || registration.cn.directory === undefined
      ) {
        // Registration threw; release whichever half landed. A partially
        // registered plugin must not leave a route behind with no owner.
        disposeRegistration()
      }
    }
    try {
      ctx.effect(() => () => {
        disposeRegistration()
      })
    } catch {
      disposeRegistration()
    }

    // Startup seed per region (workbuddy semantics): resolve the wire-id map
    // once at startup before serving requests, so the chat bridge can
    // translate display ids to real config_names without the user ever opening
    // the model card or re-saving the directory. The runtime catalog derives
    // from the LIVE directory of that region's selected account, so DSH serves
    // what the upstream actually answers today — an account on a
    // never-configured region gets its real roster (with wire ids) immediately,
    // without pressing "refresh" + "save" first. `lastCatalog` is deliberately
    // NOT seeded here: it belongs to the user's explicit save. A discovery
    // failure (no credentials, upstream down) degrades to the configured
    // state — the saved directory, else the region's fallback.
    //
    // A switched-off region is skipped entirely: its route is withdrawn, so the
    // request would be pure waste — and skipping it is also what keeps a
    // disabled region from contributing an error to the log on every start.
    for (const panel of TRAE_PANELS) {
      if (!regionEnabled(current(), panel)) continue
      void (async () => {
        const stack = stacks[panel]
        try {
          const models = await stack.discoverModels()
          if (stopped) return
          // Reconcile the CATALOG, not just the wire map: `wireConfigName` is
          // what the bridge needs to spell a case-sensitive `config_name`, and
          // a saved row that predates it carries `wireFunction` alone. Writing
          // the discovered rows straight in is what makes the very first turn
          // after a restart resolve correctly, with no refresh-and-save.
          stack.catalog.set(derive(current(), models, panel))
        } catch (error: unknown) {
          ctx.logger.warn(`dsh-connect-trae: live ${panel} model directory unavailable; serving the configured catalog`, error)
          stack.catalog.set(configuredModels(current(), panel))
        }
        stack.invalidateAdapter()
      })()
    }
  }).catch((error: unknown) => {
    ctx.logger.error('dsh-connect-trae: loopback shim failed; providers not registered', error)
  })
}
