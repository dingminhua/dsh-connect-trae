/**
 * The retrieval hop, pinned from the request side.
 *
 * Measured on #62 (2026-10-26, CN personal account): the old "download" GET on
 * tool_text_to_image with the same (prompt, size) came back with a *different*
 * uri after 27s — it was a second generation, so every image quietly cost two.
 * The real hop is two steps and free: POST /api/ide/v1/get_resource_url with
 * { uri_list: [key] } -> { url_map: { key: signed CDN url } }, then a plain GET
 * of that signed url (1,155,578 bytes of JPEG in the live probe).
 */
import { describe, expect, it } from 'vitest'
import { TraeImageClient, type TraeImageAccount } from '../src/image-tool.ts'
import { TraeImageError } from '../src/image-gen-trae.ts'

const KEY = 'tos-cn-i-zaeny81f73/cn/1905882027265802/gen_image/1792952678813_3a22ca8a_jpeg_2160x3840'
const SIGNED = 'https://p3-copilot-multimodal-sign.byteimg.com/' + KEY + '~tplv-zaeny81f73-image.image?x-expires=1792956467&x-signature=CB%2BMMi1FaftuKbpT7Fy4kMLPo1w%3D'
const PROMPT = '一只盯镜头的橘猫'
const SIZE = '2160x3840'

const ACCOUNT = {
  credential: {
    accessToken: 'tok-123',
    userId: '1905882027265802',
    host: 'https://trae-api-cn.mchost.guru',
    expiresAtMs: 0,
    edition: 'cn',
    source: 'desktop',
  },
  identity: { edition: 'cn', machineId: 'machine', deviceId: 'device', platform: 'win32' },
  baseUrl: 'https://trae-api-cn.mchost.guru',
} as unknown as TraeImageAccount

interface Call {
  readonly url: string
  readonly method: string
  readonly headers: Record<string, string>
  readonly body: string | undefined
}

/** 三跳都模拟：生成 → 解析签名地址 → 下载字节。 */
function stubFetch(urlMap: Record<string, string>): { fetchImpl: typeof fetch, calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: unknown, init?: { method?: string, headers?: Record<string, string>, body?: string }) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    })
    if (url.includes('/api/ide/v1/tool_text_to_image')) {
      return new Response(JSON.stringify({ message: 'success', uri: KEY }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.includes('/api/ide/v1/get_resource_url')) {
      return new Response(JSON.stringify({ url_map: urlMap }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), {
      status: 200,
      headers: { 'content-type': 'image/jpeg' },
    })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('trae_draw_image retrieval', () => {
  it('posts the generation, resolves the signed url, downloads the bytes — and nothing else', async () => {
    const { fetchImpl, calls } = stubFetch({ [KEY]: SIGNED })
    const client = new TraeImageClient({ fetchImpl })
    const outcome = await client.generate(ACCOUNT, { prompt: PROMPT, size: SIZE })

    expect(calls.map(call => {
      const url = new URL(call.url)
      return call.method + ' ' + url.host + url.pathname
    })).toEqual([
      'POST trae-api-cn.mchost.guru/api/ide/v1/tool_text_to_image',
      'POST trae-api-cn.mchost.guru/api/ide/v1/get_resource_url',
      'GET p3-copilot-multimodal-sign.byteimg.com/' + KEY + '~tplv-zaeny81f73-image.image',
    ])
    // 那条 ?prompt=&image_size= 的 GET 是又一次生成，一次都不许出现。
    expect(calls.some(call => call.url.includes('image_size='))).toBe(false)

    expect(JSON.parse(calls[1]?.body ?? '{}')).toEqual({ uri_list: [KEY] })
    expect(outcome.url).toBe(KEY)
    expect(outcome.mimeType).toBe('image/jpeg')
    expect([...outcome.bytes]).toEqual([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
  })

  it('still posts the gateway header set the endpoints require', async () => {
    const { fetchImpl, calls } = stubFetch({ [KEY]: SIGNED })
    const client = new TraeImageClient({ fetchImpl })
    await client.generate(ACCOUNT, { prompt: PROMPT, size: SIZE })

    const post = calls[0]
    expect(post?.headers['x-app-id']).toBe('6eefa01c-1036-4c7e-9ca5-d891f63bfcd8')
    expect(post?.headers['x-plugin-channel']).toBe('icube-ai')
    expect(post?.headers['Authorization']).toBe('Cloud-IDE-JWT tok-123')
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ prompt: PROMPT, image_size: SIZE })

    // 解析请求同样是网关调用，带同一套头。
    expect(calls[1]?.headers['x-app-id']).toBe('6eefa01c-1036-4c7e-9ca5-d891f63bfcd8')
    // CDN 不需要 Trae 头：签名在 query 里。
    expect(calls[2]?.headers['Authorization']).toBeUndefined()
    expect(calls[2]?.headers['Accept']).toBe('image/*')
  })

  it('fails loudly when the server hands back an empty url_map', async () => {
    const { fetchImpl } = stubFetch({})
    const client = new TraeImageClient({ fetchImpl })
    const error = await client.generate(ACCOUNT, { prompt: PROMPT, size: SIZE })
      .then(() => undefined, (thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(TraeImageError)
    expect((error as TraeImageError).code).toBe('IMAGE_UNAVAILABLE')
    expect((error as Error).message).toContain(KEY)
    expect((error as Error).message).toContain('积分已经扣了')
  })
})
