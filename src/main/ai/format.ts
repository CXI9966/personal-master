// 把数据整理成给模型看的中文文字。上下文和查询工具共用。

import { clockOf, weekdayLabel, weekdayName } from '../../shared/calendar'
import { ENERGY_LABELS, RESULT_LABELS } from '../../shared/labels'
import type { FixedItem, LearningCheck, PlanFile, ProfileFile, Task } from '../../shared/schema'
import { checkinsByDay } from '../domain/checkin'
import { collectDays, type Sources } from '../domain/heatmap'
import { datesBetween, shiftDate } from '../domain/day'
import { shortId } from './taskRef'

export function taskLine(task: Task): string {
  const box = task.status === 'done' ? '[x]' : '[ ]'
  const due = task.due ? `（截止 ${task.due}）` : ''
  const checks = task.checkpoints.length > 0 ? `（检验点：${task.checkpoints.join('；')}）` : ''
  return `- ${box} ${shortId(task.id)} [${task.list}] ${task.title}${due}${checks}`
}

export function taskLines(tasks: Task[], limit = 30): string {
  if (tasks.length === 0) return '（没有）'
  const shown = tasks.slice(0, limit).map(taskLine)
  if (tasks.length > limit) shown.push(`（还有 ${tasks.length - limit} 条没列出）`)
  return shown.join('\n')
}

export function fixedLines(items: FixedItem[]): string {
  return items.length === 0
    ? '（没有）'
    : items.map((item) => `- ${weekdayLabel(item.weekday)} ${item.start}-${item.end} ${item.title}`).join('\n')
}

/** 一天的计划：精力、时间安排、任务、复盘 */
export function planText(plan: PlanFile, taskById: Map<string, Task>): string {
  const tasks = plan.taskIds.flatMap((id) => taskById.get(id) ?? [])
  return [
    `精力：${plan.energy ? ENERGY_LABELS[plan.energy] : '还没选'}`,
    '时间安排：',
    plan.timeline.length === 0 ? '（还没有）' : plan.timeline.map((item) => `- ${item.start}-${item.end} ${item.title}`).join('\n'),
    '任务：',
    taskLines(tasks),
    `复盘：${plan.review ? `已写（完成了 ${plan.review.done || '—'}；学会了 ${plan.review.learned || '—'}；明天改 ${plan.review.change || '—'}）` : '还没写'}`,
  ].join('\n')
}

/** 最近 days 天每天做了什么，最新的在前；没有记录的日子不列 */
export function recentDaysText(sources: Sources, dayStartsAt: string, today: string, days: number): string {
  const data = collectDays(sources, dayStartsAt)
  const picked = checkinsByDay(sources.checkins, dayStartsAt)
  const lines: string[] = []
  for (const date of datesBetween(shiftDate(today, -(days - 1)), today).reverse()) {
    const d = data.get(date)
    if (!d) continue
    const c = picked.get(date)
    const parts = [
      c?.wake && `起床 ${clockOf(c.wake.at)}`,
      c?.sleep && `睡前 ${clockOf(c.sleep.at)}`,
      d.tasksDone > 0 && `完成任务 ${d.tasksDone} 个`,
      d.workouts > 0 && `健身 ${d.workouts} 次`,
      d.review && '已复盘',
    ].filter(Boolean)
    lines.push(`- ${date.slice(5)} ${weekdayName(date)}：${parts.join('，') || '有记录'}`)
  }
  return lines.length > 0 ? lines.join('\n') : '（最近几天还没有记录）'
}

export function profileText(profile: ProfileFile): string {
  const { goals, schedule } = profile
  const lines = [
    goals.weightTargetKg !== null && `目标体重：${goals.weightTargetKg} kg`,
    goals.notes.trim() && `目标备注：${goals.notes.trim()}`,
    schedule.wakeTarget && `起床目标：${schedule.wakeTarget}`,
    schedule.sleepTarget && `睡前目标：${schedule.sleepTarget}`,
    schedule.gymDays.length > 0 && `健身日：${schedule.gymDays.map(weekdayLabel).join('、')}`,
    schedule.fixed.length > 0 && `每周固定安排：\n${fixedLines(schedule.fixed)}`,
  ].filter(Boolean)
  return lines.length > 0 ? lines.join('\n') : '（用户还没填目标和作息）'
}

export function learningText(entries: LearningCheck[], limit = 5): string {
  if (entries.length === 0) return '（还没有）'
  return [...entries]
    .sort((a, b) => b.seq - a.seq)
    .slice(0, limit)
    .map((entry) => `- ${entry.topic}：${entry.checks.map((c) => `${c.q}→${RESULT_LABELS[c.result]}`).join('；')}`)
    .join('\n')
}
