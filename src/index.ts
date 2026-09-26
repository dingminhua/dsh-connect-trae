import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  createTraeAdapter,
  regionOfTraeProvider,
  TRAE_AI_PROVIDER,
  TRAE_PROVIDER,
  TRAE_PROVIDER_DISPLAY_NAMES,
  TRAE_PROVIDERS,
} from './adapter.ts'
import type { TraeAdapter } from './adapter.ts'
import { TraeCredentialStore } from './auth.ts'
import { applyImageSelection, deriveCatalog, discoveredCatalog, FALLBACK_TRAE_MODELS, fallbackModelsFor, mergeTraeModelSources, sanitizeCatalog, TraeCatalog, traeInputModalities, traeModelDisplayName, type TraeModelInfo } from './catalog.ts'
import { refreshTraeCredential, type TraeRefreshDevice } from './refresh.ts'
import { readTraeIdentity, resolveTraeIdentity } from './identity.ts'
import { traeStorageCandidates, type TraeEdition } from './paths.ts'
import { regionOfCredential, regionOfEdition, regionOfHost, regionOfUserRegion, REGION_GATEWAYS, type TraeRegion, type TraeRegionGateways } from './region.ts'
import { createTraeShim } from './shim.ts'
import type { TraeShim } from './shim.ts'
import { TraeSoloUpstreamClient } from './solo.ts'
import { TraeSoloBridge } from './solo-bridge.ts'
import type { TraeWireTarget } from './solo-bridge.ts'
import { TraeSoloRemoteCatalogClient } from './solo-remote.ts'
import { TraeRawChatUpstreamClient } from './raw-upstream.ts'
import { createTraeRawGateway } from './raw-gateway.ts'
import { resolveTraeRawRuntime } from './raw-resolver.ts'
import type { TraeRawDiagnostic } from './raw-diagnostic.ts'
import { TraeDelegatingUpstreamClient } from './delegating-upstream.ts'
import { TraeUsageClient } from './usage.ts'
import { registerTraeUsageRoute } from './web-status.ts'
import { unwrapVolatile } from './status-paths.ts'

