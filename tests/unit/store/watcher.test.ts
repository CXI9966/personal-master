import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { openWorkspace, type Workspace } from '../../../src/main/store/workspace'
import { makeTempDir, sleep, waitFor } from './helpers'

const Doc = z.looseObject({ version: z.literal(1), items: z.array(z.string()) })

let ctx: Awaited<ReturnType<typeof makeTempDir>>
let ws: Workspace
let changes: string[]
beforeEach(async () => {
  ctx = await makeTempDir()
  ws = await openWorkspace(ctx.dir, { watch: true, debounceMs: 40, selfWriteWindowMs: 300 })
  changes = []
  ws.onExternalChange((rel) => changes.push(rel))
})
afterEach(async () => {
  await ws.close()
  await ctx.cleanup()
})

describe('外部改动监听', () => {
  it('外部程序改了 data/ 下的文件，会收到相对路径（正斜杠）', async () => {
    await writeFile(join(ctx.dir, 'data', 'ext.json'), '{"version":1,"items":[]}', 'utf8')
    expect(await waitFor(() => changes.includes('data/ext.json'))).toBe(true)
  })

  it('外部改了 管家人格.md 和 课表.md 也会收到', async () => {
    await writeFile(join(ctx.dir, '管家人格.md'), '# 人格\n', 'utf8')
    await writeFile(join(ctx.dir, '课表.md'), '# 课表\n', 'utf8')
    expect(await waitFor(() => changes.includes('管家人格.md') && changes.includes('课表.md'))).toBe(true)
  })

  it('自己写的不算外部改动', async () => {
    await ws.writeJson('data/self.json', { version: 1, items: ['a'] }, Doc)
    await ws.appendLine('data/self.jsonl', { x: 1 }, z.looseObject({ x: z.number() }))
    await ws.writeGenerated('今日.md', '# 今日\n')
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('忽略 .history、.tmp 和生成的 md', async () => {
    await mkdir(join(ctx.dir, 'data', '.history'), { recursive: true })
    await writeFile(join(ctx.dir, 'data', '.history', 'x.json'), '{}', 'utf8')
    await writeFile(join(ctx.dir, 'data', 'a.tmp'), 'x', 'utf8')
    await writeFile(join(ctx.dir, '今日.md'), '手改', 'utf8')
    await sleep(600)
    expect(changes).toEqual([])
  })

  it('取消订阅后不再收到', async () => {
    const extra: string[] = []
    const off = ws.onExternalChange((rel) => extra.push(rel))
    off()
    await writeFile(join(ctx.dir, 'data', 'later.json'), '{}', 'utf8')
    expect(await waitFor(() => changes.includes('data/later.json'))).toBe(true)
    expect(extra).toEqual([])
  })
})
