/**
 * The download hop's request shape, and what happens when it answers with a body
 * instead of pixels.
 *
 * Measured failure (CN personal account, 2026-10-26): a GET carrying only
 * `Authorization` + `x-ide-sign` came back `{"code":3003,"message":"... failed to
 * get app config: record not found"}`. The gateway resolves the app config from
 * the ordinary header set first, so this hop has to look like every other Trae
 * request and only *add* the signature.
 *
 * That GET is also not a free cache lookup: an illegal-size probe reached Ark's
 * own image generation. So a JSON answer here means the image was billed and the
 * bytes are gone — the call must fail, naming the key and the money.
 */
import { describe, expect, it } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { TraeImageClient, type TraeImageAccount } from '../src/image-tool.ts'
import { TraeImageError, computeTraeIdeSign } from '../src/image-gen-trae.ts'

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
}

/** POST answers with the object key; the GET is whatever the test wants back. */
function stubFetch(second: () => Response): { fetchImpl: typeof fetch, calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = (async (input: unknown, init?: { method?: string, headers?: Record<string, string> }) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
    })
    if (calls.length === 1) {
      return new Response(JSON.stringify({ message: 'success', uri: KEY }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    return second()
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  return work.then(() => undefined, (error: unknown) => error)
}

describe('trae_draw_image download hop', () => {
  it('sends the full gateway header set plus the signature', async () => {
    const { fetchImpl, calls } = stubFetch(() => new Response(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      { status: 200, headers: { 'content-type': 'image/png' } },
    ))
    const client = new TraeImageClient({ fetchImpl })
    const outcome = await client.generate(ACCOUNT, { prompt: PROMPT, size: SIZE })
    expect(outcome.url).toBe(KEY)

    const get = calls[1]
    expect(get?.method).toBe('GET')
    // Same identity the POST carried — the app-config lookup needs it.
    expect(get?.headers['x-app-id']).toBe(calls[0]?.headers['x-app-id'])
    expect(get?.headers['x-app-id']).toBe('6eefa01c-1036-4c7e-9ca5-d891f63bfcd8')
    expect(get?.headers['x-plugin-channel']).toBe('icube-ai')
    expect(get?.headers['Authorization']).toBe('Cloud-IDE-JWT tok-123')
    expect(get?.headers['x-ide-sign']).toBe(computeTraeIdeSign(PROMPT.toLowerCase(), SIZE.toLowerCase()))
    // The signature rides on top of a normal image request, not a JSON one.
    expect(get?.headers['Accept']?.startsWith('image/')).toBe(true)
    expect(get?.headers['Content-Type']).toBeUndefined()

    const url = new URL(get?.url ?? '')
    expect(url.pathname).toBe('/api/ide/v1/tool_text_to_image')
    expect(url.searchParams.get('prompt')).toBe(PROMPT)
    expect(url.searchParams.get('image_size')).toBe(SIZE)

    expect((await readFile(outcome.path)).byteLength).toBe(4)
    await rm(outcome.path, { force: true })
  })

  it('fails the whole call when the hop answers JSON instead of pixels', async () => {
    const body = '{"code":3003,"message":"model call failed: failed to get app config: record not found"}'
    const { fetchImpl } = stubFetch(() => new Response(body, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const client = new TraeImageClient({ fetchImpl })
    const error = await rejection(client.generate(ACCOUNT, { prompt: PROMPT, size: SIZE }))

    expect(error).toBeInstanceOf(TraeImageError)
    const failure = error as TraeImageError
    expect(failure.code).toBe('IMAGE_UNAVAILABLE')
    // The upstream's own words survive, so a bug report can be traced.
    expect(failure.message).toContain('"code":3003')
    // The key is surfaced: the picture still exists in the Trae client.
    expect(failure.message).toContain(KEY)
    // And the money is named, plus the "do not retry" verdict for this code.
    expect(failure.message).toContain('积分')
    expect(failure.message).toContain('换 prompt 重跑同样取不回')
  })
})