export {
  createTraeAdapter,
  regionOfTraeProvider,
  TRAE_AI_PROVIDER,
  TRAE_PROVIDER,
  TRAE_PROVIDER_DISPLAY_NAMES,
  TRAE_PROVIDERS,
  TRAE_STREAM_IDLE_TIMEOUT_MS,
  type TraeAdapter,
} from './adapter.ts'
export {
  legacyTraeOwnAuthPath,
  normalizeTraeCredential,
  traeOwnAuthPath,
  TraeCredentialStore,
  type TraeCredential,
} from './auth.ts'
export {
  regionOfCredential,
  regionOfEdition,
  regionOfHost,
  regionOfUserRegion,
  REGION_GATEWAYS,
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
export { bridgeTraeSoloStream, TraeSoloBridge } from './solo-bridge.ts'
export { TraeSoloRemoteCatalogClient, TRAE_SOLO_REMOTE_BASE, type TraeSoloRemoteCatalogOptions } from './solo-remote.ts'
export { TraeDelegatingUpstreamClient } from './delegating-upstream.ts'
export { TRAE_PAY_BASE, TraeUsageClient, type TraeActivityRule, type TraeCheckinClaim, type TraeCheckinStatus, type TraeUsageOptions, type TraeUsagePack, type TraeUsageSnapshot, type TraeUsageSummary, type TraeUsageView } from './usage.ts'
export { registerTraeUsageRoute, traeWebUsage, type TraeUsageRouteOptions } from './web-status.ts'
export {
  regionOfTraeStatusUrl,
  regionEnabledOf,
  nextRegionEnabled,
  nextRegionSlots,
  TRAE_CHECKIN_PATH,
  TRAE_REGION_PARAM,
  TRAE_REGIONS,
  TRAE_USAGE_PATH,
  unwrapVolatile,
  unwrapVolatileDeep,
  withTraeRegion,
  type TraeWebActivity,
  type TraeWebCheckin,
  type TraeWebCheckinClaim,
  type TraeWebCredits,
  type TraeWebUsage,
} from './status-paths.ts'
export { createTraeShim, type TraeShim } from './shim.ts'
export { UnconfiguredTraeUpstreamClient, type TraeChatResult, type TraeUpstreamClient } from './upstream.ts'

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
  accounts?: Partial<Record<TraeRegion, string>>
  /**
   * Per-region model state, keyed `cn` | `ai`. The CN and international apps
   * expose different rosters, so each keeps its own directory and selection
   * and switching accounts never drops the other region's picks.
   */
  regions?: Partial<Record<TraeRegion, TraeRegionState>>
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
 * One region's saved state. A config written before the region split has only
 * the flat fields: those were always captured from the CN endpoint (the
 * plugin had no international support), so they are read as the CN state and
 * only when no explicit CN slot exists. The ai region never inherits them —
 * that inheritance is exactly the bug where a stale CN directory would be
 * intersected with the international catalog and silently drop the user's
 * picks (the same failure workbuddy fixed with its region split).
 */
export function regionStateOf(config: Config, region: TraeRegion): TraeRegionState {
  // Unwrap first: on DSH 0.1.7 a volatile-marked field arrives as a `{get(): T}`
  // live reference, so `config.regions?.[region]` would read `undefined` and
  // every region would silently fall back to its defaults ("settings written
  // but not read back").
  const regions = unwrapVolatile(config.regions)
  const stored = unwrapVolatile(regions?.[region])
  if (stored !== undefined) return stored
  if (region !== 'cn') return {}
  return {
    ...config.lastCatalog === undefined ? {} : { lastCatalog: config.lastCatalog },
    ...config.enabledModelIds === undefined ? {} : { enabledModelIds: config.enabledModelIds },
    ...config.imageModelIds === undefined ? {} : { imageModelIds: config.imageModelIds },
    ...config.contextBudgets === undefined ? {} : { contextBudgets: config.contextBudgets },
  }
}

/**
 * Whether one region's provider is switched on (issue #11). Opt-out semantics:
 * only an explicit `false` disables it, so every config written before this
 * switch existed — including the pre-region-split flat fields, which never
 * carry `enabled` — keeps both providers running exactly as before. The card
 * reads the same rule through `regionEnabledOf`, so the two halves can never
 * disagree about a region's state.
 */
export function regionEnabled(config: Config, region: TraeRegion): boolean {
  return regionStateOf(config, region).enabled !== false
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
})

const regionStateConfig = z.object({
  enabled: z.boolean().default(true).description('Whether this region\'s provider is offered to DSH (opt-out; false withdraws it entirely)'),
  lastCatalog: z.array(modelConfig).default([]),
  enabledModelIds: z.array(z.string()).default([]),
  imageModelIds: z.array(z.string()).default([]),
  contextBudgets: z.dict(z.number().step(1).min(1)).default({}),
})

const accountSelectionConfig = z.object({
  cn: z.string().description('Selected domestic (CN) account id (never a token)'),
  ai: z.string().description('Selected international account id (never a token)'),
})

export const Config: z<Config> = z.object({
  authFile: asVolatile(z.string().description('Optional Trae storage.json path override')),
  edition: asVolatile(z.union(['auto', 'cn', 'sg', 'solo', 'solo-sg']).default('auto').description('Trae edition hint')),
  accountId: z.string().description('Deprecated: pre-split account selector, attributed to its own region'),
  // The cast is required because `asVolatile` returns `z<T>` with `T` inferred
  // from the wrapped schema, which is narrower than the optional
  // `Partial<Record<TraeRegion, string>>` the Config interface declares. The
  // schema is unchanged either way — this only restores the assignment.
  accounts: asVolatile(accountSelectionConfig.description('Per-region account selections, keyed cn | ai')) as z<Partial<Record<TraeRegion, string>>>,
  regions: asVolatile(z.dict(regionStateConfig).default({}).description('Per-region model directory and selection, keyed cn | ai')),
  lastCatalog: z.array(modelConfig).description('Deprecated: pre-region-split CN model directory') as z<TraeModelInfo[]>,
  enabledModelIds: z.array(z.string()).default([]).description('Deprecated: pre-region-split CN selection'),
  contextBudgets: z.dict(z.number().step(1).min(1)).default({}).description('Deprecated: pre-region-split CN context budgets'),
  imageModelIds: z.array(z.string()).default([]).description('Deprecated: pre-region-split CN image opt-in'),
  models: z.array(modelConfig).description('Legacy generated Trae model list') as z<TraeModelInfo[]>,
})

