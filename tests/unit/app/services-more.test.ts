import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addCheckin } from '../../../src/main/app/services'
import { updateEnergy, updatePlanTasks, updateReview, updateTimeline } from '../../../src/main/app/services-plan'
import { changeProfile, changeSettings, logWeight, logWorkout } from '../../../src/main/app/services-records'
import {
  changeListName,
  changeTaskStatus,
  createList,
  createTask,
  deleteList,
  editTask,
  removeTask,
} from '../../../src/main/app/services-tasks'
import { undoChange } from '../../../src/main/app/services'
import { buildToday } from '../../../src/main/app/snapshots'
import { loadPlan, loadSettings, loadTasks } from '../../../src/main/domain/load'
import { PATHS } from '../../../src/shared/paths'
import { emptyProfile, WeightEntry, Workout } from '../../../src/shared/schema'
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
const TODAY = '2026-10-23'
const undoLast = async (): Promise<boolean> => undoChange(ctx(), ctx().ws.lastChange()!.id)

describe('今天的计划', () => {
  it('选精力状态，可以撤销', async () => {
    await updateEnergy(ctx(), 'low')
    expect((await loadPlan(ctx().ws, TODAY)).energy).toBe('low')
    expect(await undoLast()).toBe(true)
    expect((await loadPlan(ctx().ws, TODAY)).energy).toBeNull()
  })

  it('时间安排：按开始时间排序；结束早于开始时报错，什么也不写', async () => {
    await updateTimeline(ctx(), [
      { start: '14:00', end: '15:00', title: 'b', taskId: null },
      { start: '09:00', end: '10:00', title: 'a', taskId: null },
    ])
    expect((await loadPlan(ctx().ws, TODAY)).timeline.map((t) => t.title)).toEqual(['a', 'b'])
    await expect(updateTimeline(ctx(), [{ start: '11:00', end: '10:00', title: 'x', taskId: null }])).rejects.toThrow(/晚于/)
    expect((await loadPlan(ctx().ws, TODAY)).timeline).toHaveLength(2)
  })

  it('今日任务：任务必须存在，顺序保持', async () => {
    const a = await createTask(ctx(), { title: 'A' })
    const b = await createTask(ctx(), { title: 'B' })
    await updatePlanTasks(ctx(), [b.id, a.id])
    expect((await buildToday(ctx())).planTasks.map((t) => t.title)).toEqual(['B', 'A'])
    await expect(updatePlanTasks(ctx(), [newTestId()])).rejects.toThrow(/找不到任务/)
  })

  it('复盘：保存后带上时间；再保存覆盖', async () => {
    await updateReview(ctx(), { done: ' 做完了 ', learned: '堵转电流', change: '早点睡' })
    expect((await loadPlan(ctx().ws, TODAY)).review).toEqual({ done: '做完了', learned: '堵转电流', change: '早点睡', at: '2026-10-23T12:00:00+08:00' })
    await updateReview(ctx(), { done: '改了', learned: '', change: '' })
    expect((await loadPlan(ctx().ws, TODAY)).review?.done).toBe('改了')
  })
})

