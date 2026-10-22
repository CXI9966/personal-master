import { readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initWorkspace } from '../../../src/main/init/firstRun'
import { renderAll } from '../../../src/main/render'
import { openWorkspace, type Workspace } from '../../../src/main/store/workspace'
import { GENERATED_MARKER } from '../../../src/shared/labels'
import { PATHS, planPath } from '../../../src/shared/paths'
import { Checkin, emptyPlan, PlanFile, TasksFile } from '../../../src/shared/schema'
import { addTask } from '../../../src/main/domain/tasks'
import { makeTempDir, sleep } from '../store/helpers'

// 2026-10-23 12:00（上海），固定“现在”，不受运行时区影响
const NOW = new Date('2026-10-23T12:00:00+08:00')
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let ctx: Awaited<ReturnType<typeof makeTempDir>>
let ws: Workspace
let originalTz: string | undefined
beforeEach(async () => {
  originalTz = process.env.TZ
  process.env.TZ = 'Asia/Shanghai'
  ctx = await makeTempDir()
  ws = await openWorkspace(ctx.dir, { watch: false })
  await initWorkspace(ws, { persona: 'coach', now: NOW })
})
afterEach(async () => {
  await ws.close()
  await ctx.cleanup()
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const read = (rel: string): Promise<string> => readFile(join(ctx.dir, rel), 'utf8')

describe('renderAll', () => {
  it('初始化后所有视图都已生成，第一行是固定说明', async () => {
    for (const rel of ['今日.md', '本周.md', '我的设定.md', '记录/打卡.md', '记录/体重.md', '记录/健身.md', '记录/学习.md', '任务库/收集箱.md']) {
      expect((await read(rel)).split('\n')[0], rel).toBe(GENERATED_MARKER)
    }
    expect(await read('今日.md')).toContain('# 今日 · 2026-10-23 周五 · 第 43 周')
  })

  it('数据变化后重新生成：打卡、任务和复盘都会出现在视图里', async () => {
    await ws.batch('测试数据', async (tx) => {
      await tx.appendLine(PATHS.checkins, { id: id(1), type: 'wake', at: '2026-10-23T07:02:00+08:00', source: 'phone' }, Checkin)
      const tasks = addTask(await tx.readJson(PATHS.tasks, TasksFile), { title: '写周报', list: '学习' }, { id: id(2), now: '2026-10-23T08:00:00+08:00' })
      await tx.writeJson(PATHS.tasks, tasks, TasksFile)
      await tx.writeJson(planPath('2026-10-23'), { ...emptyPlan('2026-10-23'), taskIds: [id(2)], energy: 'high' }, PlanFile)
    })
    await renderAll(ws, { now: NOW })
    const today = await read('今日.md')
    expect(today).toContain('- 起床：07:02（手机）')
    expect(today).toContain('- [ ] 写周报')
    expect(today).toContain('😀 满电')
    expect(await read('任务库/学习.md')).toContain('写周报')
    expect(await read('记录/打卡.md')).toContain('| 2026-10-23 | 07:02（手机） |')
  })

  it('内容没变就不重写文件', async () => {
    const before = (await stat(join(ctx.dir, '今日.md'))).mtimeMs
    await sleep(30)
    await renderAll(ws, { now: NOW })
    expect((await stat(join(ctx.dir, '今日.md'))).mtimeMs).toBe(before)
  })

  it('清单被删掉后，旧的生成文件也清掉；用户自己建的文件不动', async () => {
    await ws.writeJson(PATHS.tasks, { version: 1, lists: ['收集箱', '临时'], tasks: [] }, TasksFile)
    await renderAll(ws, { now: NOW })
    expect(await ws.readText('任务库/临时.md')).not.toBeNull()
    await writeFile(join(ctx.dir, '任务库', '我的笔记.md'), '# 我自己写的\n', 'utf8')

    await ws.writeJson(PATHS.tasks, { version: 1, lists: ['收集箱'], tasks: [] }, TasksFile)
    await renderAll(ws, { now: NOW })
    expect(await ws.readText('任务库/临时.md')).toBeNull()
    expect(await ws.readText('任务库/我的笔记.md')).toBe('# 我自己写的\n')
  })

  it('归档：最近的有内容的计划会生成，空计划不生成；旧计划只在 full 时生成', async () => {
    await ws.writeJson(planPath('2026-10-22'), { ...emptyPlan('2026-10-22'), energy: 'low' }, PlanFile)
    await ws.writeJson(planPath('2026-10-21'), emptyPlan('2026-10-21'), PlanFile)
    await ws.writeJson(planPath('2026-08-01'), { ...emptyPlan('2026-08-01'), energy: 'mid' }, PlanFile)
    await renderAll(ws, { now: NOW })
    expect(await read('归档/2026/2026-W43/2026-10-22.md')).toContain('😫 疲惫')
    expect(await ws.readText('归档/2026/2026-W43/2026-10-21.md')).toBeNull()
    expect(await ws.readText('归档/2026/2026-W31/2026-08-01.md')).toBeNull()
    await renderAll(ws, { now: NOW, full: true })
    expect(await ws.readText('归档/2026/2026-W31/2026-08-01.md')).not.toBeNull()
  })

  it('读不出来的计划文件进 warnings，其余照常生成', async () => {
    await mkdir(join(ctx.dir, 'data', 'plans'), { recursive: true })
    await writeFile(join(ctx.dir, planPath('2026-10-22')), '{损坏', 'utf8')
    const { warnings } = await renderAll(ws, { now: NOW })
    expect(warnings.join('\n')).toContain('data/plans/2026-10-22.json 读不出来')
    expect(await ws.readText('今日.md')).not.toBeNull()
  })

  it('所有生成的文件里都没有“缺勤”“断网”', async () => {
    for (const rel of ['今日.md', '本周.md', '我的设定.md', '记录/打卡.md', '记录/体重.md', '任务库/收集箱.md']) {
      expect(await read(rel), rel).not.toMatch(/缺勤|断网/)
    }
  })
})
