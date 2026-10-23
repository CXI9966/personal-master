import { clockOf } from '../../shared/calendar'
import type { TodaySnapshot } from '../../shared/views'

/** 桌宠关心的今日摘要：和上一次比，就知道刚刚发生了什么 */
export interface PetSummary {
  date: string
  wake: boolean
  sleep: boolean
  planned: boolean
  reviewed: boolean
  /** 今天计划里已经完成的任务数 */
  done: number
  /** 最近完成的那个任务的标题 */
  lastDone: string | null
  wakeClock: string | null
}

export type PetEventKind = 'wake' | 'sleep' | 'taskDone' | 'planned' | 'reviewed' | 'remindPlan' | 'remindReview' | 'welcomeBack'

export function summarize(snapshot: TodaySnapshot): PetSummary {
  const done = snapshot.planTasks.filter((task) => task.status === 'done')
  const latest = [...done].sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))[0]
  return {
    date: snapshot.date,
    wake: snapshot.wake !== null,
    sleep: snapshot.sleep !== null,
    planned: snapshot.plan.timeline.length > 0 || snapshot.plan.taskIds.length > 0,
    reviewed: snapshot.plan.review !== null,
    done: done.length,
    lastDone: latest?.title ?? null,
    wakeClock: snapshot.wake ? clockOf(snapshot.wake.at) : null,
  }
}

/** 哪些事刚刚发生。没有上一次、或者换了一天，只算基线，不产生事件 */
export function diffSummary(previous: PetSummary | null, next: PetSummary): PetEventKind[] {
  if (previous === null || previous.date !== next.date) return []
  const events: PetEventKind[] = []
  if (!previous.wake && next.wake) events.push('wake')
  if (!previous.sleep && next.sleep) events.push('sleep')
  if (next.done > previous.done) events.push('taskDone')
  if (!previous.planned && next.planned) events.push('planned')
  if (!previous.reviewed && next.reviewed) events.push('reviewed')
  return events
}
