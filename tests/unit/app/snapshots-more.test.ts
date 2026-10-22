import { appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addCheckin } from '../../../src/main/app/services'
import { updateReview } from '../../../src/main/app/services-plan'
import { changeProfile, logWeight, logWorkout } from '../../../src/main/app/services-records'
import { changeTaskStatus, createTask } from '../../../src/main/app/services-tasks'
import { buildDay, buildRecords, buildSettings, checkHealth } from '../../../src/main/app/snapshots'
import { PATHS } from '../../../src/shared/paths'
import { Checkin, emptyProfile, LearningCheck } from '../../../src/shared/schema'
import { newTestId, openTestSession, useShanghaiTimezone } from './helpers'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

let test: Awaited<ReturnType<typeof openTestSession>>
beforeEach(async () => {
  test = await openTestSession()
})
afterEach(async () => {
  await test.cleanup()
})
const ctx = () => test.session.ctx()

describe('buildDay：点热力图的某一格', () => {
  it('汇总那一天的计划、打卡、完成的任务、体重、健身、检验和分数', async () => {
    await addCheckin(ctx(), 'wake')
    const task = await createTask(ctx(), { title: '写周报', addToToday: true })
    await changeTaskStatus(ctx(), task.id, 'done')
    await logWeight(ctx(), 76.4)
    await logWorkout(ctx(), { summary: '跑步', durationMin: 30 })
    await updateReview(ctx(), { done: 'a', learned: 'b', change: 'c' })
    await ctx().ws.appendLine(
      PATHS.learning,
      { id: newTestId(), seq: 1, at: '2026-10-23T22:00:00+08:00', taskId: null, topic: 'Buck', checks: [{ q: '为什么', result: 'mastered' }] },
      LearningCheck,
    )

    const day = await buildDay(ctx(), '2026-10-23')
    expect(day).toMatchObject({ date: '2026-10-23', weekday: '周五' })
    expect(day.wake).not.toBeNull()
    expect(day.planTasks.map((t) => t.title)).toEqual(['写周报'])
    expect(day.doneTasks.map((t) => t.title)).toEqual(['写周报'])
    expect(day.weights).toHaveLength(1)
    expect(day.workouts).toHaveLength(1)
    expect(day.learning).toHaveLength(1)
    // 起床 1 + 完成任务 1 + 体重 1 + 健身 1 + 复盘 2 + 掌握 3
    expect(day.score).toBe(9)
  })

  it('没有任何记录的一天：分数 0，列表都是空的', async () => {
    const day = await buildDay(ctx(), '2026-10-01')
    expect(day).toMatchObject({ score: 0, planTasks: [], doneTasks: [], weights: [], workouts: [], learning: [], wake: null, sleep: null })
  })
})

describe('buildRecords', () => {
  it('53 周热力图、打卡最新在前、体重从早到晚、健身和检验最新在前', async () => {
    const put = (n: number, at: string): Promise<void> =>
      ctx().ws.appendLine(PATHS.checkins, { id: newTestId(), type: 'wake', at, source: 'phone' }, Checkin)
    await put(1, '2026-10-20T07:00:00+08:00')
    await put(2, '2026-10-22T07:00:00+08:00')
    await ctx().ws.appendLine(PATHS.weight, { id: newTestId(), at: '2026-10-22T07:00:00+08:00', kg: 76.8 }, (await import('../../../src/shared/schema')).WeightEntry)
    await ctx().ws.appendLine(PATHS.weight, { id: newTestId(), at: '2026-10-19T07:00:00+08:00', kg: 77 }, (await import('../../../src/shared/schema')).WeightEntry)
    const profile = emptyProfile()
    profile.goals.weightTargetKg = 70
    await changeProfile(ctx(), profile)

    const records = await buildRecords(ctx())
    expect(records.today).toBe('2026-10-23')
    expect(records.heatmap).toHaveLength(53 * 7)
    expect(records.checkins.map((r) => r.date)).toEqual(['2026-10-22', '2026-10-20'])
    expect(records.weights.map((w) => w.kg)).toEqual([77, 76.8])
    expect(records.weightTargetKg).toBe(70)
  })
})

describe('buildSettings', () => {
  it('带上工作区路径、设置和目标', async () => {
    const snapshot = await buildSettings(ctx(), test.root, { supported: false, enabled: false })
    expect(snapshot.workspaceRoot).toBe(test.root)
    expect(snapshot.autostart).toEqual({ supported: false, enabled: false })
    expect(snapshot.settings.dayStartsAt).toBe('04:00')
    expect(snapshot.profile.goals.weightTargetKg).toBeNull()
  })
})

describe('checkHealth', () => {
  it('新工作区没有问题', async () => {
    expect(await checkHealth(ctx())).toEqual([])
  })

  it('核心文件被改坏：列出文件名和原因；数据里的坏行不算（那是警告）', async () => {
    await writeFile(join(test.root, PATHS.tasks), '{损坏', 'utf8')
    await writeFile(join(test.root, PATHS.settings), '{"version":2}', 'utf8')
    await appendFile(join(test.root, PATHS.weight), '{坏行\n', 'utf8')
    const problems = await checkHealth(ctx())
    expect(problems.map((p) => p.rel).sort()).toEqual([PATHS.settings, PATHS.tasks].sort())
    expect(problems.find((p) => p.rel === PATHS.tasks)?.message).toContain('不是合法的 JSON')
  })

  it('今天的计划文件坏了也会列出来', async () => {
    await writeFile(join(test.root, 'data', 'plans', '2026-10-23.json'), '{损坏', 'utf8').catch(async () => {
      await (await import('node:fs/promises')).mkdir(join(test.root, 'data', 'plans'), { recursive: true })
      await writeFile(join(test.root, 'data', 'plans', '2026-10-23.json'), '{损坏', 'utf8')
    })
    expect((await checkHealth(ctx())).map((p) => p.rel)).toEqual(['data/plans/2026-10-23.json'])
  })
})
