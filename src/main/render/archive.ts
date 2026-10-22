import { isoWeekOf, weekdayName } from '../../shared/calendar'
import { ENERGY_LABELS } from '../../shared/labels'
import type { PlanFile, Task } from '../../shared/schema'
import { withMarker } from './common'
import { taskLine } from './today'

/** 一个计划有没有值得存档的内容 */
export function planHasContent(plan: PlanFile): boolean {
  return plan.energy !== null || plan.timeline.length > 0 || plan.taskIds.length > 0 || plan.review !== null
}

/** 归档/<年>/<年-Www>/<日期>.md：当天的精力、时间安排、任务和复盘 */
export function renderDayArchive(plan: PlanFile, tasks: Task[]): string {
  const lines = [`# ${plan.date} ${weekdayName(plan.date)} · ${isoWeekOf(plan.date).key}`, '']
  if (plan.energy) lines.push(`精力：${ENERGY_LABELS[plan.energy]}`, '')
  if (plan.timeline.length > 0) {
    lines.push('## 时间安排')
    for (const item of plan.timeline) lines.push(`- ${item.start}-${item.end} ${item.title}`)
    lines.push('')
  }
  if (tasks.length > 0) {
    lines.push('## 任务')
    for (const task of tasks) lines.push(taskLine(task))
    lines.push('')
  }
  if (plan.review) {
    lines.push('## 复盘')
    lines.push(`- 完成了什么：${plan.review.done}`)
    lines.push(`- 学会了什么：${plan.review.learned}`)
    lines.push(`- 明天改什么：${plan.review.change}`)
  }
  return withMarker(lines.join('\n'))
}
