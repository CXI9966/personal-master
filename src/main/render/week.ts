import { weekdayLabel, weekdayName } from '../../shared/calendar'
import type { FixedItem } from '../../shared/schema'
import type { WeekRow, WeeklyStats } from '../domain/stats'
import { describeWeek } from '../domain/stats'
import { mdTable, withMarker } from './common'

export interface WeekView {
  stats: WeeklyStats
  rows: WeekRow[]
  fixed: FixedItem[]
}

export function renderWeek(view: WeekView): string {
  const { stats } = view
  const lines = [`# 本周 · ${stats.weekKey}（${stats.weekStart} ~ ${stats.weekEnd}）`, '', '## 统计']
  for (const line of describeWeek(stats)) lines.push(`- ${line}`)

  lines.push('', '## 每天')
  lines.push(
    mdTable(
      ['日期', '起床', '睡前', '完成任务', '分数'],
      view.rows.map((row) => [
        `${row.date.slice(5)} ${weekdayName(row.date)}`,
        row.wake ?? '',
        row.sleep ?? '',
        row.tasksDone > 0 ? String(row.tasksDone) : '',
        row.score > 0 ? String(row.score) : '',
      ]),
    ),
  )

  lines.push('', '## 每周固定安排')
  if (view.fixed.length === 0) {
    lines.push('（还没填）')
  } else {
    const sorted = [...view.fixed].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))
    for (const item of sorted) lines.push(`- ${weekdayLabel(item.weekday)} ${item.start}-${item.end} ${item.title}`)
  }
  return withMarker(lines.join('\n'))
}
