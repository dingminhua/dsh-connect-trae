import type { TraeCredential } from './auth.ts'
import { parseTraeRemoteModel, type TraeDiscoveredModel } from './model-metadata.ts'

export const TRAE_SOLO_REMOTE_BASE = 'https://solo.trae.cn/api/remote/v1'

export interface TraeSoloRemoteCatalogOptions {
  credential(): Promise<TraeCredential>
  fetchImpl?: typeof fetch
  baseUrl?: string
}

/**
 * Read-only model catalog client for the SOLO Web API.
 *
 * This deliberately has no chat/session method: the Remote session protocol
 * only exposes a final answer and cannot preserve DSH's structured tool loop.
 */
export class TraeSoloRemoteCatalogClient {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string

  constructor(private readonly options: TraeSoloRemoteCatalogOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl ?? TRAE_SOLO_REMOTE_BASE
  }

  private async headers(): Promise<Record<string, string>> {
    const credential = await this.options.credential()
    return {
      'Authorization': `Cloud-IDE-JWT ${credential.accessToken}`,
      'Content-Type': 'application/json',
      'x-trae-client-type': 'web',
      'x-trae-user-timezone': 'Asia/Shanghai',
      'x-preferenced-language': 'zh-cn',
      'Referer': 'https://solo.trae.cn/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  }

  async fetchModels(signal?: AbortSignal): Promise<TraeDiscoveredModel[]> {
    const headers = await this.headers()
    // BOTH product lines are requested and their groups combined.
    //
    // The Remote directory answers one group per requested `function`, and the
    // two products' groups are NOT subsets of each other:
    //   - `chat_v3` (TraeCode) uniquely carries `Kimi-K2.8-Preview`,
    //     `GLM-5.3-Flash` and `Qwen3.8-Flash`;
    //   - the `solo_*` groups (TraeWork) uniquely carry `Kimi-K2.7-Code`,
    //     `Kimi-K2.6` and `Seed-Code`.
    // Requesting only `chat_v3` and taking only that group silently dropped the
    // TraeWork-only models, which is why the served list lacked rows the
    // product's own menu shows. Unioning them reproduces the TraeWork CN menu
    // exactly (16/16 against the user's screenshot).
    const requestFunctions = 'chat_v3,solo_work_lite,solo_agent_lite,solo_agent_remote,solo_work_remote'
    const response = await this.fetchImpl(`${this.baseUrl}/models?functions=${encodeURIComponent(requestFunctions)}`, { headers, signal: signal ?? AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`SOLO remote models returned HTTP ${response.status}`)
    const json = await response.json() as { code?: number; data?: { list?: { function?: string; models?: unknown[] }[] } }
    const groups = json.data?.list ?? []
    // Fall back to every group present when the deployment answers with
    // functions other than the requested ones.
    const wanted = new Set(requestFunctions.split(','))
    const selected = groups.filter(group => wanted.has(String(group.function)))
    const usable = selected.length > 0 ? selected : groups
    const seen = new Set<string>()
    const models: TraeDiscoveredModel[] = []
    for (const group of usable) {
      for (const raw of group?.models ?? []) {
        const model = parseTraeRemoteModel(raw)
        if (model === undefined || seen.has(model.id)) continue
        seen.add(model.id)
        models.push(model)
      }
    }
    if (models.length === 0) throw new Error('SOLO remote models response contained no models')
    return models
  }
}
