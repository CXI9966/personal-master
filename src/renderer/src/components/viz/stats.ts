import { clockOf, minutesOfDay } from '../../../../shared/calendar'
import type { WeightEntry } from '../../../../shared/schema'
import type { CheckinRow, HeatCell } from '../../../../shared/views'

// 画图用的数据，全部从界面已经拿到的快照里算出来，不需要主进程再提供什么

export interface DayScore {
  date: string
  score: number
}

export interface Point {
  label: string
  value: number
}

const past = (cells: HeatCell[]): HeatCell[] => cells.filter((cell) => !cell.future)

/** 最近 7 天（含今天）每天的得分 */
export const lastSevenDays = (cells: HeatCell[]): DayScore[] => past(cells).slice(-7).map(({ date, score }) => ({ date, score }))

export const sumScores = (days: DayScore[]): number => days.reduce((sum, day) => sum + day.score, 0)

/** 再往前 7 天的总分，用来和最近 7 天比 */
export const previousSevenTotal = (cells: HeatCell[]): number => past(cells).slice(-14, -7).reduce((sum, cell) => sum + cell.score, 0)

/** 连续有记录的天数。今天还没有记录时从昨天往前数，免得一大早就显示 0 */
export function streak(cells: HeatCell[]): number {
  const days = past(cells)
  let i = days.length - 1
  if (i >= 0 && days[i]?.score === 0) i -= 1
  let count = 0
  while (i >= 0 && (days[i]?.score ?? 0) > 0) {
    count += 1
    i -= 1
  }
  return count
}

/** 体重曲线：最近 max 条，从早到晚 */
export const weightPoints = (weights: WeightEntry[], max = 30): Point[] => weights.slice(-max).map((w) => ({ label: w.at.slice(5, 10), value: w.kg }))

/** 起床时间曲线：最近 max 个有起床打卡的日子，值是小时（7.5 = 07:30），从早到晚 */
export function wakePoints(rows: CheckinRow[], max = 14): Point[] {
  return rows
    .flatMap((row) => (row.wake ? [{ label: row.date.slice(5), value: minutesOfDay(clockOf(row.wake.at)) / 60 }] : []))
    .slice(0, max)
    .reverse()
}

/** 7.5 → 07:30 */
export function hourText(hours: number): string {
  const minutes = Math.round(hours * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
