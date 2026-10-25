/**
 * trae_draw_image：把 Trae 的文生图能力（客户端与 SOLO 共用的
 * /api/ide/v1/tool_text_to_image 端点）暴露成一个 DSH agent 工具。
 *
 * 与 dsh-connect-workbuddy 的 image-tool.ts 同一注册形态：手写 ToolDefinition、
 * 不 import 宿主类型（宿主 Tools.register 只校验 output.render 是函数、
 * output.schema 是受支持的 JSON Schema；parameters 原样投影给模型）。
 * 这样 bin 可达图不新增任何非 node: 裸说明符（tests/host-peers.spec.ts 的约束）。
 *
 * 作用域（v1，有意为之）：
 *   - 只做文生图。改图（image_urls 传参考图）需要先把本地文件经
 *     get_resource_upload_url 预签名上传到 TOS，那是另一条流水线，未接。
 *   - 只做文生图同步端点。SSE 端点与 video 端点的常量在 image-gen-trae.ts
 *     留档（tool_text_to_image_stream / tool_text_to_video_stream），
 *     Trae 的视频结果还要轮询 query_material_result，等真机探针确认后再加。
 *
 * @module dsh-connect-trae/image-tool
 */

import type { TraeCredential } from './auth.ts'
import type { TraeIdentity } from './identity.ts'
import { buildTraeHeaders, traeEndpoint } from './protocol.ts'
import {
  DEFAULT_TRAE_IMAGE_SIZE,
  TRAE_IMAGE_MODEL,
  TRAE_TOOL_TEXT_TO_IMAGE_PATH,
  TraeImageError,
  buildTraeImageBody,
  parseTraeImageResponse,
  type TraeImageRequestBody,
  type TraeImageRequestInput,
} from './image-gen-trae.ts'

/** 工具名。与其它 connect 插件的命名习惯一致。 */
export const TRAE_IMAGE_TOOL_NAME = 'trae_draw_image'

/** 单次生图上限。Trae 客户端里一张图 15-45 秒，留足余量。 */
const IMAGE_TOOL_TIMEOUT_MS = 180_000
/** 失败后的冷却：生图按张扣积分，连续重试会白白烧积分。 */
const FAILURE_COOLDOWN_MS = 30_000

/** 宿主 ContentBlock 的最小结构（只需要文本块）。 */
export interface TraeToolContentBlock {
  readonly type: 'text'
  readonly text: string
}

/** 一次生图请求所需的全部账号侧能力（index.ts 按面板解析后传入）。 */
export interface TraeImageAccount {
  readonly credential: TraeCredential
  readonly identity: TraeIdentity
  /** 该账号应打到的网关基址（REGION_GATEWAYS[region].chat）。 */
  readonly baseUrl: string
}

export interface TraeImageGenerated {
  /** Trae 的图片对象 key（tos uri），不是可直接打开的 URL。 */
  readonly url: string
  readonly credit?: number
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** HTTP 层的状态码映射。语义与 workbuddy 侧一致。 */
function mapHttpToImageError(status: number, detail: string): TraeImageError {
  const tail = detail === '' ? '' : '：' + detail.slice(0, 200)
  if (status === 401 || status === 403) return new TraeImageError('trae image: 上游拒绝了凭据（HTTP ' + status + '）' + tail, 'AUTH')
  if (status === 429) return new TraeImageError('trae image: 上游限流（HTTP 429）' + tail, 'RATE_LIMIT')
  return new TraeImageError('trae image: 上游 HTTP ' + status + tail, 'UPSTREAM')
}

/**
 * 发一次真机文生图请求。所有可预期的失败都归一成 TraeImageError，
 * 让上层的冷却判据只看 code（见 createTraeDrawImageTool 的注释）。
 */
export class TraeImageClient {
  constructor(
    private readonly options: {
      readonly fetchImpl?: typeof fetch
      readonly timeoutMs?: number
      readonly logger?: { warn(message: string): void }
    } = {},
  ) {}

