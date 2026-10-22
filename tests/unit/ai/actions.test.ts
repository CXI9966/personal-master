import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ACTIONS } from '../../../src/main/ai/actions'
import { ActionEngine, checkCall, type ExecutionOutcome } from '../../../src/main/ai/engine'
import { shortId } from '../../../src/main/ai/taskRef'
import { createTask } from '../../../src/main/app/services-tasks'
import { loadPlan, loadProfile, loadTasks } from '../../../src/main/domain/load'
import { PATHS } from '../../../src/shared/paths'
import { LearningCheck, WeightEntry, Workout } from '../../../src/shared/schema'
import { newTestId, openTestSession, useShanghaiTimezone } from '../app/helpers'

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
let n = 0

/** 校验 + 执行；大改动自动点确认 */
async function perform(name: string, input: unknown, confirm = true): Promise<ExecutionOutcome> {
  const engine = new ActionEngine(ctx(), newTestId)
  const checked = await checkCall(ctx(), { id: `c${++n}`, name, input }, ACTIONS)
  if (!checked.ok) throw new Error(`校验没通过：${checked.message}`)
  const outcome = await engine.execute(checked)
  if (outcome.card?.status === 'pending' && confirm) return { card: await engine.confirm(outcome.card.id, true), result: outcome.result }
  return outcome
}

describe('小改动', () => {
  it('add_task 带检验点和“加入今天”', async () => {
    await perform('add_task', { title: '学 Buck 电路', list: '学习', checkpoints: ['电感饱和会怎样？'], addToToday: true })
    const task = (await loadTasks(ctx().ws)).tasks[0]!
    expect(task).toMatchObject({ title: '学 Buck 电路', list: '学习', checkpoints: ['电感饱和会怎样？'] })
    expect((await loadPlan(ctx().ws, TODAY)).taskIds).toEqual([task.id])
  })

  it('update_task 用 8 位编号；complete_task', async () => {
    const task = await createTask(ctx(), { title: 'A' })
    await perform('update_task', { taskId: shortId(task.id), title: 'A2', due: '2026-10-30' })
    await perform('complete_task', { taskId: shortId(task.id) })
    expect((await loadTasks(ctx().ws)).tasks[0]).toMatchObject({ title: 'A2', due: '2026-10-30', status: 'done' })
  })

  it('add_plan_item、save_review', async () => {
    await perform('add_plan_item', { start: '09:00', end: '10:30', title: '电机选型' })
    await perform('save_review', { done: '选完了', learned: '堵转电流', change: '早点开始' })
    const plan = await loadPlan(ctx().ws, TODAY)
    expect(plan.timeline).toMatchObject([{ start: '09:00', end: '10:30', title: '电机选型' }])
    expect(plan.review).toMatchObject({ done: '选完了', learned: '堵转电流', change: '早点开始' })
  })

  it('record_learning_check：序号 L-0001、L-0002 依次递增，能关联到任务', async () => {
    const task = await createTask(ctx(), { title: 'Buck' })
    const first = await perform('record_learning_check', {
      topic: 'Buck 电路',
      taskId: shortId(task.id),
      checks: [{ q: '电感饱和会怎样？', result: 'mastered' }, { q: '占空比公式', result: 'partial' }],
    })
    expect(first.result).toBe('已记录学习检验 L-0001')
    expect(first.card?.summary).toBe('记录学习检验（Buck 电路）：掌握 1、部分掌握 1、没掌握 0')
    const second = await perform('record_learning_check', { topic: '另一个', checks: [{ q: 'q', result: 'missed' }] })
    expect(second.result).toBe('已记录学习检验 L-0002')
    const { items } = await ctx().ws.readLines(PATHS.learning, LearningCheck)
    expect(items.map((i) => i.seq)).toEqual([1, 2])
    expect(items[0]?.taskId).toBe(task.id)
    expect(items[1]?.taskId).toBeNull()
  })

  it('log_weight、log_workout', async () => {
    await perform('log_weight', { kg: 76.4 })
    await perform('log_workout', { summary: '跑步', durationMin: 30 })
    await perform('log_workout', { summary: '拉伸' })
    expect((await ctx().ws.readLines(PATHS.weight, WeightEntry)).items.map((w) => w.kg)).toEqual([76.4])
    expect((await ctx().ws.readLines(PATHS.workouts, Workout)).items.map((w) => w.durationMin)).toEqual([30, null])
  })
})

