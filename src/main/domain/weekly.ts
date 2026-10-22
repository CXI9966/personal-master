import { datesBetween, shiftDate, startOfWeek } from '../../shared/calendar'
import type { HeatmapWeights, UsageEntry, WeeklyComment } from '../../shared/schema'
import type { WeeklyReportView } from '../../shared/views'
import { collectDays, scoresByDay, type Sources } from './heatmap'
import { describeWeek, weekRows, weeklyStats } from './stats'
import { summarizeUsageFrom } from './usage'

/** 已经结束、而且有记录的几周（周一的日期，最新的在前）。本周还没结束，不算 */
export function completedWeekStarts(scores: Map<string, number>, today: string, maxWeeks: number): string[] {
  const thisMonday = startOfWeek(today)
  const weeks: string[] = []
  for (let i = 1; i <= maxWeeks; i++) {
    const monday = shiftDate(thisMonday, -7 * i)
    if (datesBetween(monday, shiftDate(monday, 6)).some((day) => (scores.get(day) ?? 0) > 0)) weeks.push(monday)
  }
  return weeks
}

export interface WeeklyInput {
  sources: Sources
  dayStartsAt: string
  weights: HeatmapWeights
  today: string
  weeks: number
  usage: UsageEntry[]
  comments: WeeklyComment[]
}

/** 周报：正向口径的统计、每天一行、管家的用量，以及管家点评（点过才有） */
export function weeklyReportViews(input: WeeklyInput): WeeklyReportView[] {
  const { sources, dayStartsAt, weights } = input
  const config = { dayStartsAt, weights }
  const scores = scoresByDay(collectDays(sources, dayStartsAt), weights)
  const latestComment = new Map<string, WeeklyComment>()
  for (const comment of [...input.comments].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))) {
    latestComment.set(comment.weekStart, comment)
  }

  return completedWeekStarts(scores, input.today, input.weeks).map((monday) => {
    const stats = weeklyStats(monday, sources, config)
    const comment = latestComment.get(monday)
    return {
      weekKey: stats.weekKey,
      weekStart: stats.weekStart,
      weekEnd: stats.weekEnd,
      lines: describeWeek(stats),
      rows: weekRows(monday, sources, config),
      usage: summarizeUsageFrom(input.usage, dayStartsAt, monday),
      comment: comment ? { text: comment.text, at: comment.at } : null,
    }
  })
}
