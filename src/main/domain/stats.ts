import type { CheckResult, HeatmapWeights } from '../../shared/schema'
import { checkinsByDay } from './checkin'
import { datesBetween, isoWeekOf, logicalDateOf, minutesOfDay, shiftDate, startOfWeek, wallMinutesOf } from './day'
import { collectDays, dayScore, type Sources } from './heatmap'

export interface WeeklyStats {
  weekKey: string
  weekStart: string
  weekEnd: string
  wakeDays: number
  sleepDays: number
  /** 平均时间 HH:mm，没有打卡为 null；睡前过了午夜也能正确平均 */
  avgWake: string | null
  avgSleep: string | null
  reviews: number
  tasksDone: number
  workouts: number
  weightFirst: number | null
  weightLast: number | null
  weightDelta: number | null
  learning: Record<CheckResult, number>
  score: number
  activeDays: number
}

const round1 = (value: number): number => Math.round(value * 10) / 10

export function formatMinutes(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const average = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length

/** 统计一周（周一到周日）。weekStart 传这周里的任意一天都行 */
export function weeklyStats(
  weekStart: string,
  sources: Sources,
  config: { dayStartsAt: string; weights: HeatmapWeights },
): WeeklyStats {
  const start = startOfWeek(weekStart)
  const end = shiftDate(start, 6)
  const dates = datesBetween(start, end)
  const days = collectDays(sources, config.dayStartsAt)
  const picked = checkinsByDay(sources.checkins, config.dayStartsAt)
  const dayStartMinutes = minutesOfDay(config.dayStartsAt)

  const wakeMinutes: number[] = []
  const sleepMinutes: number[] = []
  const stats: WeeklyStats = {
    weekKey: isoWeekOf(start).key,
    weekStart: start,
    weekEnd: end,
    wakeDays: 0,
    sleepDays: 0,
    avgWake: null,
    avgSleep: null,
    reviews: 0,
    tasksDone: 0,
    workouts: 0,
    weightFirst: null,
    weightLast: null,
    weightDelta: null,
    learning: { mastered: 0, partial: 0, missed: 0 },
    score: 0,
    activeDays: 0,
  }

  for (const date of dates) {
    const data = days.get(date)
    if (!data) continue
    const score = dayScore(data, config.weights)
    stats.score += score
    if (score > 0) stats.activeDays++
    if (data.review) stats.reviews++
    stats.tasksDone += data.tasksDone
    stats.workouts += data.workouts
    for (const key of ['mastered', 'partial', 'missed'] as const) stats.learning[key] += data.learning[key]
    const checkins = picked.get(date)
    if (checkins?.wake) {
      stats.wakeDays++
      wakeMinutes.push(wallMinutesOf(checkins.wake.at))
    }
    if (checkins?.sleep) {
      stats.sleepDays++
      const minutes = wallMinutesOf(checkins.sleep.at)
      sleepMinutes.push(minutes < dayStartMinutes ? minutes + 1440 : minutes) // 午夜之后的睡前往后接
    }
  }

  const avgWake = average(wakeMinutes)
  const avgSleep = average(sleepMinutes)
  stats.avgWake = avgWake === null ? null : formatMinutes(avgWake)
  stats.avgSleep = avgSleep === null ? null : formatMinutes(avgSleep)
  stats.score = round1(stats.score)

  const weights = sources.weights
    .filter((entry) => {
      const date = logicalDateOf(entry.at, config.dayStartsAt)
      return date >= start && date <= end
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const first = weights[0]
  const last = weights.at(-1)
  if (first && last) {
    stats.weightFirst = first.kg
    stats.weightLast = last.kg
    if (weights.length > 1) stats.weightDelta = round1(last.kg - first.kg)
  }
  return stats
}

/** 周报用的说明，全是正向口径：只说做到的，没有记录的项目不出现 */
export function describeWeek(stats: WeeklyStats): string[] {
  const lines: string[] = []
  if (stats.wakeDays > 0) lines.push(`起床打卡 ${stats.wakeDays}/7 天${stats.avgWake ? `，平均 ${stats.avgWake}` : ''}`)
  if (stats.sleepDays > 0) lines.push(`睡前打卡 ${stats.sleepDays}/7 天${stats.avgSleep ? `，平均 ${stats.avgSleep}` : ''}`)
  if (stats.reviews > 0) lines.push(`复盘 ${stats.reviews} 次`)
  if (stats.tasksDone > 0) lines.push(`完成任务 ${stats.tasksDone} 个`)
  if (stats.workouts > 0) lines.push(`健身 ${stats.workouts} 次`)
  if (stats.weightLast !== null) {
    const delta = stats.weightDelta
    lines.push(`体重 ${stats.weightLast} kg${delta === null ? '' : `（较周初 ${delta > 0 ? '+' : ''}${delta} kg）`}`)
  }
  const { mastered, partial, missed } = stats.learning
  if (mastered + partial + missed > 0) lines.push(`学习检验：掌握 ${mastered}，部分掌握 ${partial}，没掌握 ${missed}`)
  if (stats.activeDays > 0) lines.push(`有记录的天数 ${stats.activeDays} 天，共 ${stats.score} 分`)
  return lines.length > 0 ? lines : ['这一周还没有记录，从今天开始就好']
}
