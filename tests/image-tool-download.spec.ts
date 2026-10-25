/**
 * The hop that is NOT there any more, pinned from the request side.
 *
 * Measured on #62 (2026-10-26, CN personal account): after a POST returned
 * `…/1792954795741_44f94116_jpeg_1920x1920`, a GET with the same (prompt, size)
 * came back with a *different* uri — `…/1792954810505_b107ac11_jpeg_1920x1920` —
 * after 27 seconds and not a single pixel. The "download" was a second
 * generation; every image quietly cost two. So the client must make exactly one
 * request per generation, and the tool must never surface a local path.
 */
import { describe, expect, it } from 'vitest'
import { TraeImageClient, type TraeImageAccount } from '../src/image-tool.ts'

const KEY = 'tos-cn-i-zaeny81f73/cn/1905882027265802/gen_image/1792952678813_3a22ca8a_jpeg_2160x3840'
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

function stubFetch(body: string): { fetchImpl: typeof fetch, calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: unknown, init?: { method?: string, headers?: Record<string, string>, body?: string }) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    })
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

describe('trae_draw_image generation', () => {
  it('makes exactly one request and returns only the object key', async () => {
    const { fetchImpl, calls } = stubFetch(JSON.stringify({ message: 'success', uri: KEY }))
    const client = new TraeImageClient({ fetchImpl })
    const outcome = await client.generate(ACCOUNT, { prompt: PROMPT, size: SIZE })

    // One request. The second one used to be a billed regeneration.
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('POST')
    expect(outcome.url).toBe(KEY)
    // No local file, no path field: the bytes are simply not available.
    expect(Object.keys(outcome)).toEqual(['url'])
  })

  it('still posts the gateway header set the endpoint requires', async () => {
    const { fetchImpl, calls } = stubFetch(JSON.stringify({ message: 'success', uri: KEY }))
    const client = new TraeImageClient({ fetchImpl })
    await client.generate(ACCOUNT, { prompt: PROMPT, size: SIZE })

    const post = calls[0]
    expect(post?.headers['x-app-id']).toBe('6eefa01c-1036-4c7e-9ca5-d891f63bfcd8')
    expect(post?.headers['x-plugin-channel']).toBe('icube-ai')
    expect(post?.headers['Authorization']).toBe('Cloud-IDE-JWT tok-123')
    const url = new URL(post?.url ?? '')
    expect(url.pathname).toBe('/api/ide/v1/tool_text_to_image')
    expect(JSON.parse(post?.body ?? '{}')).toEqual({ prompt: PROMPT, image_size: SIZE })
  })
})