describe('大改动（确认后生效）', () => {
  it('set_day_plan：整天重排，一次改动；不给 energy 就不动精力', async () => {
    const a = await createTask(ctx(), { title: 'A' })
    const b = await createTask(ctx(), { title: 'B' })
    await perform('save_review', { done: 'x', learned: 'y', change: 'z' })
    const outcome = await perform('set_day_plan', {
      energy: 'low',
      timeline: [{ start: '14:00', end: '15:00', title: '看书' }, { start: '09:00', end: '10:00', title: '写代码' }],
      taskIds: [shortId(b.id), shortId(a.id)],
    })
    expect(outcome.card?.summary).toContain('时间安排 2 条')
    const plan = await loadPlan(ctx().ws, TODAY)
    expect(plan.energy).toBe('low')
    expect(plan.timeline.map((t) => t.title)).toEqual(['写代码', '看书'])
    expect(plan.taskIds).toEqual([b.id, a.id])
    expect(plan.review).not.toBeNull() // 复盘没被动

    await perform('set_day_plan', { timeline: [], taskIds: [] })
    expect((await loadPlan(ctx().ws, TODAY)).energy).toBe('low')
    expect((await loadPlan(ctx().ws, TODAY)).taskIds).toEqual([])
  })

  it('reschedule_tasks：批量改截止日期，也能清掉', async () => {
    const a = await createTask(ctx(), { title: 'A', due: '2026-10-25' })
    const b = await createTask(ctx(), { title: 'B' })
    await perform('reschedule_tasks', { items: [{ taskId: shortId(a.id), due: null }, { taskId: shortId(b.id), due: '2026-11-01' }] })
    expect((await loadTasks(ctx().ws)).tasks.map((t) => t.due)).toEqual([null, '2026-11-01'])
  })

  it('update_profile：只改给出的字段，其余不动', async () => {
    await perform('update_profile', { weightTargetKg: 70, gymDays: [5, 1, 1], fixed: [{ weekday: 3, start: '08:00', end: '09:40', title: '电力电子' }] })
    await perform('update_profile', { notes: '先稳住作息', weightTargetKg: null })
    const profile = await loadProfile(ctx().ws)
    expect(profile.goals).toEqual({ weightTargetKg: null, notes: '先稳住作息' })
    expect(profile.schedule.gymDays).toEqual([1, 5])
    expect(profile.schedule.fixed).toHaveLength(1)
  })

  it('不确认就什么也不会发生', async () => {
    const a = await createTask(ctx(), { title: 'A' })
    const outcome = await perform('delete_task', { taskId: shortId(a.id) }, false)
    expect(outcome.card?.status).toBe('pending')
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(1)
  })
})

describe('只读查询', () => {
  it('get_tasks：默认只列进行中的，带编号；可以按清单、按状态', async () => {
    const a = await createTask(ctx(), { title: '写周报', list: '学习', due: '2026-10-30' })
    const b = await createTask(ctx(), { title: '交报告' })
    await perform('complete_task', { taskId: shortId(b.id) })
    const open = (await perform('get_tasks', {})).result
    expect(open).toBe(`- [ ] ${shortId(a.id)} [学习] 写周报（截止 2026-10-30）`)
    expect((await perform('get_tasks', { status: 'done' })).result).toContain('交报告')
    expect((await perform('get_tasks', { list: '不存在' })).result).toBe('（没有）')
    expect((await perform('get_tasks', {})).card).toBeNull()
  })

  it('get_plan、get_records、get_profile', async () => {
    await perform('add_plan_item', { start: '09:00', end: '10:00', title: '电机选型' })
    await perform('log_workout', { summary: '跑步', durationMin: 30 })
    expect((await perform('get_plan', {})).result).toContain('09:00-10:00 电机选型')
    expect((await perform('get_plan', { date: '2026-01-01' })).result).toContain('还没选')
    expect((await perform('get_records', { days: 3 })).result).toContain('健身 1 次')
    expect((await perform('get_profile', {})).result).toBe('（用户还没填目标和作息）')
  })
})
