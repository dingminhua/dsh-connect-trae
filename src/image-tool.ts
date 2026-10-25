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

import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TraeCredential } from './auth.ts'
import type { TraeIdentity } from './identity.ts'
import { buildTraeHeaders, traeEndpoint } from './protocol.ts'
import {
  DEFAULT_TRAE_IMAGE_SIZE,
  TRAE_IMAGE_MODEL,
  TRAE_TOOL_TEXT_TO_IMAGE_PATH,
  TraeImageError,
  buildTraeImageBody,
  computeTraeIdeSign,
  parseTraeImageResponse,
  traeImageFetchUrl,
  type TraeImageRequestBody,
  type TraeImageRequestInput,
} from './image-gen-trae.ts'

/** 工具名。与其它 connect 插件的命名习惯一致。 */
export const TRAE_IMAGE_TOOL_NAME = 'trae_draw_image'

/** 单次生图上限。Trae 客户端里一张图 15-45 秒，留足余量。 */
const IMAGE_TOOL_TIMEOUT_MS = 180_000
/** 结果图下载上限（只是尽力落盘，失败不影响工具成功）。 */
const IMAGE_DOWNLOAD_TIMEOUT_MS = 60_000
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
  readonly url: string
  readonly credit?: number
  /** 已落盘的本地绝对路径。取不回字节时 generate 直接抛 IMAGE_UNAVAILABLE。 */
  readonly path: string
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

    // 把字节取到本地。这一跳**不是**免费的缓存查询：2026-10-26 的非法尺寸探针
    // 证明它一路走到 Ark 的 [callArkImageGeneration]（"image size must be at
    // least 3686400 pixels"是 Ark 原话）——命中缓存才免费，未命中就是一次新
    // 的生成。所以取不回来时绝不能当"任务成功"交回去：用户已经被扣了积分，
    // 手里却只有一个打不开的对象 key，那是最坏的形态（#62 实测）。工具在这里
    // 失败，并把"钱已经花了"和"图在 Trae 客户端里"一起讲清楚。
    let path: string
    try {
      path = await downloadTraeImage(account, body.prompt, body.image_size ?? DEFAULT_TRAE_IMAGE_SIZE, outcome.url, fetchImpl)
    } catch (error: unknown) {
      const reason = messageOf(error)
      this.options.logger?.warn('dsh-connect-trae: 结果图取回失败（已计费，图没交到用户手上）：' + reason)
      throw new TraeImageError(unavailableMessage(outcome.url, reason), 'IMAGE_UNAVAILABLE')
    }

    const result: { url: string, path: string, credit?: number } = { url: outcome.url, path }
    if (outcome.credit !== undefined) result.credit = outcome.credit
    return result
  }
}

/** 结果 URL 的扩展名：content-type 优先，兜底 png（seedream 默认输出）。 */
function imageExtension(contentType: string): string {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  return 'png'
}

/**
 * 取图：GET 同一路径 + ?prompt=&image_size=，带 x-ide-sign 与 JWT。
 *
 * 这是 Trae 桌面端自己取图的形态（out/main.js 的资源拦截器就是给这种
 * 请求补签名的）。服务端按 (用户, prompt 小写, image_size) 定位图片：
 * 命中时返回的是同一张（这里若回 JSON，会看到与 POST 相同的 uri）；
 * 未命中就真画一张——多花一张的积分（探针实证，见 traeImageFetchUrl 注释）。
 *
 * 返回本地路径；拿不到字节就抛错。**这个错必须往上抛到工具失败**：图已经
 * 计费了，只回一个打不开的对象 key 等于让用户白花钱（#62 实测的坏形态）。
 */
async function downloadTraeImage(
  account: TraeImageAccount,
  prompt: string,
  size: string,
  expectedUri: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  const url = traeImageFetchUrl(account.baseUrl, prompt, size)
  const sign = computeTraeIdeSign(prompt.toLowerCase(), size.toLowerCase())
  // 取图不是一条裸 GET：服务端要先按 x-app-id 找到该 app 的配置，再按
  // (用户, prompt, size) 回查图片。只带 Authorization + x-ide-sign 时，
  // 实测回的是 "failed to get app config: record not found"——那一步缺的
  // 正是这套网关头，所以这里复用同一份 header 构造，只把 Accept 换成图片。
  const headers: Record<string, string> = buildTraeHeaders(account.credential, account.identity, {
    profile: 'model-detail',
  })
  headers['x-ide-sign'] = sign
  headers['Accept'] = 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.9,*/*;q=0.8'
  delete headers['Content-Type']
  const response = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS) })
  if (!response.ok) throw new Error('HTTP ' + response.status + '（GET 取图）')
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.toLowerCase().startsWith('image/')) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength === 0) throw new Error('取图得到空文件')
    const dir = join(tmpdir(), 'trae-image-gen')
    await mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const path = join(dir, TRAE_IMAGE_MODEL + '-' + stamp + '.' + imageExtension(contentType))
    await writeFile(path, Buffer.from(bytes))
    return path
  }
  // 回的是 JSON：说明这次 GET 没有吐字节（命中缓存但只回了 uri，或重新生成了一张）。
  const text = await response.text()
  let uri: string | undefined
  try {
    const json = JSON.parse(text) as { uri?: unknown }
    if (typeof json.uri === 'string') uri = json.uri
  } catch { /* 落到下面的通用报错 */ }
  if (uri !== undefined && uri === expectedUri) {
    throw new Error('取图接口只回了 JSON（同 uri，未吐字节）')
  }
  throw new Error('取图接口回了 JSON' + (uri === undefined ? '' : '（新 uri：' + uri + '，可能与本次生成不是同一张）') + '：' + text.slice(0, 160))
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 取图失败里最不该重试的一种：服务端在取图那一跳找不到 app config
 * （实测 code=3003 / LLMRawChatV2 2001 'failed to get app config: record not found'）。
 * 那是账号侧的能力缺失，不是这条 prompt 的问题——重跑只会白花积分，
 * 所以要在这里点名，别让它看起来像"换张图试试"就能好的错。
 */
