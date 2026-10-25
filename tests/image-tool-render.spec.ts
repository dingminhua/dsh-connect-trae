/**
 * What the tool hands back: the image bytes, written under the session cwd, and
 * a markdown image pointing at that relative path.
 *
 * DSH resolves markdown image paths against the session cwd and reads them
 * through the host's authenticated `api/file` route, so a relative path is all
 * the render layer needs. The tos key stays in the output for forensics only —
 * it must never be spliced into `![](...)`.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import {
  createTraeDrawImageTool,
  type TraeImageAccount,
  type TraeImageGenerated,
  type TraeToolDefinition,
} from '../src/image-tool.ts'
import { TraeImageError, type TraeImageErrorCode } from '../src/image-gen-trae.ts'

const ACCOUNT = {} as unknown as TraeImageAccount

const TOS_KEY = 'tos-cn-i-zaeny81f73/cn/1905882027265802/gen_image/1792952678813_3a22ca8a_jpeg_2160x3840'
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

const temporaryDirs: string[] = []

async function workDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'trae-image-tool-'))
  temporaryDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function toolReturning(result: TraeImageGenerated): TraeToolDefinition {
  return createTraeDrawImageTool({
    resolveAccount: async () => ACCOUNT,
    generate: async () => result,
    logger: { warn() {} },
  })
}

function generated(mimeType = 'image/jpeg'): TraeImageGenerated {
  return { url: TOS_KEY, bytes: JPEG, mimeType }
}

async function run(tool: TraeToolDefinition, cwd: string, args: Record<string, unknown> = { prompt: '猫' }) {
  const value = await tool.execute(args, { agent: { session: { cwd } } })
  return { value, text: tool.output.render(args, value)[0]?.text ?? '' }
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
  it('writes the bytes under trae-images/ and draws a markdown image at the relative path', async () => {
    const cwd = await workDir()
    const { value, text } = await run(toolReturning(generated()), cwd)

    const path = value['path']
    expect(typeof path).toBe('string')
    expect(path).toMatch(/^trae-images\/trae-[0-9]{8}-[0-9]{6}-[0-9a-f]{6}\.jpg$/)
    // 字节真的落到了会话目录里。
    expect([...await readFile(join(cwd, String(path)))]).toEqual([...JPEG])
    // 渲染出真正的 markdown 图片，且用的是相对路径（不是 tos key）。
    expect(text.startsWith('![Trae 文生图](trae-images/')).toBe(true)
    expect(text).not.toContain(TOS_KEY)
    expect(value['url']).toBe(TOS_KEY)
  })

  it('keeps the png suffix when the download says png', async () => {
    const cwd = await workDir()
    const { value } = await run(toolReturning(generated('image/png')), cwd)
    expect(String(value['path'])).toMatch(/\.png$/)
  })

  it('echoes the credit the upstream reported', async () => {
    const cwd = await workDir()
    const { text } = await run(toolReturning({ ...generated(), credit: 12.5 }), cwd)
    expect(text).toContain('消耗 12.5 积分')
  })

  it('carries the hint that says not to rerun for the bytes', async () => {
    const cwd = await workDir()
    const { text } = await run(toolReturning(generated()), cwd)
    expect(text).toContain('不要为了取图或换张重跑')
  })

  it('falls back to the object key as inline code when no file path exists', async () => {
    const tool = toolReturning(generated())
    const text = tool.output.render({}, { url: TOS_KEY, model: 'seedream_5', prompt: '猫', size: '1920x1920', hint: '' })[0]?.text ?? ''
    expect(text).toContain('图片已生成，但字节没取回来')
    expect(text).toContain('`' + TOS_KEY + '`')
    expect(text).not.toContain('![')
  })

  it('reports IMAGE_UNAVAILABLE (not success) when the file cannot be written', async () => {
    const parent = await workDir()
    // 把 cwd 指成一个普通文件：mkdir <file>/trae-images 必然失败。
    const blocked = join(parent, 'not-a-dir')
    await writeFile(blocked, 'x')
    const tool = toolReturning(generated())
    const error = await rejection(tool.execute({ prompt: '猫' }, { agent: { session: { cwd: blocked } } }))

    expect(error).toBeInstanceOf(TraeImageError)
    expect((error as TraeImageError).code).toBe('IMAGE_UNAVAILABLE')
    expect((error as Error).message).toContain(TOS_KEY)
  })
})

describe('trae_draw_image cooldown', () => {
  it('cools down after a billable failure, so a retry cannot buy a second image', async () => {
    const cwd = await workDir()
    const tool = failingTool('上游 502', 'UPSTREAM')
    const first = await rejection(tool.execute({ prompt: '猫' }, { agent: { session: { cwd } } }))
    expect((first as TraeImageError).code).toBe('UPSTREAM')
    const second = await rejection(tool.execute({ prompt: '猫' }, { agent: { session: { cwd } } }))
    expect((second as TraeImageError).code).toBe('COOLDOWN')
    expect((second as Error).message).toContain('秒后再试')
  })

  it('also cools down when the image was generated but the bytes were lost', async () => {
    const cwd = await workDir()
    const tool = failingTool('url_map 里没有这个 key', 'IMAGE_UNAVAILABLE')
    await rejection(tool.execute({ prompt: '猫' }, { agent: { session: { cwd } } }))
    const again = await rejection(tool.execute({ prompt: '猫' }, { agent: { session: { cwd } } }))
    expect((again as TraeImageError).code).toBe('COOLDOWN')
  })

  it('keeps a failure that spent nothing retryable', async () => {
    const cwd = await workDir()
    const tool = failingTool('尺寸不被接受', 'INVALID_ARGS')
    await rejection(tool.execute({ prompt: '猫' }, { agent: { session: { cwd } } }))
    const again = await rejection(tool.execute({ prompt: '猫' }, { agent: { session: { cwd } } }))
    expect((again as TraeImageError).code).toBe('INVALID_ARGS')
  })
})
