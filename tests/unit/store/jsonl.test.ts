import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseJsonl, stripBom } from '../../../src/main/store/jsonl'

const Line = z.looseObject({ id: z.string(), n: z.number() })

describe('parseJsonl', () => {
  it('读出好行，跳过坏行并返回行号（空行不算坏行）', () => {
    const text = [
      '{"id":"a","n":1}', // 1 好行
      '{坏行', // 2 不是 JSON
      '{"id":"c","n":3}\r', // 3 CRLF 结尾也能读
      '{"id":"d"}', // 4 缺字段
      '', // 5 空行
      '{"id":"f","n":6', // 6 被截断的半行
    ].join('\n')
    const { items, skipped } = parseJsonl(text, Line)
    expect(items.map((item) => item.id)).toEqual(['a', 'c'])
    expect(skipped.map((s) => s.line)).toEqual([2, 4, 6])
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true)
  })

  it('开头的 BOM 会被去掉', () => {
    const { items, skipped } = parseJsonl('﻿{"id":"a","n":1}\n', Line)
    expect(items).toHaveLength(1)
    expect(skipped).toEqual([])
  })

  it('空文本返回空结果', () => {
    expect(parseJsonl('', Line)).toEqual({ items: [], skipped: [] })
  })

  it('保留用户手动加的字段', () => {
    const { items } = parseJsonl('{"id":"a","n":1,"note":"手写"}\n', Line)
    expect(items[0]).toMatchObject({ note: '手写' })
  })
})

describe('stripBom', () => {
  it('只去掉开头的 BOM', () => {
    expect(stripBom('﻿abc')).toBe('abc')
    expect(stripBom('abc')).toBe('abc')
  })
})
