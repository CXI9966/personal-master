import { HHmm, type Energy, type PlanFile, type Task, type TasksFile, type TimelineItem } from '../../shared/schema'
import { DomainError } from './errors'

function checkItem(item: TimelineItem): TimelineItem {
  if (!HHmm.safeParse(item.start).success || !HHmm.safeParse(item.end).success) {
    throw new DomainError('invalid', `时间格式应为 HH:mm：${item.start} - ${item.end}`)
  }
  if (item.end <= item.start) throw new DomainError('invalid', `结束时间要晚于开始时间：${item.start} - ${item.end}`)
  const title = item.title.trim()
  if (!title) throw new DomainError('invalid', '事项标题不能为空')
  return { ...item, title }
}

const byStart = (a: TimelineItem, b: TimelineItem): number => a.start.localeCompare(b.start)

export function setEnergy(plan: PlanFile, energy: Energy | null): PlanFile {
  return { ...plan, energy }
}

export function setTimeline(plan: PlanFile, items: TimelineItem[]): PlanFile {
  return { ...plan, timeline: items.map(checkItem).sort(byStart) }
}

export function addTimelineItem(plan: PlanFile, item: TimelineItem): PlanFile {
  return setTimeline(plan, [...plan.timeline, item])
}

export function removeTimelineItem(plan: PlanFile, index: number): PlanFile {
  if (!Number.isInteger(index) || index < 0 || index >= plan.timeline.length) {
    throw new DomainError('not-found', `没有第 ${index + 1} 条时间安排`)
  }
  return { ...plan, timeline: plan.timeline.filter((_, i) => i !== index) }
}

export function setPlanTasks(plan: PlanFile, taskIds: string[]): PlanFile {
  return { ...plan, taskIds: [...new Set(taskIds)] }
}

export function addTaskToPlan(plan: PlanFile, taskId: string): PlanFile {
  return setPlanTasks(plan, [...plan.taskIds, taskId])
}

export function removeTaskFromPlan(plan: PlanFile, taskId: string): PlanFile {
  return { ...plan, taskIds: plan.taskIds.filter((id) => id !== taskId) }
}

export function saveReview(
  plan: PlanFile,
  input: { done: string; learned: string; change: string },
  at: string,
): PlanFile {
  return {
    ...plan,
    review: { done: input.done.trim(), learned: input.learned.trim(), change: input.change.trim(), at },
  }
}

/** 昨天计划里的任务，现在还没完成的（顺序同计划） */
export function unfinishedFromPlan(prev: PlanFile | null, tasks: TasksFile): Task[] {
  if (!prev) return []
  const open = new Map(tasks.tasks.filter((t) => t.status === 'open').map((t) => [t.id, t]))
  return prev.taskIds.flatMap((id) => open.get(id) ?? [])
}
