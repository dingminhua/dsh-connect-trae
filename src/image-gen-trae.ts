/**
 * Trae 文生图的纯逻辑层：请求体、响应解析、尺寸校验、x-ide-sign、SSE 帧。
 *
 * 与 dsh-connect-workbuddy 的 image-gen.ts 同一分工——本文件只做纯函数与
 * 常量，不发网络请求；网络与工具注册在 image-tool.ts。
 *
 * 协议事实来自 2026-10-25 对 Trae CN 账号的活体探测（tests/live-probe*.spec.ts，
 * 结果存 probe2/3/4/5-results.jsonl）：
 *   - POST {chat}/api/ide/v1/tool_text_to_image，请求体只有 {prompt, image_size?}
 *     被接受；多发 mode_type/request_type/chat_mode/session_id/access_type/
 *     image_urls/watermark 等任何已知字段都会被网关 400 拒绝（空 body）。
 *     未知字段被忽略（camelCase 字段能过）。
 *   - 成功应答是扁平 JSON {message: "success", uri: "<tos 对象 key>"}；
 *     业务失败是扁平 {code: 3003, message: "…"}。没有 {code:0,data} envelope。
 *   - image_size 校验在 Ark 侧：格式 'WIDTHxHEIGHT' 或预设 2k/3k/4k，
 *     总像素 ∈ [3686400, 16777216]（512x512 与 1024x1024 会被拒）；
 *     缺省时输出 1920x1920。
 *   - 同一路径支持 GET：?prompt=<P>&image_size=<S> + x-ide-sign 头。GET 会
 *     按 (prompt, size) 查找该用户的既有缓存图：命中直接返回 uri（免费，不
 *     重新生成），未命中才真正生成（计费）。桌面端取图用的正是这个 GET。
 *     —— 故 POST 生成之后必须立刻 GET 同一 (prompt, size) 才能把图片字节
 *     下载下来；这是图片链路的组成部分，不是第二次计费。
 *   - SSE 端点 tool_text_to_image_stream 的事件名是小写：heartbeat（data:
 *     {timestamp_ms, status}）、result（data: {uri}）、done（data:
 *     {finish_reason}）。
 *   - 计费锚点：1920x1920 一张 ≈ 8.8 积分。
 *
 * @module dsh-connect-trae/image-gen-trae
 */

import { createHash } from 'node:crypto'

/** 文生图（同步）：一次 POST 拿回结果。Trae 客户端的 ToolText2Image 用的就是它。 */
export const TRAE_TOOL_TEXT_TO_IMAGE_PATH = '/api/ide/v1/tool_text_to_image'
/** 文生图（SSE）：heartbeat/result/done 帧。 */
export const TRAE_TOOL_TEXT_TO_IMAGE_STREAM_PATH = '/api/ide/v1/tool_text_to_image_stream'
/** 文生视频（SSE-only）。工具尚未暴露（见 image-tool.ts 的说明），常量先行留档。 */
export const TRAE_TOOL_TEXT_TO_VIDEO_STREAM_PATH = '/api/ide/v1/tool_text_to_video_stream'

/** 上游为图像工具固定的模型 id；请求体里没有 model 字段，服务端自选。 */
export const TRAE_IMAGE_MODEL = 'seedream_5'
/** 上游为视频工具固定的模型 id。 */
export const TRAE_VIDEO_MODEL = 'seedance2-fast'

/** 服务端缺省尺寸（实测 uri 后缀 1920x1920）；请求缺省即出这个。 */
export const DEFAULT_TRAE_IMAGE_SIZE = '1920x1920'

/** 尺寸预设：活体确认 '2k','3k','4k' 被 Ark 接受，square/square_hd 等
 *  客户端预设名服务端也会翻译（square_hd 实测出 1920x1920）。 */
export const TRAE_IMAGE_SIZE_PRESETS: readonly string[] = ['2k', '3k', '4k', 'square', 'square_hd', 'landscape', 'portrait']

/** 总像素下限/上限（Ark 报错原文里的数字）。 */
export const TRAE_IMAGE_MIN_PIXELS = 3686400
export const TRAE_IMAGE_MAX_PIXELS = 16777216

/** out/main.js 资源拦截器里写死的签名盐。 */
export const TRAE_IMAGE_SIGN_SALT = 'D39&a9..f0+c2-b5e.@'

