import type { ZodType } from 'zod'
import { daysBetween, shiftDate, weekdayName, weekdayOf } from '../../shared/calendar'
import { PATHS, planPath } from '../../shared/paths'
import { PlanFile, ProfileFile, SettingsFile, TasksFile } from '../../shared/schema'
import type { AutostartInfo, DaySnapshot, HealthProblem, RecordsSnapshot, SettingsSnapshot, TodaySnapshot } from '../../shared/views'
import { checkinsByDay, pickCheckins } from '../domain/checkin'
import { logicalDateOf, logicalToday } from '../domain/day'
import { collectDays, dayScore, heatmapCells, scoresByDay } from '../domain/heatmap'
import { WorkspaceError } from '../store/errors'
import { loadPlan, loadProfile, loadSettings, loadSources, loadTasks } from '../domain/load'
import { openTasks } from '../domain/tasks'
import { unfinishedFromPlan } from '../domain/plan'
import type { AppContext } from './context'

/** 隔了这么多天没有任何记录再回来，只显示“欢迎回来” */
export const WELCOME_BACK_DAYS = 3
export const HEATMAP_WEEKS = 12

export const RECORD_HEATMAP_WEEKS = 53

/** 点热力图的格子：那一天做了什么 */
export async function buildDay(ctx: AppContext, date: string): Promise<DaySnapshot> {
  const { ws } = ctx
  const settings = await loadSettings(ws)
  const tasksFile = await loadTasks(ws)
  const { sources } = await loadSources(ws)
  const { dayStartsAt } = settings
  const plan = await loadPlan(ws, date)
  const picked = pickCheckins(sources.checkins, date, dayStartsAt)
  const data = collectDays(sources, dayStartsAt).get(date)
  const onDay = <T extends { at: string }>(items: T[]): T[] => items.filter((item) => logicalDateOf(item.at, dayStartsAt) === date)
  const taskById = new Map(tasksFile.tasks.map((task) => [task.id, task]))
  return {
    date,
    weekday: weekdayName(date),
    score: data ? Math.round(dayScore(data, settings.heatmap.weights) * 10) / 10 : 0,
    plan,
    planTasks: plan.taskIds.flatMap((id) => taskById.get(id) ?? []),
    doneTasks: tasksFile.tasks.filter((task) => task.status === 'done' && task.doneAt && logicalDateOf(task.doneAt, dayStartsAt) === date),
    wake: picked.wake,
    sleep: picked.sleep,
    weights: onDay(sources.weights),
    workouts: onDay(sources.workouts),
    learning: onDay(sources.learning),
  }
}

/** 记录页：全年热力图、打卡、体重、健身、学习检验 */
export async function buildRecords(ctx: AppContext): Promise<RecordsSnapshot> {
  const settings = await loadSettings(ctx.ws)
  const profile = await loadProfile(ctx.ws)
  const { sources, warnings } = await loadSources(ctx.ws)
  const { dayStartsAt } = settings
  const today = logicalToday(dayStartsAt, ctx.now())
  const scores = scoresByDay(collectDays(sources, dayStartsAt), settings.heatmap.weights)
  const byTime = (a: { at: string }, b: { at: string }): number => Date.parse(a.at) - Date.parse(b.at)
  return {
    today,
    heatmap: heatmapCells(scores, today, RECORD_HEATMAP_WEEKS),
    checkins: [...checkinsByDay(sources.checkins, dayStartsAt)]
      .map(([date, picked]) => ({ date, wake: picked.wake, sleep: picked.sleep }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 60),
    weights: [...sources.weights].sort(byTime),
    weightTargetKg: profile.goals.weightTargetKg,
    workouts: [...sources.workouts].sort(byTime).reverse().slice(0, 100),
    learning: [...sources.learning].sort((a, b) => b.seq - a.seq).slice(0, 100),
    warnings,
  }
}

export async function buildSettings(ctx: AppContext, workspaceRoot: string, autostart: AutostartInfo): Promise<SettingsSnapshot> {
  return { workspaceRoot, settings: await loadSettings(ctx.ws), profile: await loadProfile(ctx.ws), autostart }
}

/** 核心数据文件（设置、目标、任务库、今天的计划）有没有读不出来的 */
export async function checkHealth(ctx: AppContext): Promise<HealthProblem[]> {
  const { ws } = ctx
  const problems: HealthProblem[] = []
  const check = async (rel: string, schema: ZodType): Promise<void> => {
    try {
      await ws.readJson(rel, schema)
    } catch (error) {
      if (error instanceof WorkspaceError && error.code !== 'missing') problems.push({ rel, message: error.message })
      else if (!(error instanceof WorkspaceError)) throw error
    }
  }
  await check(PATHS.settings, SettingsFile)
  await check(PATHS.profile, ProfileFile)
  await check(PATHS.tasks, TasksFile)
  let dayStartsAt = '04:00'
  try {
    dayStartsAt = (await loadSettings(ws)).dayStartsAt
  } catch {
    // 设置坏了，用默认的换日时间找今天的计划
  }
  await check(planPath(logicalToday(dayStartsAt, ctx.now())), PlanFile)
  return problems
}

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
    warnings,
  }
}
