import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRAE_IMAGE_SIZE,
  TRAE_IMAGE_MAX_PIXELS,
  TRAE_IMAGE_MIN_PIXELS,
  TraeImageError,
  buildTraeImageBody,
  computeTraeIdeSign,
  isTraeImageSize,
  parseTraeImageResponse,
  parseTraeImageStreamFrame,
  traeImageFetchUrl,
  traeImageSignFields,
} from '../src/image-gen-trae.ts'

describe('isTraeImageSize', () => {
  it('接受预设名', () => {
    for (const preset of ['2k', '3k', '4k', 'square', 'square_hd']) expect(isTraeImageSize(preset)).toBe(true)
  })

  it('接受像素区间内的 宽x高', () => {
    for (const size of ['1920x1920', '2048x2048', '4096x4096', '2304x1728']) expect(isTraeImageSize(size)).toBe(true)
  })

  it('拒绝区间外与非法格式', () => {
    for (const size of ['1024x1024', '512x512', '100x100', '4608x4608', 'abc', '1920*1920', '']) {
      expect(isTraeImageSize(size)).toBe(false)
    }
  })

  it('边界恰好可接受', () => {
    const side = Math.ceil(Math.sqrt(TRAE_IMAGE_MIN_PIXELS))
    expect(isTraeImageSize(side + 'x' + side)).toBe(true)
    const maxSide = Math.floor(Math.sqrt(TRAE_IMAGE_MAX_PIXELS))
    expect(isTraeImageSize(maxSide + 'x' + maxSide)).toBe(true)
    expect(isTraeImageSize('99999x99999')).toBe(false)
  })
})

describe('buildTraeImageBody', () => {
  it('只发 prompt 与 image_size 两个字段', () => {
    const body = buildTraeImageBody({ prompt: '  一只橘猫  ', size: '1920X1920' })
    expect(body).toEqual({ prompt: '一只橘猫', image_size: '1920x1920' })
  })

  it('尺寸缺省时不带 image_size（上游默认 1920x1920）', () => {
    expect(buildTraeImageBody({ prompt: 'cat' })).toEqual({ prompt: 'cat' })
  })

  it('空 prompt 抛 INVALID_ARGS', () => {
    expect(() => buildTraeImageBody({ prompt: '   ' })).toThrowError(TraeImageError)
    try { buildTraeImageBody({ prompt: ' ' }) } catch (e) { expect((e as TraeImageError).code).toBe('INVALID_ARGS') }
  })

  it('非法尺寸抛 INVALID_ARGS 且提示区间', () => {
    try {
      buildTraeImageBody({ prompt: 'cat', size: '1024x1024' })
      throw new Error('should throw')
    } catch (e) {
      expect(e).toBeInstanceOf(TraeImageError)
      const guard = e as TraeImageError
      expect(guard.code).toBe('INVALID_ARGS')
      expect(guard.message).toContain(String(TRAE_IMAGE_MIN_PIXELS))
    }
  })
})

describe('parseTraeImageResponse', () => {
  it('解析扁平成功应答', () => {
    const out = parseTraeImageResponse({ message: 'success', uri: 'tos-cn-i-x/cn/1/gen_image/2_a_jpeg_1920x1920' })
    expect(out.url).toBe('tos-cn-i-x/cn/1/gen_image/2_a_jpeg_1920x1920')
  })

  it('code 非 0 抛 UPSTREAM 并带 serverCode 与原文', () => {
    try {
      parseTraeImageResponse({ code: 3003, message: 'model call failed: size invalid' })
      throw new Error('should throw')
    } catch (e) {
      const guard = e as TraeImageError
      expect(guard).toBeInstanceOf(TraeImageError)
      expect(guard.code).toBe('UPSTREAM')
      expect(guard.serverCode).toBe(3003)
      expect(guard.message).toContain('size invalid')
    }
  })

  it('没有 uri 抛 EMPTY_RESULT', () => {
    try {
      parseTraeImageResponse({ message: 'success' })
      throw new Error('should throw')
    } catch (e) {
      expect((e as TraeImageError).code).toBe('EMPTY_RESULT')
    }
  })

  it('兼容 tos_uri/display_url 等历史字段', () => {
    expect(parseTraeImageResponse({ data: { tos_uri: 'k1' } }).url).toBe('k1')
    expect(parseTraeImageResponse({ data: { display_url: 'https://x/y.png' } }).url).toBe('https://x/y.png')
  })
})

describe('x-ide-sign', () => {
  it('签名是 md5(prompt小写 + image_size + 盐)', () => {
    const sign = computeTraeIdeSign('a cat', '1920x1920')
    expect(sign).toMatch(/^[0-9a-f]{32}$/)
    expect(computeTraeIdeSign('a cat', '1920x1920')).toBe(computeTraeIdeSign('a cat', '1920x1920'))
    expect(computeTraeIdeSign('a cat', '1920x1920')).not.toBe(computeTraeIdeSign('a cat', '2048x2048'))
  })

  it('从 URL 里读出签名参数', () => {
    const url = traeImageFetchUrl('https://trae-api-cn.mchost.guru', 'A Cat', '1920x1920')
    const fields = traeImageSignFields(url)
    expect(fields).toEqual({ prompt: 'a cat', image_size: '1920x1920' })
    expect(traeImageSignFields('https://x/y.png')).toBeUndefined()
  })

  it('取图 URL 用同一路径，缺省尺寸补 1920x1920', () => {
    const url = new URL(traeImageFetchUrl('https://gw.example', 'cat', undefined))
    expect(url.pathname).toBe('/api/ide/v1/tool_text_to_image')
    expect(url.searchParams.get('prompt')).toBe('cat')
    expect(url.searchParams.get('image_size')).toBe(DEFAULT_TRAE_IMAGE_SIZE)
  })
})

describe('parseTraeImageStreamFrame', () => {
  it('解出小写 result/done/heartbeat 帧', () => {
    const r = parseTraeImageStreamFrame('event: result\ndata: {"uri":"k1"}')
    expect(r?.event).toBe('result')
    expect(r?.data).toEqual({ uri: 'k1' })
    const d = parseTraeImageStreamFrame('event: done\ndata: {"finish_reason":"stop"}')
    expect(d?.event).toBe('done')
    const h = parseTraeImageStreamFrame('event: heartbeat\ndata: {"status":"processing"}')
    expect(h?.event).toBe('heartbeat')
  })

  it('未知事件返回 undefined', () => {
    expect(parseTraeImageStreamFrame('event: StreamResult\ndata: {}')).toBeUndefined()
    expect(parseTraeImageStreamFrame('data: {}')).toBeUndefined()
  })
})