/** 生图失败码。语义与 dsh-connect-workbuddy 的同名码保持一致。 */
export type TraeImageErrorCode =
  | 'INVALID_ARGS'
  | 'NOT_LOGGED_IN'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'NO_ROUTE'
  | 'UPSTREAM'
  | 'EMPTY_RESULT'
  | 'COOLDOWN'

export class TraeImageError extends Error {
  readonly code: TraeImageErrorCode
  /** 上游业务码（响应里的 code 字段），只在 UPSTREAM 类失败上有值。 */
  readonly serverCode: number | undefined

  constructor(message: string, code: TraeImageErrorCode, serverCode?: number) {
    super(message)
    this.name = 'TraeImageError'
    this.code = code
    this.serverCode = typeof serverCode === 'number' ? serverCode : undefined
  }
}

/** 请求体的完整形态：只有这两个字段会被网关接受（多余已知字段 → 400 空 body）。 */
export interface TraeImageRequestBody {
  prompt: string
  /** 可缺省：服务端自选 1920x1920。 */
  image_size?: string
}

export interface TraeImageRequestInput {
  readonly prompt: string
  /** 'WIDTHxHEIGHT'（总像素 ∈ [3686400,16777216]）或预设 2k/3k/4k/square/…。 */
  readonly size?: string
}

/** 尺寸合法性：预设名，或 宽x高 且总像素在 Ark 的 [下限,上限] 区间。 */
export function isTraeImageSize(value: string): boolean {
  if (TRAE_IMAGE_SIZE_PRESETS.includes(value)) return true
  const m = /^([0-9]{3,5})x([0-9]{3,5})$/.exec(value)
  if (m === null) return false
  const pixels = Number(m[1]) * Number(m[2])
  return pixels >= TRAE_IMAGE_MIN_PIXELS && pixels <= TRAE_IMAGE_MAX_PIXELS
}

/** 组一次文生图请求体；参数毛病全在这里拦下（INVALID_ARGS，不花积分）。 */
export function buildTraeImageBody(input: TraeImageRequestInput): TraeImageRequestBody {
  const prompt = input.prompt.trim()
  if (prompt === '') throw new TraeImageError('trae image: prompt 必须是非空字符串。', 'INVALID_ARGS')
  const out: { prompt: string, image_size?: string } = { prompt }
  if (input.size !== undefined && input.size !== '') {
    const size = input.size.trim().toLowerCase()
    if (!isTraeImageSize(size)) {
      throw new TraeImageError(
        'trae image: 尺寸「' + size + '」不被接受（需 宽x高 且总像素 ∈ ['
        + TRAE_IMAGE_MIN_PIXELS + ',' + TRAE_IMAGE_MAX_PIXELS + ']，或预设 ' + TRAE_IMAGE_SIZE_PRESETS.join('/') + '）。',
        'INVALID_ARGS',
      )
    }
    out.image_size = size
  }
  return out
}

/**
 * 取图 GET 的完整 URL：与生成同路径，prompt 与 image_size 走查询参数。
 *
 * **实测结论：这条 GET 不是取图，而是又一次生成。** 2026-10-26 的决定性探针：
 * POST 拿到 uri …1792954795741_44f94116_jpeg_1920x1920 之后，紧接着用同一
 * (prompt, size) 打这条 GET，回来的是**另一个** uri …1792954810505_b107ac11_…，
 * 耗时 27 秒，一个像素都没有——等于又画了一张、又扣一次积分（两次共约 17.6）。
 * 更早的非法尺寸探针（100x100）也印证了同一件事：报错直接来自 Ark 的
 * "[callArkImageGeneration] … image size must be at least 3686400 pixels"。
 *
 * 所以发版代码**不再调用它**（保留仅为测试与将来可能的探测）。Trae 客户端
 * 能显示这张图，说明另有一条按 uri 取字节的通道（iCube material 的
 * get_url + x-icube-token，基址来自运行时 boot config），还没打通。
 */
export function traeImageFetchUrl(baseUrl: string, prompt: string, size: string | undefined): string {
  const u = new URL(TRAE_TOOL_TEXT_TO_IMAGE_PATH, baseUrl)
  u.searchParams.set('prompt', prompt)
  u.searchParams.set('image_size', (size ?? DEFAULT_TRAE_IMAGE_SIZE).toLowerCase())
  return u.toString()
}

/** 应答里图片地址的字段名。活体看到的就是 uri；其余字段是 Rust 端
 *  ToolcallResultImage 的字段池（tos_uri/display_url/…），留给未来形态。 */
