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
import { join } from 'node:path'

import type { TraeCredential } from './auth.ts'
import type { TraeIdentity } from './identity.ts'
import { buildTraeHeaders, traeEndpoint } from './protocol.ts'
import {
  DEFAULT_TRAE_IMAGE_SIZE,
  TRAE_IMAGE_MODEL,
  TRAE_RESOURCE_URL_PATH,
  TRAE_TOOL_TEXT_TO_IMAGE_PATH,
  TraeImageError,
  buildTraeImageBody,
  buildTraeResourceUrlBody,
  parseTraeImageResponse,
  signedTraeResourceUrl,
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
  /** Trae 的图片对象 key（tos uri），不是可直接打开的 URL；留作记录与排障。 */
  readonly url: string
  readonly credit?: number
  /** 图片字节（已按 key 解析出签名地址并下载好）。 */
  readonly bytes: Uint8Array
  /** 下载应答的 content-type（实测 image/jpeg）。 */
  readonly mimeType: string
}

/** 图片落地目录名，相对会话工作目录。 */
export const TRAE_IMAGE_DIR = 'trae-images'

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
 * 发一次真机文生图请求，并把图片字节一起取回来。所有可预期的失败都归一成
 * TraeImageError，让上层的冷却判据只看 code（见 createTraeDrawImageTool 的注释）。
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

    // 取图（2026-10-26 实测的通路，不生成图、不额外计费）：先把 tos key 换成
    // byteimg 签名地址（get_resource_url 的 {uri_list:[key]}），再直接 GET 那个
    // 地址拿字节（实测 image/jpeg、1,155,578 字节、头 ffd8ffe0）。
    // 注意**不是**同路径那条 ?prompt=&image_size= 的 GET——那才是又一次生成
    // （回新 uri、27 秒、零像素、多扣一张），已彻底停用。
    const signed = await this.resolveSignedUrl(account, outcome.url, requestSignal)
    const image = await this.download(signed, requestSignal)

    const result: { url: string, credit?: number, bytes: Uint8Array, mimeType: string } = {
      url: outcome.url,
      bytes: image.bytes,
      mimeType: image.mimeType,
    }
    if (outcome.credit !== undefined) result.credit = outcome.credit
    return result
  }

  /**
   * 把 tos key 解析成一个可直接 GET 的签名地址（byteimg CDN，带 x-expires）。
   * 这一步只是向服务端要地址，不会重新画图。
   */
  async resolveSignedUrl(
    account: TraeImageAccount,
    uri: string,
    signal?: AbortSignal,
  ): Promise<string> {
    // 参数毛病先在本地拦下：INVALID_ARGS 一分钱没花，也不该说成"图已经生成了"。
    const body = buildTraeResourceUrlBody(uri)
    const endpoint = traeEndpoint(account.baseUrl, TRAE_RESOURCE_URL_PATH)
    const headers = buildTraeHeaders(account.credential, account.identity, { profile: 'model-detail' })
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch
    const requestSignal = signal ?? AbortSignal.timeout(IMAGE_TOOL_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: requestSignal,
      })
    } catch (error: unknown) {
      throw new TraeImageError(
        'trae image: 图片已经生成、积分已经扣了，但解析下载地址的请求发不出去：' + messageOf(error),
        'IMAGE_UNAVAILABLE',
      )
    }

    let payload: string
    try {
      payload = await response.text()
    } catch (error: unknown) {
      throw new TraeImageError(
        'trae image: 图片已经生成、积分已经扣了，但读取解析应答失败：' + messageOf(error),
        'IMAGE_UNAVAILABLE',
      )
    }
    if (!response.ok) throw mapHttpToImageError(response.status, payload)

    let json: unknown
    try {
      json = JSON.parse(payload)
    } catch {
      throw new TraeImageError(
        'trae image: 图片已经生成、积分已经扣了，但解析应答不是 JSON（HTTP 200）：' + payload.slice(0, 200),
        'IMAGE_UNAVAILABLE',
      )
    }
    if (json === null || typeof json !== 'object') {
      throw new TraeImageError(
        'trae image: 图片已经生成、积分已经扣了，但解析应答里没有 url_map：' + payload.slice(0, 200),
        'IMAGE_UNAVAILABLE',
      )
    }
    return signedTraeResourceUrl(json, uri)
  }

  /** 下载签名地址上的图片字节。CDN 不需要任何 Trae 头——签名就在 query 里。 */
  async download(
    signed: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array, mimeType: string }> {
    const fetchImpl = this.options.fetchImpl ?? globalThis.fetch
    const requestSignal = signal ?? AbortSignal.timeout(IMAGE_TOOL_TIMEOUT_MS)

    let response: Response
    try {
      response = await fetchImpl(signed, {
        method: 'GET',
        headers: { Accept: 'image/*' },
        signal: requestSignal,
      })
    } catch (error: unknown) {
      throw new TraeImageError(
        'trae image: 图片已经生成、积分已经扣了，但下载字节失败：' + messageOf(error),
        'IMAGE_UNAVAILABLE',
      )
    }
    if (!response.ok) {
      throw new TraeImageError(
        'trae image: 图片已经生成、积分已经扣了，但下载地址回了 HTTP ' + response.status + '。',
        'IMAGE_UNAVAILABLE',
      )
    }

    let buffer: ArrayBuffer
    try {
      buffer = await response.arrayBuffer()
    } catch (error: unknown) {
      throw new TraeImageError(
        'trae image: 图片已经生成、积分已经扣了，但读取图片字节失败：' + messageOf(error),
        'IMAGE_UNAVAILABLE',
      )
    }
    if (buffer.byteLength === 0) {
      throw new TraeImageError(
        'trae image: 图片已经生成、积分已经扣了，但下载回来是 0 字节。',
        'IMAGE_UNAVAILABLE',
      )
    }
    const contentType = response.headers.get('content-type') ?? ''
    const mimeType = contentType.split(';')[0]?.trim() ?? ''
    return { bytes: new Uint8Array(buffer), mimeType: mimeType === '' ? 'image/jpeg' : mimeType }
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
  // 图已经生成、积分已经扣了，只是字节没落地——重试等于再买一张。
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
/**
 * execute 收到的执行上下文（宿主原样传进工具的那个对象）。
 * agent.session.cwd 是会话工作目录——ChatView 解析 markdown 相对路径用的也是它，
 * 所以图片写在这里，渲染层就能按同样的基准显示。
 */
export interface TraeToolExec {
  readonly signal?: AbortSignal
  readonly agent?: { readonly session?: { readonly cwd?: string } }
}

export interface TraeToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): TraeToolContentBlock[]
  }
  readonly timeoutMs: number
  execute(args: unknown, exec: TraeToolExec): Promise<Record<string, unknown>>
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
      + '取图口径：生成成功后本工具会把图片字节取回来、写进会话工作目录的 trae-images/ 下，'
      + '结果里给相对路径 path，渲染层已经据此把图显示给用户了——不需要你再写 markdown。'
      + '取图走 get_resource_url 解析签名地址（只是要地址，不会重新生成、不额外计费）。'
      + '不要为了"取图"或"换张"重跑同一条 prompt（那会再扣一张）。'
      + '失败码 IMAGE_UNAVAILABLE 表示图已生成、积分已扣、但字节没落地：同样不要重跑。'
      + '失败后有 30 秒冷却，冷却内重试不会打到上游。'
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
          url: { type: 'string', description: 'Trae 图片对象 key（tos uri），留作记录与排障，不是可直接打开的 URL。' },
          path: { type: 'string', description: '图片文件相对会话工作目录的路径（如 trae-images/trae-20261026-041500-ab12cd.jpg）；渲染层已据此显示图片。' },
          model: { type: 'string', description: '实际使用的生图模型 id。' },
          prompt: { type: 'string', description: '实际提交的画面描述。' },
          size: { type: 'string', description: '实际提交的尺寸。' },
          hint: { type: 'string', description: '给模型的后续提示（图片位置、扣费口径）。' },
          credit: { type: 'number', description: '上游若回传扣费数字，这里给出积分数。' },
        },
        required: ['url', 'path', 'model', 'prompt', 'size', 'hint'],
        additionalProperties: false,
      },
      render(_args: unknown, value: unknown): TraeToolContentBlock[] {
        const record = asRecord(value)
        const url = asNonEmptyString(record['url']) ?? ''
        const path = asNonEmptyString(record['path']) ?? ''
        const model = asNonEmptyString(record['model']) ?? 'unknown'
        const size = asNonEmptyString(record['size']) ?? ''
        const credit = typeof record['credit'] === 'number' ? record['credit'] : undefined
        const hint = asNonEmptyString(record['hint']) ?? ''
        // 只有真落盘了才画 ![](...)：path 是相对会话工作目录的文件路径，DSH 的聊天
        // 按 session cwd 解析它、再过 api/file 鉴权路由取字节，所以能显示。
        // url 是 tos 对象 key，拼进 markdown 只会得到碎图标——那种情况只给行内代码。
        const lines = path === ''
          ? ['图片已生成，但字节没取回来（只有对象 key）：`' + url + '`']
          : ['![Trae 文生图](' + path + ')']
        lines.push(
          '',
          '文生图 · 模型：' + model + (size === '' ? '' : ' · 尺寸：' + size)
          + (credit === undefined ? '' : ' · 消耗 ' + credit + ' 积分'),
        )
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
        const cwd = sessionCwdOf(exec) ?? process.cwd()
        const saved = await saveTraeImage(cwd, outcome)
        const value: Record<string, unknown> = {
          url: outcome.url,
          path: saved.relativePath,
          model: TRAE_IMAGE_MODEL,
          prompt,
          size,
          hint:
            '这张图来自 Trae 文生图（模型 ' + TRAE_IMAGE_MODEL + '），按张计入该账号积分'
            + '（实测 1920x1920 约 8.8，上游不回传数字，以 Trae 额度面板为准）。'
            + '图片已保存到会话目录下的 ' + saved.relativePath + '（绝对路径 ' + saved.absolutePath + '），'
            + '渲染层已经把它显示给用户了，不需要你再写 markdown。'
            + '不要为了取图或换张重跑同一条 prompt——那会再扣一张。',
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

/** 从 exec 里读会话工作目录（宿主没给就返回 undefined）。 */
function sessionCwdOf(exec: TraeToolExec): string | undefined {
  const cwd = exec.agent?.session?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

/** mime → 文件后缀（上游目前只回 image/jpeg）。 */
function imageExtensionFor(mimeType: string): string {
  const type = mimeType.toLowerCase()
  if (type.includes('png')) return 'png'
  if (type.includes('webp')) return 'webp'
  if (type.includes('gif')) return 'gif'
  return 'jpg'
}

/** 文件名：本地时间的可排序时间戳 + 随机后缀，同一秒两张图也不会互相覆盖。 */
function imageFileName(mimeType: string, now: number): string {
  const date = new Date(now)
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = String(date.getFullYear()) + pad(date.getMonth() + 1) + pad(date.getDate())
    + '-' + pad(date.getHours()) + pad(date.getMinutes()) + pad(date.getSeconds())
  const rand = Math.random().toString(16).slice(2, 8)
  return 'trae-' + stamp + '-' + rand + '.' + imageExtensionFor(mimeType)
}

/**
 * 把图片字节写成 <cwd>/trae-images/<name>，返回绝对路径与相对路径。
 * 相对路径给 render 用：DSH 的聊天按 session cwd 解析 markdown 图片地址，
 * 再过 api/file 鉴权路由取字节，所以相对路径就能显示。
 */
async function saveTraeImage(
  cwd: string,
  outcome: TraeImageGenerated,
): Promise<{ absolutePath: string, relativePath: string }> {
  const name = imageFileName(outcome.mimeType, Date.now())
  const directory = join(cwd, TRAE_IMAGE_DIR)
  try {
    await mkdir(directory, { recursive: true })
    const absolutePath = join(directory, name)
    await writeFile(absolutePath, outcome.bytes)
    return { absolutePath, relativePath: TRAE_IMAGE_DIR + '/' + name }
  } catch (error: unknown) {
    throw new TraeImageError(
      'trae image: 图片已经生成、积分已经扣了，但写入本地文件失败（目录 ' + directory + '）：'
      + messageOf(error) + '\n图片对象 key：' + outcome.url,
      'IMAGE_UNAVAILABLE',
    )
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
