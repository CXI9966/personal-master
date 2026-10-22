import { clockOf, isoWeekOf, weekdayName } from '../../shared/calendar'
import { ENERGY_LABELS, SOURCE_LABELS } from '../../shared/labels'
import type { Checkin, PlanFile, Task } from '../../shared/schema'
import { withMarker } from './common'

export interface TodayView {
  date: string
  plan: PlanFile
  /** 计划里引用的任务（已按计划顺序解析，找不到的已去掉） */
  tasks: Task[]
  wake: Checkin | null
  sleep: Checkin | null
}

const stamp = (checkin: Checkin): string => `${clockOf(checkin.at)}（${SOURCE_LABELS[checkin.source]}）`

export function taskLine(task: Task): string {
  const box = task.status === 'done' ? '[x]' : '[ ]'
  const due = task.due && task.status !== 'done' ? `（截止 ${task.due}）` : ''
  return `- ${box} ${task.title}${due}`
}

export function renderToday(view: TodayView): string {
  const { date, plan } = view
  const lines: string[] = [`# 今日 · ${date} ${weekdayName(date)} · 第 ${isoWeekOf(date).week} 周`, '']

  lines.push('## 打卡')
  if (!view.wake && !view.sleep) lines.push('- 今天还没有打卡')
  if (view.wake) lines.push(`- 起床：${stamp(view.wake)}`)
  if (view.sleep) lines.push(`- 睡前：${stamp(view.sleep)}`)

  lines.push('', '## 精力', plan.energy ? `- ${ENERGY_LABELS[plan.energy]}` : '- 还没选')

  lines.push('', '## 时间安排')
  if (plan.timeline.length === 0) lines.push('- 还没有安排')
  for (const item of plan.timeline) lines.push(`- ${item.start}-${item.end} ${item.title}`)

  lines.push('', '## 今日任务')
  if (view.tasks.length === 0) lines.push('- 还没有排任务')
  for (const task of view.tasks) lines.push(taskLine(task))

  lines.push('', '## 复盘')
  if (!plan.review) {
    lines.push('- 还没有复盘')
  } else {
    lines.push(`- 完成了什么：${plan.review.done}`)
    lines.push(`- 学会了什么：${plan.review.learned}`)
    lines.push(`- 明天改什么：${plan.review.change}`)
  }
  return withMarker(lines.join('\n'))
}
