/**
 * What the tool hands back — and, more importantly, what it stops doing.
 *
 * Measured twice on #62: the call reported success with a broken markdown image
 * while the account had already been charged, and the "retrieval" GET turned out
 * to be a second generation (a fresh uri, 27s, ~8.8 more credits). So the tool
 * now never fetches: it returns the tos object key as inline code, which is the
 * only thing it can honestly hand over. These tests pin that contract so the
 * fetch hop cannot creep back in.
 */
import { describe, expect, it } from 'vitest'
import {
  createTraeDrawImageTool,
  type TraeImageAccount,
  type TraeImageGenerated,
  type TraeToolDefinition,
} from '../src/image-tool.ts'
import { TraeImageError, type TraeImageErrorCode } from '../src/image-gen-trae.ts'

const ACCOUNT = {} as unknown as TraeImageAccount

const TOS_KEY = 'tos-cn-i-zaeny81f73/cn/1905882027265802/gen_image/1792952678813_3a22ca8a_jpeg_2160x3840'

function toolReturning(result: TraeImageGenerated): TraeToolDefinition {
  return createTraeDrawImageTool({
    resolveAccount: async () => ACCOUNT,
    generate: async () => result,
    logger: { warn() {} },
  })
}

async function rendered(result: TraeImageGenerated, size?: string): Promise<string> {
  const tool = toolReturning(result)
  const value = await tool.execute(size === undefined ? { prompt: '猫' } : { prompt: '猫', size }, {})
  return tool.output.render({}, value)[0]?.text ?? ''
}

function failingTool(message: string, code: TraeImageErrorCode): TraeToolDefinition {
  return createTraeDrawImageTool({
    resolveAccount: async () => ACCOUNT,
    generate: async () => { throw new TraeImageError(message, code) },
    logger: { warn() {} },
  })
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  return work.then(() => undefined, (error: unknown) => error)
}

describe('trae_draw_image render', () => {
  it('shows the object key as inline code and never as a markdown image', async () => {
    const text = await rendered({ url: TOS_KEY })
    expect(text.startsWith('图片对象 key（不能直接打开）：`' + TOS_KEY + '`')).toBe(true)
    expect(text).not.toContain('![')
  })

  it('echoes the credit the upstream reported', async () => {
    const text = await rendered({ url: TOS_KEY, credit: 12.5 })
    expect(text).toContain('消耗 12.5 积分')
  })

  it('carries the hint that says not to retry for the bytes', async () => {
    const text = await rendered({ url: TOS_KEY })
    expect(text).toContain('不能直接打开')
    expect(text).toContain('不要为了取图')
  })
})

describe('trae_draw_image cooldown', () => {
  it('cools down after a billable failure, so a retry cannot buy a second image', async () => {
    const tool = failingTool('上游 502', 'UPSTREAM')
    const first = await rejection(tool.execute({ prompt: '猫' }, {}))
    expect((first as TraeImageError).code).toBe('UPSTREAM')
    const second = await rejection(tool.execute({ prompt: '猫' }, {}))
    expect((second as TraeImageError).code).toBe('COOLDOWN')
    expect((second as Error).message).toContain('秒后再试')
  })

  it('keeps a failure that spent nothing retryable', async () => {
    const tool = failingTool('尺寸不被接受', 'INVALID_ARGS')
    await rejection(tool.execute({ prompt: '猫' }, {}))
    const again = await rejection(tool.execute({ prompt: '猫' }, {}))
    expect((again as TraeImageError).code).toBe('INVALID_ARGS')
  })
})
