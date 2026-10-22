import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addCheckin, completeTaskById, mutate, restoreFile, undoChange } from '../../../src/main/app/services'
import { buildTrayModel, performTrayAction } from '../../../src/main/app/trayModel'
import { buildToday } from '../../../src/main/app/snapshots'
import { setPlanTasks } from '../../../src/main/domain/plan'
import { addTask } from '../../../src/main/domain/tasks'
import { PATHS, planPath } from '../../../src/shared/paths'
import { Checkin, emptyPlan, emptyTasks, PlanFile, TasksFile } from '../../../src/shared/schema'
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

async function seedPlanWithTasks(titles: string[]): Promise<string[]> {
  const { ws } = test.session.ctx()
  let tasks = emptyTasks()
  for (const title of titles) tasks = addTask(tasks, { title }, { id: newTestId(), now: NOW_ISO })
  await ws.writeJson(PATHS.tasks, tasks, TasksFile)
  const ids = tasks.tasks.map((t) => t.id)
  await ws.writeJson(planPath('2026-10-23'), setPlanTasks(emptyPlan('2026-10-23'), ids), PlanFile)
  return ids
}

describe('services', () => {
  it('addCheckin：记一条桌面端打卡，通知界面，留下可撤销的记录', async () => {
    const ctx = test.session.ctx()
    await addCheckin(ctx, 'wake')
    expect(test.platform.notifications).toEqual(['local'])
    const { items } = await ctx.ws.readLines(PATHS.checkins, Checkin)
    expect(items).toMatchObject([{ type: 'wake', source: 'desktop', at: '2026-10-23T12:00:00+08:00' }])
    expect(ctx.ws.lastChange()?.label).toBe('起床打卡')
  })

  it('同一天点两次起床：两条都记下', async () => {
    const ctx = test.session.ctx()
    await addCheckin(ctx, 'wake')
    await addCheckin(ctx, 'wake')
    expect((await ctx.ws.readLines(PATHS.checkins, Checkin)).items).toHaveLength(2)
  })

  it('undoChange：撤销最近一次打卡并通知；过期的 id 返回 false 且不通知', async () => {
    const ctx = test.session.ctx()
    await addCheckin(ctx, 'wake')
    const first = ctx.ws.lastChange()!
    await addCheckin(ctx, 'sleep')
    test.platform.notifications.length = 0
    expect(await undoChange(ctx, first.id)).toBe(false)
    expect(test.platform.notifications).toEqual([])
    expect(await undoChange(ctx, ctx.ws.lastChange()!.id)).toBe(true)
    expect(test.platform.notifications).toEqual(['local'])
    expect((await ctx.ws.readLines(PATHS.checkins, Checkin)).items).toHaveLength(1)
  })

  it('completeTaskById：任务变成已完成；找不到任务时报错且不通知', async () => {
    const ctx = test.session.ctx()
    const [id] = await seedPlanWithTasks(['写周报'])
    test.platform.notifications.length = 0
    await completeTaskById(ctx, id!)
    expect((await buildToday(ctx)).planTasks[0]).toMatchObject({ status: 'done', doneAt: '2026-10-23T12:00:00+08:00' })
    test.platform.notifications.length = 0
    await expect(completeTaskById(ctx, newTestId())).rejects.toThrow(/找不到任务/)
    expect(test.platform.notifications).toEqual([])
  })

  it('restoreFile：文件被改坏后恢复上一个版本', async () => {
    const ctx = test.session.ctx()
    await seedPlanWithTasks(['A'])
    await ctx.ws.writeJson(PATHS.tasks, emptyTasks(), TasksFile) // 产生一份历史备份：改动前是带 A 的版本
    await writeFile(join(test.root, PATHS.tasks), '{损坏', 'utf8') // 外部程序把文件写坏
    expect(await restoreFile(ctx, PATHS.tasks)).toBe(true)
    expect((await ctx.ws.readJson(PATHS.tasks, TasksFile)).tasks).toHaveLength(1)
  })

  it('mutate 出错时不通知', async () => {
    const ctx = test.session.ctx()
    await expect(mutate(ctx, '会失败', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(test.platform.notifications).toEqual([])
  })
})

describe('托盘菜单', () => {
  it('没有工作区：只给打开和退出', () => {
    expect(buildTrayModel(null).map((item) => item.id ?? '—')).toEqual(['open', '—', 'quit'])
  })

  it('有数据：打卡状态、今天的待办任务（只列没完成的）', async () => {
    const ctx = test.session.ctx()
    const [a, b] = await seedPlanWithTasks(['A', 'B'])
    await completeTaskById(ctx, a!)
    await addCheckin(ctx, 'wake')
    const model = buildTrayModel(await buildToday(ctx))
    expect(model[0]).toEqual({ id: 'checkin:wake', label: '起床打卡（已打卡 12:00）' })
    expect(model[1]).toEqual({ id: 'checkin:sleep', label: '睡前打卡' })
    expect(model[2]?.submenu).toEqual([{ id: `task:${b}`, label: '完成：B' }])
  })

  it('今天没有待办时给一条灰色提示', async () => {
    const model = buildTrayModel(await buildToday(test.session.ctx()))
    expect(model[2]?.submenu).toEqual([{ label: '今天没有待办任务', enabled: false }])
  })

  it('performTrayAction：打卡、勾任务、打开、退出', async () => {
    const ctx = test.session.ctx()
    const [id] = await seedPlanWithTasks(['A'])
    expect(await performTrayAction(ctx, 'checkin:sleep')).toBe('done')
    expect(await performTrayAction(ctx, `task:${id}`)).toBe('done')
    expect(await performTrayAction(ctx, 'open')).toBe('open')
    expect(await performTrayAction(ctx, 'quit')).toBe('quit')
    const today = await buildToday(ctx)
    expect(today.sleep).not.toBeNull()
    expect(today.planTasks[0]?.status).toBe('done')
  })

  it('没有工作区时点打卡，引导去主窗口；未知操作报错', async () => {
    expect(await performTrayAction(null, 'checkin:wake')).toBe('open')
    await expect(performTrayAction(test.session.ctx(), 'nope')).rejects.toThrow(/未知的托盘操作/)
  })
})
