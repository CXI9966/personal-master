import { daysBetween, shiftDate, weekdayOf } from '../../shared/calendar'
import type { TodaySnapshot } from '../../shared/views'
import { pickCheckins } from '../domain/checkin'
import { logicalToday } from '../domain/day'
import { collectDays, heatmapCells, scoresByDay } from '../domain/heatmap'
import { loadPlan, loadProfile, loadSettings, loadSources, loadTasks } from '../domain/load'
import { openTasks } from '../domain/tasks'
import { unfinishedFromPlan } from '../domain/plan'
import type { AppContext } from './context'

/** 隔了这么多天没有任何记录再回来，只显示“欢迎回来” */
export const WELCOME_BACK_DAYS = 3
export const HEATMAP_WEEKS = 12

/** 今日页需要的一切：计划、任务、打卡、最近 12 周热力图…… */
export async function buildToday(ctx: AppContext): Promise<TodaySnapshot> {
  const { ws } = ctx
  const settings = await loadSettings(ws)
  const profile = await loadProfile(ws)
  const tasksFile = await loadTasks(ws)
  const { sources, warnings } = await loadSources(ws)
  const { dayStartsAt } = settings
  const date = logicalToday(dayStartsAt, ctx.now())

  const plan = await loadPlan(ws, date)
  const picked = pickCheckins(sources.checkins, date, dayStartsAt)
  const scores = scoresByDay(collectDays(sources, dayStartsAt), settings.heatmap.weights)

  const lastActive = [...scores]
    .filter(([, score]) => score > 0)
    .map(([day]) => day)
    .sort()
    .at(-1)
  const welcomeBack = lastActive !== undefined && daysBetween(lastActive, date) >= WELCOME_BACK_DAYS

  const inPlan = new Set(plan.taskIds)
  const taskById = new Map(tasksFile.tasks.map((task) => [task.id, task]))
  const yesterday = welcomeBack ? null : await loadPlan(ws, shiftDate(date, -1))

  return {
    date,
    dayStartsAt,
    plan,
    planTasks: plan.taskIds.flatMap((id) => taskById.get(id) ?? []),
    openTasks: openTasks(tasksFile),
    lists: tasksFile.lists,
    unfinished: unfinishedFromPlan(yesterday, tasksFile).filter((task) => !inPlan.has(task.id)),
    fixedToday: profile.schedule.fixed.filter((item) => item.weekday === weekdayOf(date)),
    wake: picked.wake,
    sleep: picked.sleep,
    heatmap: heatmapCells(scores, date, HEATMAP_WEEKS),
    welcomeBack,
    lastChange: ws.lastChange(),
    warnings,
  }
}
