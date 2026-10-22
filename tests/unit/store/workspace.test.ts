import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { openWorkspace, type Workspace } from '../../../src/main/store/workspace'
import { makeTempDir } from './helpers'

const Doc = z.looseObject({ version: z.literal(1), items: z.array(z.string()) })
const Line = z.looseObject({ id: z.string(), n: z.number() })
const DOC = 'data/doc.json'
const LOG = 'data/log.jsonl'

let ctx: Awaited<ReturnType<typeof makeTempDir>>
let ws: Workspace
beforeEach(async () => {
  ctx = await makeTempDir()
  ws = await openWorkspace(ctx.dir, { watch: false, atomic: { maxWaitMs: 400 } })
})
afterEach(async () => {
  await ws.close()
  await ctx.cleanup()
})

const doc = (item: string) => ({ version: 1 as const, items: [item] })

describe('writeJson / readJson', () => {
  it('写入后能读回；文件是缩进 2 空格、以换行结尾的 JSON', async () => {
    await ws.writeJson(DOC, doc('a'), Doc)
    expect(await ws.readJson(DOC, Doc)).toEqual(doc('a'))
    expect(await readFile(join(ctx.dir, DOC), 'utf8')).toBe('{\n  "version": 1,\n  "items": [\n    "a"\n  ]\n}\n')
  })

  it('200 次并发写入不丢不坏，最后留下的是最后提交的那份', async () => {
    await Promise.all(Array.from({ length: 200 }, (_, i) => ws.writeJson(DOC, doc(String(i)), Doc)))
    expect(await ws.readJson(DOC, Doc)).toEqual(doc('199'))
  })

  it('保留用户手动加的字段', async () => {
    await writeFile(join(ctx.dir, DOC), '{"version":1,"items":[],"手写":true}', 'utf8')
    const value = await ws.readJson(DOC, Doc)
    await ws.writeJson(DOC, value, Doc)
    expect(JSON.parse(await readFile(join(ctx.dir, DOC), 'utf8'))).toMatchObject({ 手写: true })
  })

  it('不符合 schema 的数据不会写入', async () => {
    await expect(ws.writeJson(DOC, { version: 2, items: [] } as never, Doc)).rejects.toMatchObject({ code: 'invalid' })
    await expect(ws.readJson(DOC, Doc)).rejects.toMatchObject({ code: 'missing' })
  })

  it('文件不存在时：有 fallback 就用 fallback，否则报 missing', async () => {
    expect(await ws.readJson(DOC, Doc, () => doc('默认'))).toEqual(doc('默认'))
    await expect(ws.readJson(DOC, Doc)).rejects.toMatchObject({ code: 'missing', rel: DOC })
  })

  it('带 BOM 的文件也能读', async () => {
    await writeFile(join(ctx.dir, DOC), '﻿{"version":1,"items":["x"]}', 'utf8')
    expect(await ws.readJson(DOC, Doc)).toEqual(doc('x'))
  })

  it('内容损坏时报 corrupt，消息里带文件名', async () => {
    await writeFile(join(ctx.dir, DOC), '{损坏', 'utf8')
    const error = await ws.readJson(DOC, Doc).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'corrupt', rel: DOC })
    expect((error as Error).message).toContain(DOC)
  })

  it('内容格式不对时报 invalid，消息是中文', async () => {
    await writeFile(join(ctx.dir, DOC), '{"version":1,"items":"不是数组"}', 'utf8')
    const error = await ws.readJson(DOC, Doc).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'invalid', rel: DOC })
    expect((error as Error).message).toContain('items')
  })
})

