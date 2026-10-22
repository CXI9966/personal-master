import { weekdayName } from '../../shared/calendar'
import { usageLine } from '../../shared/usageText'
import type { WeeklyReportView } from '../../shared/views'
import { mdTable, withMarker } from './common'

/** 归档/<年>/<年-Www>/周报.md */
export function renderWeeklyReport(view: WeeklyReportView): string {
  const lines = [`# 周报 · ${view.weekKey}（${view.weekStart} ~ ${view.weekEnd}）`, '', '## 这一周做到的']
  for (const line of view.lines) lines.push(`- ${line}`)

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

  lines.push('', '## 管家用量', `- ${usageLine(view.usage)}`)
  lines.push('', '## 管家点评', view.comment ? view.comment.text : '（还没有点评。在记录页的周报里点“让管家点评”。）')
  return withMarker(lines.join('\n'))
}
