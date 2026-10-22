import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatSeq, nextLearningSeq } from '../../../src/main/domain/learning'
import { loadPlan, loadSettings, loadSources, loadTasks } from '../../../src/main/domain/load'
import { openWorkspace, type Workspace } from '../../../src/main/store/workspace'
import { PATHS, planPath } from '../../../src/shared/paths'
import { Checkin, defaultSettings, emptyPlan, emptyTasks, PlanFile, type LearningCheck } from '../../../src/shared/schema'
import { makeTempDir } from '../store/helpers'

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

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('默认值', () => {
  it('文件还不存在时，设置、任务、计划都给出空的默认值', async () => {
    expect(await loadSettings(ws)).toEqual(defaultSettings())
    expect(await loadTasks(ws)).toEqual(emptyTasks())
    expect(await loadPlan(ws, '2026-10-23')).toEqual(emptyPlan('2026-10-23'))
  })
})

describe('loadSources', () => {
  it('读出各种记录；坏行和坏文件进 warnings；只保留带复盘的计划', async () => {
    await ws.appendLine(PATHS.checkins, { id: id(1), type: 'wake', at: '2026-10-23T07:00:00+08:00', source: 'phone' }, Checkin)
    await mkdir(join(ctx.dir, 'data', 'plans'), { recursive: true })
    await appendFile(join(ctx.dir, PATHS.weight), '{"id":"x"}\n') // 缺字段的坏行
    const withReview: PlanFile = { ...emptyPlan('2026-10-22'), review: { done: 'a', learned: 'b', change: 'c', at: '2026-10-22T22:40:00+08:00' } }
    await ws.writeJson(planPath('2026-10-22'), withReview, PlanFile)
    await ws.writeJson(planPath('2026-10-23'), emptyPlan('2026-10-23'), PlanFile) // 没有复盘
    await writeFile(join(ctx.dir, planPath('2026-10-21')), '{损坏', 'utf8')

    const { sources, warnings } = await loadSources(ws)
    expect(sources.checkins).toHaveLength(1)
    expect(sources.weights).toEqual([])
    expect(sources.plans.map((p) => p.date)).toEqual(['2026-10-22'])
    expect(warnings).toHaveLength(2)
    expect(warnings.join('\n')).toContain('data/weight.jsonl 第 1 行被跳过')
    expect(warnings.join('\n')).toContain('data/plans/2026-10-21.json 读不出来')
  })

  it('全部为空时返回空的数据，没有警告', async () => {
    const { sources, warnings } = await loadSources(ws)
    expect(sources).toEqual({ checkins: [], tasks: [], weights: [], workouts: [], plans: [], learning: [] })
    expect(warnings).toEqual([])
  })
})

describe('学习检验序号', () => {
  const entry = (seq: number): LearningCheck => ({ id: id(seq), seq, at: '2026-10-23T22:00:00+08:00', taskId: null, topic: 't', checks: [] })

  it('没有记录从 1 开始，之后在最大序号上加 1', () => {
    expect(nextLearningSeq([])).toBe(1)
    expect(nextLearningSeq([entry(1), entry(5), entry(3)])).toBe(6)
  })

  it('formatSeq 补零到 4 位', () => {
    expect(formatSeq(1)).toBe('L-0001')
    expect(formatSeq(123)).toBe('L-0123')
  })
})