  async generate(
    account: TraeImageAccount,
    input: TraeImageRequestInput,
    signal?: AbortSignal,
  ): Promise<TraeImageGenerated> {
    // 参数校验先行：这一层抛的 INVALID_ARGS 一分钱没花，不进冷却。
    const body: TraeImageRequestBody = buildTraeImageBody(input)
    const endpoint = traeEndpoint(account.baseUrl, TRAE_TOOL_TEXT_TO_IMAGE_PATH)
    const headers = buildTraeHeaders(account.credential, account.identity, { profile: 'model-detail' })
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch
    const timeoutMs = this.options.timeoutMs ?? IMAGE_TOOL_TIMEOUT_MS
    const requestSignal = signal ?? AbortSignal.timeout(timeoutMs)

    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: requestSignal,
      })
    } catch (error: unknown) {
      // 请求没发出去（连接失败/中止）。诚实标 NO_ROUTE——它仍在冷却集合里，
      // 因为超时中止时上游很可能已经在画图了。
      throw new TraeImageError('trae image: 生图请求发出失败：' + messageOf(error), 'NO_ROUTE')
    }

    let payload: string
    try {
      payload = await response.text()
    } catch (error: unknown) {
      throw new TraeImageError('trae image: 读取应答失败：' + messageOf(error), 'UPSTREAM')
    }
    if (!response.ok) throw mapHttpToImageError(response.status, payload)

    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      throw new TraeImageError(
        'trae image: 应答不是 JSON（HTTP 200）：' + payload.slice(0, 200),
        'UPSTREAM',
      )
    }
    // envelope 的 code/msg 在这里归一成 UPSTREAM/EMPTY_RESULT；
    // 真机探针若暴露新的未知字段形态，也会在这里以 EMPTY_RESULT 浮出原文线索。
    const outcome = parseTraeImageResponse(json)

    // 只发这一次 POST，**不再补一次 GET「取图」**。2026-10-26 的活体探针推翻了这个
    // 假设：同一个 prompt/size 紧接着 GET，回来的 uri 是新的
    // （…_1792954795741_44f94116_… → …_1792954810505_b107ac11_…），耗时 27 秒、
    // 一个字节都没有——那条 GET 是又一次生成，等于每张图稳定多扣一张。
    // 真正把 uri 变成字节的通道（iCube material，需要运行时 boot config 与
    // x-icube-token）还没打通，所以这里如实只交 uri，并在文案里说清「图在 Trae
    // 客户端的历史里能看到，插件拿不到字节」。
    const result: { url: string, credit?: number } = { url: outcome.url }
    if (outcome.credit !== undefined) result.credit = outcome.credit
    return result
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 这些失败码都发生在「生图请求已经发出去」之后或尝试发出它——上游可能已经
 * 扣了积分或排了队，连续重试只会把它们再花一遍，所以进冷却。
 * INVALID_ARGS / NOT_LOGGED_IN 一分钱没花，不冷却（判据同 workbuddy）。
 */
const BILLABLE_FAILURE_CODES: ReadonlySet<string> = new Set([
  'AUTH',
  'RATE_LIMIT',
  'NO_ROUTE',
  'UPSTREAM',
  'EMPTY_RESULT',
])

function isBillableFailure(error: unknown): boolean {
  if (error instanceof TraeImageError) return BILLABLE_FAILURE_CODES.has(error.code)
  // 非类型化异常只会来自 client.generate 的 POST 之后阶段（校验/凭据都是类型化的）。
  return true
}

/** 工具运行所需的外部能力，全部由 index.ts 注入，便于单测替换。 */
export interface TraeImageToolDeps {
  /** 解析可用账号（登录态 + 身份 + 网关）；没有可用区时返回 undefined，不要抛。 */
  readonly resolveAccount: () => Promise<TraeImageAccount | undefined>
  /** 真正发一次文生图请求。 */
  readonly generate: (
    account: TraeImageAccount,
    request: TraeImageRequestInput,
    signal?: AbortSignal,
  ) => Promise<TraeImageGenerated>
  readonly logger: { warn(message: string): void }
}