function isMissingAppConfig(reason: string | undefined): boolean {
  if (reason === undefined) return false
  return reason.includes('app config') || reason.includes('code=3003')
}

/**
 * 取不回字节时的失败文案。这条错误会被模型读到、也可能被用户读到，所以必须
 * 同时讲清三件事：钱已经花了、图在哪能找到、要不要再重跑。缺任何一条都会
 * 引发最糟的反应——用户以为没成功，于是再花一次积分。
 */
function unavailableMessage(uri: string, reason: string): string {
  const advice = isMissingAppConfig(reason)
    ? '这次是服务端取图通道缺 app config（code=3003），换 prompt 重跑同样取不回，不要重试。'
    : '可以稍后重跑，但那会再扣一次积分。'
  return 'trae image: 图片已经生成、积分已经扣了，但字节取不回来：' + reason
    + '\n图片对象 key：' + uri + '（Trae 内部 uri，直接打不开；在 Trae 客户端的历史里能看到这张图）'
    + '\n' + advice
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
  // 图已经画出来了（积分已扣），只是字节没取回：重试等于再买一张。
  'IMAGE_UNAVAILABLE',
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
      + '取图口径：生成只回一个图片对象 key（tos uri，打不开），工具随后拿同一 (prompt, size) 带签名再请求一次，'
      + '把字节取回并落成本地文件。实测这一跳不是免费的缓存查询——它会真的走到上游图像生成，'
      + '缓存命中才免费，未命中就是一次新的生成。所以取不回字节时本工具直接失败并说清积分已经扣了；'
      + '失败后有 30 秒冷却，冷却内重试不会打到上游。不要为了换张图重复跑同一条 prompt。'
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
          url: { type: 'string', description: 'Trae 图片对象 key（tos uri），不是可直接打开的 URL。' },
          path: { type: 'string', description: '已落盘的本地绝对路径；取不回字节时工具直接失败，不会走到这里。' },
          model: { type: 'string', description: '实际使用的生图模型 id。' },
          prompt: { type: 'string', description: '实际提交的画面描述。' },
          size: { type: 'string', description: '实际提交的尺寸。' },
          hint: { type: 'string', description: '给模型的后续提示（如何展示、扣费口径）。' },
          credit: { type: 'number', description: '上游若回传扣费数字，这里给出积分数。' },
        },
        required: ['url', 'path', 'model', 'prompt', 'size', 'hint'],
        additionalProperties: false,
      },
      render(_args: unknown, value: unknown): TraeToolContentBlock[] {
        const record = asRecord(value)
        const url = asNonEmptyString(record['url']) ?? ''
        const model = asNonEmptyString(record['model']) ?? 'unknown'
        const size = asNonEmptyString(record['size']) ?? ''
        const credit = typeof record['credit'] === 'number' ? record['credit'] : undefined
        const path = asNonEmptyString(record['path'])
        const hint = asNonEmptyString(record['hint']) ?? ''
        // 只有真拿到本地文件才画 markdown 图片：url 是 tos 对象 key（形如
        // tos-cn-i-xxx/cn/<uid>/gen_image/…），拼进 ![](...) 只会得到一个
        // 以当前目录为基准的坏相对路径，在宿主里渲染成碎图标。正常路径下
        // 取图失败已经是工具失败（不会有 value），这里只是防御性兜底。
        const lines = path === undefined
          ? ['图片对象 key（不能直接打开）：`' + url + '`']
          : ['![Trae 文生图](' + path + ')']
        lines.push(
          '',
          '文生图 · 模型：' + model + (size === '' ? '' : ' · 尺寸：' + size)
          + (credit === undefined ? '' : ' · 消耗 ' + credit + ' 积分'),
        )
        if (path !== undefined) lines.push('本地文件：' + path)
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
          path: outcome.path,
          model: TRAE_IMAGE_MODEL,
          prompt,
          size,
          hint:
            '这张图来自 Trae 文生图（模型 ' + TRAE_IMAGE_MODEL + '），按张计入该账号积分'
            + '（实测 1920x1920 约 8.8，上游不回传数字，以 Trae 额度面板为准）。'
            + '已落本地文件，优先用 path 展示。',
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