export const TRAE_IMAGE_URL_FIELDS: readonly string[] = [
  'uri',
  'tos_uri',
  'display_url',
  'image_url',
  'original_url',
  'preview_url',
  'internal_url',
]

export interface TraeImageOutcome {
  /** tos 对象 key（如 tos-cn-i-zaeny81f73/cn/<uid>/gen_image/<ts>_<hex>_jpeg_1920x1920）。 */
  readonly url: string
  /** 上游若回吐扣费数字，带出来；没有就诚实缺省。 */
  readonly credit?: number
}

/** 深度不超过 4 地扫第一个可用 URL 字段；再深的嵌套不是这个 API 的形态。 */
function findImageUrl(node: unknown, depth = 0): string | undefined {
  if (depth > 4 || node === null || typeof node !== 'object') return undefined
  const record = node as Record<string, unknown>
  for (const field of TRAE_IMAGE_URL_FIELDS) {
    const value = record[field]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === 'object') {
      const found = findImageUrl(value, depth + 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function findCredit(node: unknown, depth = 0): number | undefined {
  if (depth > 4 || node === null || typeof node !== 'object') return undefined
  const record = node as Record<string, unknown>
  const credit = record.credit
  if (typeof credit === 'number' && Number.isFinite(credit)) return credit
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === 'object') {
      const found = findCredit(value, depth + 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/**
 * 解析 tool_text_to_image 的扁平 JSON 应答。
 *
 * 实测形态：成功 {message:"success", uri:"…"}；失败 {code:3003, message:"…"}。
 * code 存在且非 0 → UPSTREAM（原样抛出 code/message——余额不足、风控、
 * Ark 参数错误全靠它浮出）；无 code 但 uri 缺失 → EMPTY_RESULT。
 */
export function parseTraeImageResponse(json: unknown): TraeImageOutcome {
  const record = (json !== null && typeof json === 'object' ? json : {}) as Record<string, unknown>
  const code = typeof record.code === 'number' ? record.code : undefined
  const message = typeof record.message === 'string' ? record.message : undefined
  if (code !== undefined && code !== 0) {
    throw new TraeImageError(
      'trae image: 上游业务错误 code=' + code + (message === undefined || message === '' ? '' : ': ' + message),
      'UPSTREAM',
      code,
    )
  }
  const url = findImageUrl(record)
  if (url === undefined) {
    throw new TraeImageError(
      'trae image: 应答里没有图片地址' + (message === undefined ? '' : '（message=' + message + '）'),
      'EMPTY_RESULT',
      code,
    )
  }
  const credit = findCredit(record)
  return credit === undefined ? { url } : { url, credit }
}

/**
 * x-ide-sign：GET 带 prompt 与 image_size 查询参数的 Trae 图片 URL 时必须
 * 带上（out/main.js 拦截器原样实现：md5(prompt 小写 + image_size + 盐)）。
 */
export function computeTraeIdeSign(promptLower: string, imageSize: string): string {
  return createHash('md5').update(promptLower + imageSize + TRAE_IMAGE_SIGN_SALT).digest('hex')
}

/** 从图片 URL 里读出签名所需的两个查询参数；缺一即"不需要签名"。 */
export function traeImageSignFields(url: string): { prompt: string, image_size: string } | undefined {
  try {
    const u = new URL(url)
    const prompt = u.searchParams.get('prompt')
    const size = u.searchParams.get('image_size')
    if (prompt === null || size === null) return undefined
    return { prompt: prompt.toLowerCase(), image_size: size }
  } catch {
    return undefined
  }
}

/** SSE 流式端点的事件名（活体探测 4 实测：小写 result/done/heartbeat）。 */
export type TraeImageStreamEvent = 'result' | 'done' | 'heartbeat' | 'error'

/** 解一条 SSE 帧的 event:/data: 行；未知事件返回 undefined。 */
export function parseTraeImageStreamFrame(block: string): { event: TraeImageStreamEvent, data: unknown } | undefined {
  let event: string | undefined
  const dataLines: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
  }
  if (event !== 'result' && event !== 'done' && event !== 'heartbeat' && event !== 'error') {
    return undefined
  }
  let data: unknown
  try {
    data = dataLines.length > 0 ? JSON.parse(dataLines.join('\n')) : {}
  } catch {
    data = { raw: dataLines.join('\n') }
  }
  return { event, data }
}