describe('文件被占用', () => {
  it.skipIf(process.platform !== 'win32')('短暂占用：重试后写入成功', async () => {
    await ws.writeJson(DOC, doc('old'), Doc)
    const holder = await open(join(ctx.dir, DOC), 'r')
    setTimeout(() => void holder.close(), 120)
    await ws.writeJson(DOC, doc('new'), Doc)
    expect(await ws.readJson(DOC, Doc)).toEqual(doc('new'))
  })

  it.skipIf(process.platform !== 'win32')('持续占用到超时：报 busy，旧数据保留，不产生改动记录', async () => {
    await ws.writeJson(DOC, doc('old'), Doc)
    const before = ws.lastChange()
    const holder = await open(join(ctx.dir, DOC), 'r')
    try {
      await expect(ws.writeJson(DOC, doc('new'), Doc)).rejects.toMatchObject({ code: 'busy', rel: DOC })
    } finally {
      await holder.close()
    }
    expect(await ws.readJson(DOC, Doc)).toEqual(doc('old'))
    expect(ws.lastChange()).toEqual(before)
  })
})
describe('appendLine / readLines', () => {
  it('100 次并发追加：100 行完整、不交错、顺序保持', async () => {
    await Promise.all(Array.from({ length: 100 }, (_, i) => ws.appendLine(LOG, { id: `id-${i}`, n: i }, Line)))
    const { items, skipped } = await ws.readLines(LOG, Line)
    expect(skipped).toEqual([])
    expect(items.map((item) => item.n)).toEqual(Array.from({ length: 100 }, (_, i) => i))
  })

  it('文件不存在或为空时返回空结果', async () => {
    expect(await ws.readLines(LOG, Line)).toEqual({ items: [], skipped: [] })
    await writeFile(join(ctx.dir, LOG), '', 'utf8')
    expect(await ws.readLines(LOG, Line)).toEqual({ items: [], skipped: [] })
  })

  it('坏行被跳过并返回行号，好行照常读出', async () => {
    await writeFile(join(ctx.dir, LOG), '{"id":"a","n":1}\n{坏行\n{"id":"c","n":3}\n', 'utf8')
    const { items, skipped } = await ws.readLines(LOG, Line)
    expect(items.map((item) => item.id)).toEqual(['a', 'c'])
    expect(skipped.map((s) => s.line)).toEqual([2])
  })

  it('上次写到一半的半行不会和新追加的行粘在一起', async () => {
    await writeFile(join(ctx.dir, LOG), '{"id":"a","n":1}\n{"id":"b","n":', 'utf8')
    await ws.appendLine(LOG, { id: 'c', n: 3 }, Line)
    const { items, skipped } = await ws.readLines(LOG, Line)
    expect(items.map((item) => item.id)).toEqual(['a', 'c'])
    expect(skipped.map((s) => s.line)).toEqual([2])
  })

  it('不符合 schema 的行不会写入', async () => {
    await expect(ws.appendLine(LOG, { id: 'a' } as never, Line)).rejects.toMatchObject({ code: 'invalid' })
    expect(await ws.readLines(LOG, Line)).toEqual({ items: [], skipped: [] })
  })
})

describe('appendLog', () => {
  it('追加一行，但不进改动历史：不会顶掉最近一次改动，也不能撤销', async () => {
    await ws.writeJson(DOC, doc('a'), Doc)
    const before = ws.lastChange()
    await ws.appendLog(LOG, { id: 'u1', n: 1 }, Line)
    await ws.appendLog(LOG, { id: 'u2', n: 2 }, Line)
    expect(ws.lastChange()).toEqual(before)
    expect((await ws.readLines(LOG, Line)).items.map((i) => i.id)).toEqual(['u1', 'u2'])
    expect(await ws.undo(before!.id)).toBe(true) // 撤销的是 writeJson，日志还在
    expect((await ws.readLines(LOG, Line)).items).toHaveLength(2)
  })

  it('数据不符合 schema 时拒绝', async () => {
    await expect(ws.appendLog(LOG, { id: 'x' } as never, Line)).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('list', () => {
  it('列出目录下的文件名（排序、不含子目录），目录不存在返回空数组', async () => {
    expect(await ws.list('data/plans')).toEqual([])
    await ws.writeJson('data/plans/2026-10-02.json', doc('b'), Doc)
    await ws.writeJson('data/plans/2026-10-01.json', doc('a'), Doc)
    await mkdir(join(ctx.dir, 'data', 'plans', '子目录'))
    expect(await ws.list('data/plans')).toEqual(['2026-10-01.json', '2026-10-02.json'])
  })
})

describe('路径检查', () => {
  it('拒绝工作区外的路径', async () => {
    await expect(ws.readJson('../outside.json', Doc)).rejects.toMatchObject({ code: 'bad-path' })
    await expect(ws.writeJson('data/../../outside.json', doc('x'), Doc)).rejects.toMatchObject({ code: 'bad-path' })
    await expect(ws.readText(join(ctx.dir, 'abs.txt'))).rejects.toMatchObject({ code: 'bad-path' })
  })
})

describe('writeGenerated', () => {
  it('写生成文件：内容没变就不重写，也不进改动记录', async () => {
    await ws.writeGenerated('今日.md', '# 今日\n')
    expect(await ws.readText('今日.md')).toBe('# 今日\n')
    expect(ws.lastChange()).toBeNull()
    const { mtimeMs } = await import('node:fs/promises').then((fs) => fs.stat(join(ctx.dir, '今日.md')))
    await ws.writeGenerated('今日.md', '# 今日\n')
    const second = await import('node:fs/promises').then((fs) => fs.stat(join(ctx.dir, '今日.md')))
    expect(second.mtimeMs).toBe(mtimeMs)
  })

  it('读不存在的文本返回 null', async () => {
    expect(await ws.readText('不存在.md')).toBeNull()
  })
})
