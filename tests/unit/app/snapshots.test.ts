import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addCheckin } from '../../../src/main/app/services'
import { buildToday } from '../../../src/main/app/snapshots'
import { addTask } from '../../../src/main/domain/tasks'
import { setPlanTasks } from '../../../src/main/domain/plan'
import { PATHS, planPath } from '../../../src/shared/paths'
import { Checkin, emptyPlan, PlanFile, ProfileFile, TasksFile, emptyTasks, emptyProfile } from '../../../src/shared/schema'
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

const NOW_ISO = '2026-10-23T08:00:00+08:00'
const checkinAt = (at: string) => test.session.ctx().ws.appendLine(PATHS.checkins, { id: newTestId(), type: 'wake', at, source: 'desktop' }, Checkin)

describe('buildToday', () => {
  it('全新的工作区：空计划、84 格热力图、没有欢迎回来、没有警告', async () => {
    const snapshot = await buildToday(test.session.ctx())
    expect(snapshot).toMatchObject({
      date: '2026-10-23',
      dayStartsAt: '04:00',
      plan: emptyPlan('2026-10-23'),
      planTasks: [],
      openTasks: [],
      unfinished: [],
      fixedToday: [],
      wake: null,
      sleep: null,
      welcomeBack: false,
      warnings: [],
    })
    expect(snapshot.heatmap).toHaveLength(84)
    expect(snapshot.heatmap.every((cell) => cell.level === 0)).toBe(true)
    expect(snapshot.lists).toEqual(['收集箱'])
  })

  it('打卡后：今天有起床记录，热力图当天变深，lastChange 是这次打卡', async () => {
    await addCheckin(test.session.ctx(), 'wake')
    const snapshot = await buildToday(test.session.ctx())
    expect(snapshot.wake?.type).toBe('wake')
    const cell = snapshot.heatmap.find((c) => c.date === '2026-10-23')
    expect(cell).toMatchObject({ score: 1, level: 1, future: false })
    expect(snapshot.lastChange?.label).toBe('起床打卡')
  })

  it('计划里的任务按计划顺序解析；今天之后的格子标为 future', async () => {
    const { ws } = test.session.ctx()
    let tasks = emptyTasks()
    tasks = addTask(tasks, { title: 'A' }, { id: newTestId(), now: NOW_ISO })
    tasks = addTask(tasks, { title: 'B' }, { id: newTestId(), now: NOW_ISO })
    await ws.writeJson(PATHS.tasks, tasks, TasksFile)
    const [a, b] = tasks.tasks
    await ws.writeJson(planPath('2026-10-23'), setPlanTasks(emptyPlan('2026-10-23'), [b!.id, a!.id]), PlanFile)
    const snapshot = await buildToday(test.session.ctx())
    expect(snapshot.planTasks.map((t) => t.title)).toEqual(['B', 'A'])
    expect(snapshot.openTasks).toHaveLength(2)
    expect(snapshot.heatmap.find((c) => c.date === '2026-10-24')?.future).toBe(true)
  })

  it('昨天计划里没完成、今天计划里还没有的任务出现在 unfinished', async () => {
    const { ws } = test.session.ctx()
    let tasks = emptyTasks()
    tasks = addTask(tasks, { title: 'A' }, { id: newTestId(), now: NOW_ISO })
    tasks = addTask(tasks, { title: 'B' }, { id: newTestId(), now: NOW_ISO })
    await ws.writeJson(PATHS.tasks, tasks, TasksFile)
    const [a, b] = tasks.tasks
    await ws.writeJson(planPath('2026-10-22'), setPlanTasks(emptyPlan('2026-10-22'), [a!.id, b!.id]), PlanFile)
    await ws.writeJson(planPath('2026-10-23'), setPlanTasks(emptyPlan('2026-10-23'), [b!.id]), PlanFile)
    await checkinAt('2026-10-22T07:00:00+08:00') // 昨天有活动，不算隔了好几天
    expect((await buildToday(test.session.ctx())).unfinished.map((t) => t.title)).toEqual(['A'])
  })

  it('隔了 3 天以上才回来：欢迎回来，不列出没做的事；隔 2 天则正常', async () => {
    const { ws } = test.session.ctx()
    let tasks = emptyTasks()
    tasks = addTask(tasks, { title: 'A' }, { id: newTestId(), now: NOW_ISO })
    await ws.writeJson(PATHS.tasks, tasks, TasksFile)
    await ws.writeJson(planPath('2026-10-22'), setPlanTasks(emptyPlan('2026-10-22'), [tasks.tasks[0]!.id]), PlanFile)
    await checkinAt('2026-10-20T07:00:00+08:00') // 3 天前
    const back = await buildToday(test.session.ctx())
    expect(back.welcomeBack).toBe(true)
    expect(back.unfinished).toEqual([])

    await checkinAt('2026-10-21T07:00:00+08:00') // 2 天前
    expect((await buildToday(test.session.ctx())).welcomeBack).toBe(false)
  })

  it('只返回今天是周几对应的固定安排（2026-10-23 是周五）', async () => {
    const profile = emptyProfile()
    profile.schedule.fixed = [
      { weekday: 5, start: '08:00', end: '09:40', title: '周五的课' },
      { weekday: 1, start: '08:00', end: '09:40', title: '周一的课' },
    ]
    await test.session.ctx().ws.writeJson(PATHS.profile, profile, ProfileFile)
    expect((await buildToday(test.session.ctx())).fixedToday.map((f) => f.title)).toEqual(['周五的课'])
  })

  it('有坏行时带上警告，其余照常', async () => {
    await (await import('node:fs/promises')).appendFile(`${test.root}/${PATHS.weight}`, '{坏行\n', 'utf8')
    const snapshot = await buildToday(test.session.ctx())
    expect(snapshot.warnings).toHaveLength(1)
    expect(snapshot.warnings[0]).toContain('data/weight.jsonl 第 1 行被跳过')
  })
})
