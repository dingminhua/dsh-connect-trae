import { describe, expect, it } from 'vitest'
import {
  TRAE_IMAGE_MAX_PIXELS,
  TRAE_IMAGE_MIN_PIXELS,
  TraeImageError,
  buildTraeImageBody,
  buildTraeResourceUrlBody,
  isTraeImageSize,
  parseTraeImageResponse,
  parseTraeImageStreamFrame,
  parseTraeResourceUrlMap,
  signedTraeResourceUrl,
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

describe('buildTraeResourceUrlBody', () => {
  it('只产出 uri_list，且去掉首尾空白', () => {
    expect(buildTraeResourceUrlBody('  tos-cn-i-x/cn/1/gen_image/a  ')).toEqual({
      uri_list: ['tos-cn-i-x/cn/1/gen_image/a'],
    })
    // 请求体形态是实测出来的：换任何别的字段名/结构，上游只回 200 + 空 url_map。
    expect(Object.keys(buildTraeResourceUrlBody('k'))).toEqual(['uri_list'])
  })

  it('空 uri 就地抛 INVALID_ARGS（一分钱没花，也不该说成图已生成）', () => {
    for (const uri of ['', '   ', '\n\t']) {
      const error = (() => {
        try { buildTraeResourceUrlBody(uri) } catch (thrown: unknown) { return thrown }
        return undefined
      })()
      expect(error).toBeInstanceOf(TraeImageError)
      expect((error as TraeImageError).code).toBe('INVALID_ARGS')
    }
  })
})

describe('parseTraeResourceUrlMap', () => {
  it('解出 url_map 并去掉首尾空白', () => {
    expect(parseTraeResourceUrlMap({ url_map: { k: ' https://cdn/x?sig=1 ' } })).toEqual({ k: 'https://cdn/x?sig=1' })
  })

  it('对认不出的形状一律回空表（上游对坏 key 就是这么回的，不报错）', () => {
    for (const json of [null, undefined, 'x', 42, [], {}, { url_map: null }, { url_map: 'x' }, { url_map: [] }]) {
      expect(parseTraeResourceUrlMap(json)).toEqual({})
    }
  })

  it('丢弃非字符串与空串条目', () => {
    const map = parseTraeResourceUrlMap({ url_map: { a: ' https://cdn/a ', b: '', c: '   ', d: 1, e: null, f: {} } })
    expect(map).toEqual({ a: 'https://cdn/a' })
  })
})

describe('signedTraeResourceUrl', () => {
  it('取到该 uri 的签名地址', () => {
    const key = 'tos-cn-i-x/cn/1/gen_image/a'
    expect(signedTraeResourceUrl({ url_map: { [key]: 'https://cdn/signed' } }, key)).toBe('https://cdn/signed')
  })

  it('url_map 里没有这个 key 时抛 IMAGE_UNAVAILABLE 并带上 key（图已生成、积分已扣）', () => {
    const key = 'tos-cn-i-x/cn/1/gen_image/missing'
    const error = (() => {
      try { signedTraeResourceUrl({ url_map: { other: 'https://cdn/x' } }, key) } catch (thrown: unknown) { return thrown }
      return undefined
    })()
    expect(error).toBeInstanceOf(TraeImageError)
    expect((error as TraeImageError).code).toBe('IMAGE_UNAVAILABLE')
    expect((error as Error).message).toContain(key)
    expect((error as Error).message).toContain('积分已经扣了')
  })
})
