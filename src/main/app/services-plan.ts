import { planPath } from '../../shared/paths'
import { PlanFile, type Energy, type TimelineItem } from '../../shared/schema'
import { DomainError } from '../domain/errors'
import { nowISO, logicalToday } from '../domain/day'
import { loadPlan, loadSettings, loadTasks } from '../domain/load'
import { saveReview, setEnergy, setPlanTasks, setTimeline } from '../domain/plan'
// 下面的 addPlanItem、applyDayPlan 给管家的动作用
import type { Tx } from '../store/types'
import type { AppContext } from './context'
import { mutate } from './services'

/** 今天的逻辑日期（按设置里的换日时间） */
export async function todayOf(tx: Tx, ctx: AppContext): Promise<string> {
  return logicalToday((await loadSettings(tx)).dayStartsAt, ctx.now())
}

/** 读今天的计划，改完写回去。所有“改今天计划”的操作都走这里 */
export async function editTodayPlan(
  tx: Tx,
  ctx: AppContext,
  change: (plan: PlanFile) => PlanFile,
): Promise<void> {
  const date = await todayOf(tx, ctx)
  await tx.writeJson(planPath(date), change(await loadPlan(tx, date)), PlanFile)
}

export const updateEnergy = (ctx: AppContext, energy: Energy | null): Promise<void> =>
  mutate(ctx, '选择精力状态', (tx) => editTodayPlan(tx, ctx, (plan) => setEnergy(plan, energy)))

/** 整个替换今天的时间安排 */
export const updateTimeline = (ctx: AppContext, items: TimelineItem[]): Promise<void> =>
  mutate(ctx, '修改时间安排', (tx) => editTodayPlan(tx, ctx, (plan) => setTimeline(plan, items)))

/** 整个替换今天计划里的任务；任务必须都存在 */
export const updatePlanTasks = (ctx: AppContext, taskIds: string[]): Promise<void> =>
  mutate(ctx, '修改今日任务', async (tx) => {
    const known = new Set((await loadTasks(tx)).tasks.map((task) => task.id))
    const missing = taskIds.find((id) => !known.has(id))
    if (missing) throw new DomainError('not-found', `找不到任务：${missing}`)
    await editTodayPlan(tx, ctx, (plan) => setPlanTasks(plan, taskIds))
  })

/** 在今天的时间安排里加一条 */
export const addPlanItem = (ctx: AppContext, item: { start: string; end: string; title: string }): Promise<void> =>
  mutate(ctx, '加一条安排', (tx) =>
    editTodayPlan(tx, ctx, (plan) => setTimeline(plan, [...plan.timeline, { ...item, taskId: null }])),
  )

/** 整天重排：时间安排和任务整个替换，精力给了才改。一次改动，可以整体撤销 */
export const applyDayPlan = (
  ctx: AppContext,
  input: { energy?: Energy | null; timeline: Array<{ start: string; end: string; title: string }>; taskIds: string[] },
): Promise<void> =>
  mutate(ctx, '重排今天', async (tx) => {
    const known = new Set((await loadTasks(tx)).tasks.map((task) => task.id))
    const missing = input.taskIds.find((id) => !known.has(id))
    if (missing) throw new DomainError('not-found', `找不到任务：${missing}`)
    await editTodayPlan(tx, ctx, (plan) => {
      const withTimeline = setTimeline(plan, input.timeline.map((item) => ({ ...item, taskId: null })))
      const withTasks = setPlanTasks(withTimeline, input.taskIds)
      return input.energy === undefined ? withTasks : setEnergy(withTasks, input.energy)
    })
  })

export const updateReview =(ctx: AppContext, input: { done: string; learned: string; change: string }): Promise<void> =>
  mutate(ctx, '保存复盘', (tx) => editTodayPlan(tx, ctx, (plan) => saveReview(plan, input, nowISO(ctx.now()))))