describe('任务', () => {
  it('新建任务并加入今天：一次改动，撤销时两边一起撤掉', async () => {
    const task = await createTask(ctx(), { title: '写周报', list: '学习', due: '2026-10-30', addToToday: true })
    expect(task).toMatchObject({ title: '写周报', list: '学习', due: '2026-10-30', status: 'open' })
    expect((await loadPlan(ctx().ws, TODAY)).taskIds).toEqual([task.id])
    expect(await undoLast()).toBe(true)
    expect((await loadTasks(ctx().ws)).tasks).toEqual([])
    expect((await loadPlan(ctx().ws, TODAY)).taskIds).toEqual([])
  })

  it('不加入今天时只进任务库', async () => {
    const task = await createTask(ctx(), { title: 'A' })
    expect((await loadPlan(ctx().ws, TODAY)).taskIds).toEqual([])
    expect((await loadTasks(ctx().ws)).tasks.map((t) => t.id)).toEqual([task.id])
  })

  it('标题为空报错，不留下任何东西', async () => {
    await expect(createTask(ctx(), { title: '  ' })).rejects.toThrow(/标题不能为空/)
    expect((await loadTasks(ctx().ws)).tasks).toEqual([])
    expect(test.platform.notifications).toEqual([])
  })

  it('修改、完成、重新打开、放弃', async () => {
    const task = await createTask(ctx(), { title: 'A' })
    await editTask(ctx(), task.id, { title: 'A2', checkpoints: ['为什么'], notes: '备注' })
    await changeTaskStatus(ctx(), task.id, 'done')
    let saved = (await loadTasks(ctx().ws)).tasks[0]!
    expect(saved).toMatchObject({ title: 'A2', checkpoints: ['为什么'], notes: '备注', status: 'done', doneAt: '2026-10-23T12:00:00+08:00' })
    await changeTaskStatus(ctx(), task.id, 'open')
    saved = (await loadTasks(ctx().ws)).tasks[0]!
    expect(saved).toMatchObject({ status: 'open', doneAt: null })
    await changeTaskStatus(ctx(), task.id, 'dropped')
    expect((await loadTasks(ctx().ws)).tasks[0]?.status).toBe('dropped')
  })

  it('删除任务时也从今天的计划里拿掉', async () => {
    const task = await createTask(ctx(), { title: 'A', addToToday: true })
    await removeTask(ctx(), task.id)
    expect((await loadTasks(ctx().ws)).tasks).toEqual([])
    expect((await loadPlan(ctx().ws, TODAY)).taskIds).toEqual([])
  })

  it('清单：新建、重命名、删除（有任务不能删）', async () => {
    await createList(ctx(), '学习')
    await createTask(ctx(), { title: 'A', list: '学习' })
    await changeListName(ctx(), '学习', '课程')
    expect((await loadTasks(ctx().ws)).lists).toEqual(['收集箱', '课程'])
    await expect(deleteList(ctx(), '课程')).rejects.toThrow(/还有任务/)
    await createList(ctx(), '临时')
    await deleteList(ctx(), '临时')
    expect((await loadTasks(ctx().ws)).lists).toEqual(['收集箱', '课程'])
  })
})

describe('记录、设置、目标', () => {
  it('记体重、记健身', async () => {
    await logWeight(ctx(), 76.4)
    await logWorkout(ctx(), { summary: ' 有氧 30 分钟 ', durationMin: 30 })
    expect((await ctx().ws.readLines(PATHS.weight, WeightEntry)).items).toMatchObject([{ kg: 76.4, at: '2026-10-23T12:00:00+08:00' }])
    expect((await ctx().ws.readLines(PATHS.workouts, Workout)).items).toMatchObject([{ summary: '有氧 30 分钟', durationMin: 30 }])
  })

  it('改设置：只改给出的字段，其余保持', async () => {
    await changeSettings(ctx(), { dayStartsAt: '05:30', weights: { review: 5 }, reminders: { enabled: true, review: '22:30' } })
    const settings = await loadSettings(ctx().ws)
    expect(settings.dayStartsAt).toBe('05:30')
    expect(settings.heatmap.weights).toMatchObject({ review: 5, checkin: 1, learnMastered: 3 })
    expect(settings.reminders).toEqual({ enabled: true, plan: null, review: '22:30' })
  })

  it('设置不合法就拒绝，原来的设置保持不变', async () => {
    await expect(changeSettings(ctx(), { dayStartsAt: '5点' })).rejects.toMatchObject({ code: 'invalid' })
    expect((await loadSettings(ctx().ws)).dayStartsAt).toBe('04:00')
  })

  it('改了换日时间，“今天”也跟着变（凌晨 4 点前算前一天）', async () => {
    await changeSettings(ctx(), { dayStartsAt: '13:00' }) // 现在是 12:00，早于 13:00，所以还是昨天
    expect((await buildToday(ctx())).date).toBe('2026-10-22')
  })

  it('改目标和固定安排', async () => {
    const profile = emptyProfile()
    profile.goals = { weightTargetKg: 70, notes: '稳住作息' }
    profile.schedule.fixed = [{ weekday: 5, start: '08:00', end: '09:40', title: '电机' }]
    await changeProfile(ctx(), profile)
    expect((await buildToday(ctx())).fixedToday).toEqual([{ weekday: 5, start: '08:00', end: '09:40', title: '电机' }])
  })

  it('打卡加任务加记录之后，一次渲染：视图文件跟上数据', async () => {
    await addCheckin(ctx(), 'wake')
    await createTask(ctx(), { title: '写周报', addToToday: true })
    await test.session.close() // close 会先把没渲染的渲染掉
    const today = await (await import('node:fs/promises')).readFile(`${test.root}/今日.md`, 'utf8')
    expect(today).toContain('起床：12:00（电脑）')
    expect(today).toContain('- [ ] 写周报')
  })
})
