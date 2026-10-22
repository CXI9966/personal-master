import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { openWorkspace, type Workspace } from '../../../src/main/store/workspace'
import { makeTempDir } from './helpers'

const Doc = z.looseObject({ version: z.literal(1), items: z.array(z.string()) })
const Line = z.looseObject({ id: z.string(), n: z.number() })
const A = 'data/a.json'
const B = 'data/b.json'
const LOG = 'data/log.jsonl'
const doc = (item: string) => ({ version: 1 as const, items: [item] })

let ctx: Awaited<ReturnType<typeof makeTempDir>>
let ws: Workspace
beforeEach(async () => {
  ctx = await makeTempDir()
  ws = await openWorkspace(ctx.dir, { watch: false })
})
afterEach(async () => {
  await ws.close()
  await ctx.cleanup()
})

describe('撤销', () => {
  it('写 3 次，撤销 3 次，回到文件不存在的初始状态', async () => {
    for (const v of ['v1', 'v2', 'v3']) await ws.writeJson(A, doc(v), Doc)
    for (const expected of ['v3', 'v2', 'v1']) {
      const change = ws.lastChange()
      expect(change).not.toBeNull()
      expect(await ws.readJson(A, Doc)).toEqual(doc(expected))
      expect(await ws.undo(change!.id)).toBe(true)
    }
    expect(await ws.readJson(A, Doc, () => doc('初始'))).toEqual(doc('初始'))
    expect(ws.lastChange()).toBeNull()
  })

  it('只有最近一次改动能撤销，之后又有新改动，旧的返回 false', async () => {
    await ws.writeJson(A, doc('v1'), Doc)
    const first = ws.lastChange()!
    await ws.writeJson(A, doc('v2'), Doc)
    expect(await ws.undo(first.id)).toBe(false)
    expect(await ws.readJson(A, Doc)).toEqual(doc('v2'))
  })

  it('一次 batch 写两个文件，撤销后两个都回退', async () => {
    await ws.writeJson(A, doc('a0'), Doc)
    await ws.batch('同时改两个文件', async (tx) => {
      await tx.writeJson(A, doc('a1'), Doc)
      await tx.writeJson(B, doc('b1'), Doc)
    })
    const change = ws.lastChange()!
    expect(change.label).toBe('同时改两个文件')
    expect(await ws.undo(change.id)).toBe(true)
    expect(await ws.readJson(A, Doc)).toEqual(doc('a0'))
    await expect(ws.readJson(B, Doc)).rejects.toMatchObject({ code: 'missing' })
  })

  it('batch 中途出错：已写的部分回滚，不留改动记录', async () => {
    await ws.writeJson(A, doc('a0'), Doc)
    const before = ws.lastChange()
    await expect(
      ws.batch('会失败', async (tx) => {
        await tx.writeJson(A, doc('a1'), Doc)
        await tx.appendLine(LOG, { id: 'x', n: 1 }, Line)
        throw new Error('中途出错')
      }),
    ).rejects.toThrow('中途出错')
    expect(await ws.readJson(A, Doc)).toEqual(doc('a0'))
    expect(await ws.readLines(LOG, Line)).toEqual({ items: [], skipped: [] })
    expect(ws.lastChange()).toEqual(before)
  })

  it('追加类文件：撤销后恰好回到追加前的内容', async () => {
    await ws.appendLine(LOG, { id: 'a', n: 1 }, Line)
    const raw = await readFile(join(ctx.dir, LOG), 'utf8')
    await ws.appendLine(LOG, { id: 'b', n: 2 }, Line)
    expect(await ws.undo(ws.lastChange()!.id)).toBe(true)
    expect(await readFile(join(ctx.dir, LOG), 'utf8')).toBe(raw)
  })

  it('追加到本来不存在的文件：撤销后文件消失', async () => {
    await ws.appendLine(LOG, { id: 'a', n: 1 }, Line)
    expect(await ws.undo(ws.lastChange()!.id)).toBe(true)
    expect(await ws.readText(LOG)).toBeNull()
  })

  it('写 60 次只保留最近 50 次改动记录', async () => {
    for (let i = 0; i < 60; i++) await ws.writeJson(A, doc(String(i)), Doc)
    const entries = await readdir(join(ctx.dir, 'data', '.history'))
    expect(entries).toHaveLength(50)
  })

  it('重新打开工作区，改动记录还在，仍可撤销', async () => {
    await ws.writeJson(A, doc('v1'), Doc)
    await ws.writeJson(A, doc('v2'), Doc)
    await ws.close()
    ws = await openWorkspace(ctx.dir, { watch: false })
    expect(await ws.undo(ws.lastChange()!.id)).toBe(true)
    expect(await ws.readJson(A, Doc)).toEqual(doc('v1'))
  })
})

describe('restoreFromHistory', () => {
  it('JSON 被外部改坏后，恢复成上一份历史版本，并且这次恢复也能撤销', async () => {
    await ws.writeJson(A, doc('v1'), Doc)
    await ws.writeJson(A, doc('v2'), Doc)
    await writeFile(join(ctx.dir, A), '{损坏', 'utf8')
    await expect(ws.readJson(A, Doc)).rejects.toMatchObject({ code: 'corrupt' })
    expect(await ws.restoreFromHistory(A)).toBe(true)
    expect(await ws.readJson(A, Doc)).toEqual(doc('v1'))
    expect(await ws.undo(ws.lastChange()!.id)).toBe(true)
    await expect(ws.readJson(A, Doc)).rejects.toMatchObject({ code: 'corrupt' })
  })

  it('没有历史可恢复时返回 false', async () => {
    expect(await ws.restoreFromHistory(A)).toBe(false)
  })
})