/**
 * 宿主 ToolDefinition 的结构子集（同 workbuddy 的 ImageToolDefinition；
 * 刻意不 import 宿主类型，只描述宿主会读哪些字段）。
 */
export interface TraeToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): TraeToolContentBlock[]
  }
  readonly timeoutMs: number
  execute(args: unknown, exec: { readonly signal?: AbortSignal }): Promise<Record<string, unknown>>
}

/** 造出工具定义。每次 apply() 只造一个实例，冷却状态挂在闭包里。 */
export function createTraeDrawImageTool(deps: TraeImageToolDeps): TraeToolDefinition {
  let cooldownUntil = 0

  return {
    name: TRAE_IMAGE_TOOL_NAME,
    description:
      '用当前登录的 Trae 账号文生图（TraeWork/SOLO 同款服务，模型 ' + TRAE_IMAGE_MODEL + '）。'
      + '只在用户明确要一张图时调用：每张真实扣该账号积分，实测 CN 个人版 1920x1920 一张约 8.8 积分'
      + '（尺寸越大越贵），而上游不回传扣费数字，以 Trae 额度面板为准。'
      + '不是常开能力：只有插件设置里为该区打开「允许模型自主生图」(drawImageEnabled) 时本工具才存在，'
      + '没打开就没得调——不要用报错去试探它开没开。'
      + '取图口径：生成只回一个图片对象 key（tos uri，形如 tos-cn-i-xxx/cn/<uid>/gen_image/…，打不开），'
      + '本工具不会再发取图请求——实测对同一 (prompt, size) 再 GET 一次不是缓存查询，而是又一次生成，'
      + '只会再扣一张的钱并回一个**新的** uri。图片字节目前插件拿不到，图只在 Trae 客户端的历史里能看到；'
      + '把 key 原样告诉用户即可。不要为了"取图"或"换张"重跑同一条 prompt。失败后有 30 秒冷却，冷却内重试不会打到上游。'
      + '尺寸：默认 ' + DEFAULT_TRAE_IMAGE_SIZE + '，也可给 宽x高（总像素需在 3686400~16777216 之间，'
      + '如 2048x2048）或预设 2k/3k/4k；过小（如 1024x1024）会被上游直接拒绝。'
      + '（改图与文生视频暂未开放：改图需要先走 TOS 上传预签名，视频要轮询素材结果。）',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '画面描述（中文或英文都可以）。写清楚主体、风格、构图、光线。',
        },
        size: {
          type: 'string',
          description: '图片尺寸：默认 ' + DEFAULT_TRAE_IMAGE_SIZE + '；也可给 宽x高（总像素 3686400~16777216，'
            + '如 2048x2048）或预设 2k/3k/4k。过小（如 1024x1024）会被上游拒绝。',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Trae 图片对象 key（tos uri），不是可直接打开的 URL；图片字节插件拿不到。' },
          model: { type: 'string', description: '实际使用的生图模型 id。' },
          prompt: { type: 'string', description: '实际提交的画面描述。' },
          size: { type: 'string', description: '实际提交的尺寸。' },
          hint: { type: 'string', description: '给模型的后续提示（如何展示、扣费口径）。' },
          credit: { type: 'number', description: '上游若回传扣费数字，这里给出积分数。' },
        },
        required: ['url', 'model', 'prompt', 'size', 'hint'],
        additionalProperties: false,
      },
      render(_args: unknown, value: unknown): TraeToolContentBlock[] {
        const record = asRecord(value)
        const url = asNonEmptyString(record['url']) ?? ''
        const model = asNonEmptyString(record['model']) ?? 'unknown'
        const size = asNonEmptyString(record['size']) ?? ''
        const credit = typeof record['credit'] === 'number' ? record['credit'] : undefined
        const hint = asNonEmptyString(record['hint']) ?? ''
        // 永远不画 ![](...)：url 是 tos 对象 key（形如 tos-cn-i-xxx/cn/<uid>/gen_image/…），
        // 不是 URL，拼进 markdown 图片语法只会得到以当前目录为基准的坏相对路径，
        // 在宿主里渲染成碎图标。而字节目前没有任何可用通道（取图 GET 是又一次生成，
        // 见 image-gen-trae.ts 的注释），所以这里只给 key，且用行内代码标成不可打开。
        const lines = [
          '图片对象 key（不能直接打开）：`' + url + '`',
          '',
          '文生图 · 模型：' + model + (size === '' ? '' : ' · 尺寸：' + size)
          + (credit === undefined ? '' : ' · 消耗 ' + credit + ' 积分'),
        ]
        if (hint !== '') lines.push('', hint)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: IMAGE_TOOL_TIMEOUT_MS,
    async execute(args: unknown, exec): Promise<Record<string, unknown>> {
      const record = asRecord(args)
      const prompt = asNonEmptyString(record['prompt'])
      if (prompt === undefined) {
        throw new TraeImageError(TRAE_IMAGE_TOOL_NAME + ': 参数 prompt 必填，且必须是非空字符串。', 'INVALID_ARGS')
      }
      const size = asNonEmptyString(record['size']) ?? DEFAULT_TRAE_IMAGE_SIZE

      const now = Date.now()
      if (now < cooldownUntil) {
        const seconds = Math.ceil((cooldownUntil - now) / 1000)
        throw new TraeImageError(
          'trae image: 上一次生图刚失败过，请 ' + seconds + ' 秒后再试（失败冷却是为了避免连续重试白白烧积分）。',
          'COOLDOWN',
        )
      }

      const account = await deps.resolveAccount()
      if (account === undefined) {
        throw new TraeImageError(
          'trae image: 没有可用的 Trae 账号——要么相关区都没登录，要么已登录的那个区没有打开'
          + '「允许模型自主生图」（drawImageEnabled）。请先登录 Trae 并在插件设置里打开那个开关。',
          'NOT_LOGGED_IN',
        )
      }

      const signal = exec.signal === undefined
        ? AbortSignal.timeout(IMAGE_TOOL_TIMEOUT_MS)
        : AbortSignal.any([exec.signal, AbortSignal.timeout(IMAGE_TOOL_TIMEOUT_MS)])

      try {
        const outcome = await deps.generate(account, { prompt, size }, signal)
        const value: Record<string, unknown> = {
          url: outcome.url,
          model: TRAE_IMAGE_MODEL,
          prompt,
          size,
          hint:
            '这张图来自 Trae 文生图（模型 ' + TRAE_IMAGE_MODEL + '），按张计入该账号积分'
            + '（实测 1920x1920 约 8.8，上游不回传数字，以 Trae 额度面板为准）。'
            + 'url 是 Trae 的图片对象 key，不能直接打开，图片字节插件也拿不到——'
            + '这张图能在 Trae 客户端的历史/作品里看到。不要把 key 拼进 markdown 图片语法；'
            + '也不要为了取图或换张重跑同一条 prompt（取图那条请求本身就是又一次生成，会再扣一张）。',
        }
        if (outcome.credit !== undefined) value.credit = outcome.credit
        return value
      } catch (error: unknown) {
        if (isBillableFailure(error)) cooldownUntil = Date.now() + FAILURE_COOLDOWN_MS
        throw error
      }
    },
  }
}

/** 宿主 tools 服务里本工具用到的那一个方法。 */
export interface ToolsServiceLike {
  register(definition: unknown): () => void
}

/**
 * 把工具注册进宿主。返回 disposer；调用方负责在插件卸载时调用它。
 * 注册失败只记警告——生图工具缺失不该让整个插件起不来（同 workbuddy）。
 */
export function registerTraeDrawImageTool(
  tools: ToolsServiceLike,
  deps: TraeImageToolDeps,
): (() => void) | undefined {
  try {
    return tools.register(createTraeDrawImageTool(deps))
  } catch (error: unknown) {
    deps.logger.warn('dsh-connect-trae: 注册 ' + TRAE_IMAGE_TOOL_NAME + ' 失败: ' + messageOf(error))
    return undefined
  }
}