/** Every region, in card tab order. */
const REGION_KEYS: readonly TraeRegion[] = ['cn', 'ai']

/**
 * One region's complete runtime stack: its own credential store, model
 * catalog, wire map, upstream clients, and loopback shim. The two regions are
 * fully parallel provider stacks, so a domestic and an international account
 * serve simultaneously and a change on one side (account switch, catalog
 * refresh) never touches the other.
 */
interface TraeRegionStack {
  region: TraeRegion
  store: TraeCredentialStore
  catalog: TraeCatalog
  shim: TraeShim
  delegating: TraeDelegatingUpstreamClient
  usageClient: TraeUsageClient
  /** Re-read this region's live directory from the upstream. */
  discoverModels(signal?: AbortSignal): Promise<readonly TraeModelInfo[]>
  /** Rebuild the adapter snapshot after `catalog.set`; no-op before registration. */
  invalidateAdapter: () => void
  /** Raw-Chat capability state for this region's card route. */
  rawDiagnostic: () => TraeRawDiagnostic
}

export function apply(ctx: Context, config: Config): void {
  // The namespace the host actually serves (see `settingsNamespaceOf`). On
  // 0.1.7 this is the Loader entry id, and the harness looks a provider's
  // namespace up by EXACT match — advertising anything else makes the provider
  // read as unconfigured (issue #13-class regression, workbuddy 2.0.16).
  const settingsNs = settingsNamespaceOf(ctx)
  let current = () => config
  const enabledSet = (value: Config, region: TraeRegion): ReadonlySet<string> => new Set(regionStateOf(value, region).enabledModelIds ?? [])
  const imageSet = (value: Config, region: TraeRegion): ReadonlySet<string> => new Set(regionStateOf(value, region).imageModelIds ?? [])
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
  const wireState = {} as Record<TraeRegion, {
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
  for (const region of REGION_KEYS) {
    wireState[region] = { callableKeys: new Set(), resolved: false, byId: new Map(), byName: new Map() }
  }
  // Drop dead rows from a (possibly stale) saved directory. No-op when that
  // region's wire map has not been resolved yet, so a transient network
  // failure never hides the whole catalog.
  const dropDeadModels = (rows: readonly TraeModelInfo[], region: TraeRegion): readonly TraeModelInfo[] => {
    const wire = wireState[region]
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
  const fallbackModels = (value: Config, region: TraeRegion): readonly TraeModelInfo[] =>
    applyImageSelection(fallbackModelsFor(region), imageSet(value, region))
  const derive = (value: Config, raw: readonly TraeModelInfo[], region: TraeRegion): readonly TraeModelInfo[] => {
    const selectedImages = imageSet(value, region)
    const derived = deriveCatalog(applyImageSelection(sanitizeCatalog(dropDeadModels(raw, region)), selectedImages), enabledSet(value, region), regionStateOf(value, region).contextBudgets ?? {})
    return derived.length > 0 ? derived : fallbackModels(value, region)
  }
  // Runtime catalog for one region: that region's saved directory (explicit
  // slot, else the pre-split flat fields which are CN-only), else the legacy
  // `models` list (also CN-only), else the region's fallback.
  const configuredModels = (value: Config, region: TraeRegion): readonly TraeModelInfo[] => {
    const state = regionStateOf(value, region)
    return state.lastCatalog?.length ? derive(value, state.lastCatalog, region)
      : region === 'cn' && value.models?.length ? derive(value, value.models, region)
        : fallbackModels(value, region)
  }
  // What the plugin card displays: the region's last-refreshed raw directory,
  // so the user re-reads the current Trae catalog rather than a stale snapshot.
  const displayModels = (value: Config, region: TraeRegion): readonly TraeModelInfo[] => {
    const state = regionStateOf(value, region)
    return state.lastCatalog?.length ? dropDeadModels(sanitizeCatalog(state.lastCatalog), region)
      : region === 'cn' && value.models?.length ? dropDeadModels(sanitizeCatalog(value.models), region)
        : fallbackModelsFor(region)
  }
  /**
   * Legacy migration for the pre-split single `accountId`: its region is
   * resolved once from the local account scan and the selection is then
   * attributed to that region ONLY — the other region keeps its documented
   * default (first discovered account of that region) instead of silently
   * inheriting a selection that belongs to the other side of the split.
   */
  let legacyAccountRegion: TraeRegion | undefined
  const effectiveAccountFor = (region: TraeRegion, value: Config): string | undefined => {
    // `accounts` is volatile on the 0.1.7 line: the raw value is a live
    // reference, so `value.accounts?.[region]` would read `undefined` and the
    // user's saved account selection would be silently ignored.
    const explicit = unwrapVolatile(value.accounts)?.[region]
    if (explicit !== undefined) return explicit
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

  const stacks = {} as Record<TraeRegion, TraeRegionStack>
  for (const region of REGION_KEYS) {
    const catalog = new TraeCatalog(region)
    const wire = wireState[region]
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
     * Resolution failures degrade to omitting DeviceInfo (its being required
     * is unverified, docs/INTL_SG_EVIDENCE.md §5) rather than failing the
     * refresh.
     */
    const refreshDeviceSafe = async (): Promise<TraeRefreshDevice | undefined> => {
      try {
        const value = await identity()
        return { deviceId: value.deviceId, machineId: value.machineId }
      } catch {
        return undefined
      }
    }
    const store = new TraeCredentialStore({
      region,
      ...unwrapVolatile(config.authFile) === undefined ? {} : { storagePath: unwrapVolatile(config.authFile) },
      edition: unwrapVolatile(config.edition) ?? 'auto',
      // The refresh callback resolves the device identity lazily so an
      // international SOLO account refreshes with its own installation's
      // machine/device ids (the official client sends a DeviceInfo body there).
      refresh: async credential => refreshTraeCredential(credential, undefined, await refreshDeviceSafe()),
    })
    // No baseUrl: the chat gateway follows the selected credential's region
    // (`trae-api-cn.mchost.guru` for CN, `coresg-normal.trae.ai` for ai).
    const solo = new TraeSoloUpstreamClient({
      credential: () => store.resolve(),
      identity,
      log: (message, detail) => ctx.logger.warn(message, detail),
    })
    const remoteCatalog = new TraeSoloRemoteCatalogClient({ credential: () => store.resolve() })
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
    const upstream = new TraeSoloBridge(solo, catalog, wireResolver)
    // The shim always sees a stable client; the Raw gateway may replace the
    // delegate asynchronously, but it stays disabled until a probe succeeds.
    const delegating = new TraeDelegatingUpstreamClient(upstream)
    const shim = createTraeShim({ catalog, client: delegating, logger: ctx.logger })
    let rawDiagnostic = (): TraeRawDiagnostic => ({ state: 'disabled' })

    // Raw Chat is probed on the CN stack only: the probe model
    // (`qwen-3.7-plus`) is CN-only, and the gateway stays disabled either way
    // — SOLO remains the only live path. The international stack therefore
    // reports `disabled` and never touches the raw endpoint.
    if (region === 'cn') {
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
            solo: upstream,
            endpoint: `${REGION_GATEWAYS.cn.chat}/api/ide/v2/llm_raw_chat`,
            edition: resolved.identity.edition,
            identity: { appVersion: resolved.identity.appVersion ?? '', buildVersion: resolved.identity.buildVersion ?? '' },
            runtime: resolved.runtime,
            // Raw Chat stays opt-in and unverified; SOLO remains the only live path.
            enabled: false,
          })
          delegating.replace(gateway.upstream)
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

    stacks[region] = {
      region,
      store,
      catalog,
      shim,
      delegating,
      usageClient,
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
        // Record every callable display key (id and name) so stale saved
        // catalogs are filtered against the live wire map and dead
        // config_names cannot be resurrected from an old `lastCatalog` /
        // `models` / `enabledModelIds`.
        wire.callableKeys.clear()
        for (const model of merged) {
          wire.callableKeys.add(model.id.trim().toLowerCase())
          wire.callableKeys.add(model.name.trim().toLowerCase())
        }
        // Mark the wire map authoritative only once a merge produced rows. A
        // live Trae account that reports only part of the catalog (or an
        // edition whose `/models` list is a subset) would otherwise let this
        // filter delete every model it did not mention — including the
        // built-in fallback set, which Remote never advertised and so can
        // never appear in `callableKeys`.
        wire.resolved = merged.length > 0
        // Populate the startup wire resolver (display id and display name →
        // wire config_name) so the chat bridge resolves the real config_name
        // even when the persisted catalog lacks `wireConfigName` (the settings
        // schema drops unknown fields on save/load).
        wire.byId.clear()
        wire.byName.clear()
        for (const model of merged) {
          if (model.wireConfigName !== undefined) {
            const target = {
              configName: model.wireConfigName,
              ...model.wireFunction === undefined ? {} : { function: model.wireFunction },
            }
            wire.byId.set(model.id, target)
            wire.byName.set(model.name.trim().toLowerCase(), target)
          }
        }
        // Discovery is a pure data return (workbuddy semantics): the card's
        // "refresh" drafts this list for an explicit save, and the startup
        // seed installs it into the live catalog. Writing it here would leak
        // un-enabled models into the runtime catalog until the next save.
        return merged
      },
      invalidateAdapter: () => {},
      rawDiagnostic: () => rawDiagnostic(),
    }
  }

  // Same-origin routes backing the card. Each request names the region whose
  // tab it belongs to; the region-scoped accessors below then read (and the
  // save writes back into) that region's own slot.
  ctx.inject(['webServer'], (webCtx) => registerTraeUsageRoute(webCtx, {
    store: region => stacks[region].store,
    client: region => stacks[region].usageClient,
    displayModels: region => displayModels(current(), region),
    enabledModelIds: region => regionStateOf(current(), region).enabledModelIds ?? [],
    regionEnabled: region => regionEnabled(current(), region),
    discoverModels: (region, signal) => stacks[region].discoverModels(signal),
    rawDiagnostic: region => stacks[region].rawDiagnostic(),
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
  const registration: Record<TraeRegion, {
    adapter?: AdapterRegistrationHandle
    directory?: DirectoryRegistrationHandle
  }> = { cn: {}, ai: {} }

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
    for (const region of REGION_KEYS) {
      // Each region owns its OWN adapter registration, so a per-region replace
      // is exactly that region's complete route set.
      registration[region].adapter?.replace(regionEnabled(value, region) ? [TRAE_PROVIDERS[region]] : [])
    }
    // The directory is ONE registration holding BOTH entries: `replace` sets
    // the complete entry set, so it is called once with the full enabled list.
    // Replacing per region would make the last region win and silently drop the
    // other's entry — a disabled region would take its enabled sibling with it.
    registration.cn.directory?.replace(REGION_KEYS
      .filter(region => regionEnabled(value, region))
      .map(region => ({
        provider: TRAE_PROVIDERS[region],
        displayName: TRAE_PROVIDER_DISPLAY_NAMES[region],
        settingsNs,
        settingsPath: [],
        declared: false,
      })))
  }

  /** Push the current config into every region's store selection and catalog. */
  const applySelection = (value: Config): void => {
    for (const region of REGION_KEYS) {
      const stack = stacks[region]
      // Unwrap the volatile fields here too: `current()` hands them over as
      // live references, so passing one through would make the storage path an
      // object and the edition a truthy non-enum.
      stack.store.setSource(
        unwrapVolatile(value.authFile),
        unwrapVolatile(value.edition) ?? 'auto',
        effectiveAccountFor(region, value),
      )
      stack.catalog.set(configuredModels(value, region))
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
    for (const region of REGION_KEYS) void stacks[region].shim.close()
  })

  void Promise.all(REGION_KEYS.map(region => stacks[region].shim.ready)).then(async () => {
    if (stopped) return
    try {
      for (const region of REGION_KEYS) {
        const stack = stacks[region]
        const trae = createTraeAdapter({
          shim: stack.shim,
          catalog: stack.catalog,
          provider: TRAE_PROVIDERS[region],
          displayName: TRAE_PROVIDER_DISPLAY_NAMES[region],
          resolveAttachments: () => ctx.get('attachments'),
        })
        stack.invalidateAdapter = () => { trae.invalidate() }
        // Always register the route first: an empty INITIAL registration is
        // invalid (`INVALID_ADAPTER`), while `replace([])` on a live one is
        // explicitly legal. `syncRegionRegistration` below then withdraws the
        // route for a region the user has switched off, in the same synchronous
        // section, so nothing observes the transient route.
        registration[region].adapter = region === 'cn'
          ? ctx.llm.registerAdapter([TRAE_PROVIDER], trae.adapter)
          : ctx.llm.registerAdapter([TRAE_AI_PROVIDER], trae.adapter)
      }
      ctx.llm.registerModelDiscovery(settingsNs, async (request, signal) => {
        const region = regionOfTraeProvider(request.provider ?? '')
        if (region === undefined) return []
        // A switched-off region advertises nothing: its route is withdrawn, so
        // this is defence in depth against a stale model-picker refresh.
        if (!regionEnabled(current(), region)) return []
        // Discovery must advertise the same image capability as the live
        // adapter catalog. The upstream flag is deliberately ignored; only the
        // user's explicit `imageModelIds` selection is authoritative.
        //
        // DSH 0.1.2 moved discovery cancellation from `request.signal` onto
        // the callback's second argument; 0.1.1 hosts still pass it on the
        // request object, so read both.
        const cancellation = signal ?? (request as { signal?: AbortSignal }).signal
        const next = applyImageSelection(
          await stacks[region].discoverModels(cancellation),
          imageSet(current(), region),
        )
        return next.map(model => ({
          id: model.id,
          name: traeModelDisplayName(model),
          ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
          ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
          // Current dsh-llm discovery types do not yet declare this field, but
          // model-management consumers already understand it. Keep the value
          // aligned with the adapter catalog; DSH core may discard it today.
          inputModalities: traeInputModalities(model),
        }))
      })
      registration.cn.directory = ctx.llm.registerConfigurableProviders(REGION_KEYS.map(region => ({
        provider: TRAE_PROVIDERS[region],
        displayName: TRAE_PROVIDER_DISPLAY_NAMES[region],
        settingsNs,
        settingsPath: [],
        declared: false,
      })))
      // Converge both regions on the saved state: a region switched off while
      // the harness was down is withdrawn here, before the startup seed below.
      syncRegionRegistration(current())
    } finally {
      if (registration.cn.adapter === undefined || registration.ai.adapter === undefined || registration.cn.directory === undefined) {
        // Registration threw; release whichever half landed. A partially
        // registered plugin must not leave a route behind with no owner.
        registration.cn.adapter?.()
        registration.ai.adapter?.()
        registration.cn.directory?.()
      }
    }
    try {
      ctx.effect(() => () => {
        registration.cn.adapter?.()
        registration.ai.adapter?.()
        registration.cn.directory?.()
      })
    } catch {
      registration.cn.adapter?.()
      registration.ai.adapter?.()
      registration.cn.directory?.()
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
    for (const region of REGION_KEYS) {
      if (!regionEnabled(current(), region)) continue
      void (async () => {
        const stack = stacks[region]
        try {
          const models = await stack.discoverModels()
          if (stopped) return
          stack.catalog.set(derive(current(), models, region))
        } catch (error: unknown) {
          ctx.logger.warn(`dsh-connect-trae: live ${region} model directory unavailable; serving the configured catalog`, error)
          stack.catalog.set(configuredModels(current(), region))
        }
        stack.invalidateAdapter()
      })()
    }
  }).catch((error: unknown) => {
    ctx.logger.error('dsh-connect-trae: loopback shim failed; providers not registered', error)
  })
}
