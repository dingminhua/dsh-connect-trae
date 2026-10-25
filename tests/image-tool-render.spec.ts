/**
 * What the tool hands back once the bytes arrive — and what it refuses to hand
 * back when they do not.
 *
 * Measured run (see #62): the call reported success with a broken markdown image
 * and the same error twice, while the account had already been charged. Now the
 * retrieval hop is part of the contract: no bytes → tool failure, no credit lost
 * silently, and a cooldown so the model cannot buy a second image by retrying.
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
const LOCAL_PATH = '/tmp/trae-image-gen/seedream_5-x.png'

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
  it('draws the local file and never the object key as an image', async () => {
    const text = await rendered({ url: TOS_KEY, path: LOCAL_PATH })
    expect(text.startsWith('![Trae 文生图](' + LOCAL_PATH + ')')).toBe(true)
    expect(text).toContain('本地文件：' + LOCAL_PATH)
    // The tos key must not leak into the markdown: it is not a path.
    expect(text).not.toContain(TOS_KEY)
  })

  it('echoes the credit the upstream reported', async () => {
    const text = await rendered({ url: TOS_KEY, path: LOCAL_PATH, credit: 12.5 })
    expect(text).toContain('消耗 12.5 积分')
  })
})

describe('trae_draw_image when the bytes never arrive', () => {
  it('fails the call instead of returning a key without pixels', async () => {
    const tool = failingTool('图片已经生成并计费，但字节取不回来', 'IMAGE_UNAVAILABLE')
    const error = await rejection(tool.execute({ prompt: '猫' }, {}))
    expect(error).toBeInstanceOf(TraeImageError)
    expect((error as TraeImageError).code).toBe('IMAGE_UNAVAILABLE')
  })

  it('cools down, so a retry cannot buy a second image', async () => {
    const tool = failingTool('图片已经生成并计费，但字节取不回来', 'IMAGE_UNAVAILABLE')
    await rejection(tool.execute({ prompt: '猫' }, {}))
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
