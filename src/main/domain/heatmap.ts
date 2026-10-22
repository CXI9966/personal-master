import type {
  Checkin,
  CheckResult,
  HeatmapWeights,
  LearningCheck,
  PlanFile,
  Task,
  WeightEntry,
  Workout,
} from '../../shared/schema'
import type { HeatCell, HeatLevel } from '../../shared/views'
import { checkinsByDay } from './checkin'
import { datesBetween, logicalDateOf, shiftDate, startOfWeek } from './day'

/** 计分和统计用到的全部原始记录 */
export interface Sources {
  checkins: Checkin[]
  tasks: Task[]
  weights: WeightEntry[]
  workouts: Workout[]
  /** 只需要带复盘的计划，其余的传不传都行 */
  plans: PlanFile[]
  learning: LearningCheck[]
}

/** 某一天做了什么（已经按逻辑日期汇总） */
export interface DayData {
  wake: boolean
  sleep: boolean
  tasksDone: number
  weight: boolean
  workouts: number
  review: boolean
  learning: Record<CheckResult, number>
}

export const emptyDayData = (): DayData => ({
  wake: false,
  sleep: false,
  tasksDone: 0,
  weight: false,
  workouts: 0,
  review: false,
  learning: { mastered: 0, partial: 0, missed: 0 },
})

export function dayScore(data: DayData, w: HeatmapWeights): number {
  return (
    ((data.wake ? 1 : 0) + (data.sleep ? 1 : 0)) * w.checkin +
    data.tasksDone * w.taskDone +
    (data.weight ? w.weight : 0) + // 记体重每天最多算一次
    data.workouts * w.workout +
    (data.review ? w.review : 0) +
    data.learning.mastered * w.learnMastered +
    data.learning.partial * w.learnPartial +
    data.learning.missed * w.learnMissed
  )
}

export function collectDays(sources: Sources, dayStartsAt: string): Map<string, DayData> {
  const days = new Map<string, DayData>()
  const day = (date: string): DayData => {
    let data = days.get(date)
    if (!data) {
      data = emptyDayData()
      days.set(date, data)
    }
    return data
  }

  for (const [date, picked] of checkinsByDay(sources.checkins, dayStartsAt)) {
    if (picked.wake) day(date).wake = true
    if (picked.sleep) day(date).sleep = true
  }
  for (const task of sources.tasks) {
    if (task.status === 'done' && task.doneAt) day(logicalDateOf(task.doneAt, dayStartsAt)).tasksDone++
  }
  for (const entry of sources.weights) day(logicalDateOf(entry.at, dayStartsAt)).weight = true
  for (const workout of sources.workouts) day(logicalDateOf(workout.at, dayStartsAt)).workouts++
  for (const plan of sources.plans) {
    if (plan.review) day(plan.date).review = true
  }
  for (const entry of sources.learning) {
    const data = day(logicalDateOf(entry.at, dayStartsAt))
    for (const check of entry.checks) data.learning[check.result]++
  }
  return days
}

export function scoresByDay(days: Map<string, DayData>, weights: HeatmapWeights): Map<string, number> {
  return new Map([...days].map(([date, data]) => [date, dayScore(data, weights)]))
}

export type { HeatCell, HeatLevel }
export type Thresholds = [number, number, number]

/** 线性插值的分位数，sorted 必须已经升序 */
function quantile(sorted: number[], p: number): number {
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sorted[lo] ?? 0
  const b = sorted[hi] ?? a
  return a + (b - a) * (pos - lo)
}

/** 跟自己比：最近 365 天里分数大于 0 的日子，取 1/4、1/2、3/4 分位作为分档线；没有数据返回 null */
export function levelThresholds(scores: Map<string, number>, today: string): Thresholds | null {
  const from = shiftDate(today, -364)
  const positives = [...scores]
    .filter(([date, score]) => score > 0 && date >= from && date <= today)
    .map(([, score]) => score)
    .sort((a, b) => a - b)
  if (positives.length === 0) return null
  return [quantile(positives, 0.25), quantile(positives, 0.5), quantile(positives, 0.75)]
}

export function heatLevelOf(score: number, thresholds: Thresholds | null): HeatLevel {
  if (score <= 0) return 0
  if (!thresholds) return 1
  if (score <= thresholds[0]) return 1
  if (score <= thresholds[1]) return 2
  if (score <= thresholds[2]) return 3
  return 4
}

/** 最近 weeks 周，从周一排到本周日，共 weeks*7 格 */
export function heatmapCells(scores: Map<string, number>, today: string, weeks: number): HeatCell[] {
  const monday = startOfWeek(today)
  const dates = datesBetween(shiftDate(monday, -7 * (weeks - 1)), shiftDate(monday, 6))
  const thresholds = levelThresholds(scores, today)
  return dates.map((date) => {
    const score = scores.get(date) ?? 0
    return { date, score, level: heatLevelOf(score, thresholds), future: date > today }
  })
}
