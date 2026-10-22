import { datesBetween } from '../../src/shared/calendar'
import { emptyPlan, type Task } from '../../src/shared/schema'
import type { HeatCell, TodaySnapshot } from '../../src/shared/views'

/** 从 start 开始的 count 格热力图，today 之后的标为 future */
export function makeCells(start: string, count: number, today: string, scores: Record<string, number> = {}): HeatCell[] {
  const last = datesBetween(start, '2100-01-01').slice(0, count)
  return last.map((date) => {
    const score = scores[date] ?? 0
    const level = score === 0 ? 0 : score < 3 ? 1 : score < 6 ? 2 : score < 9 ? 3 : 4
    return { date, score, level, future: date > today } as HeatCell
  })
}

const uid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export function task(n: number, patch: Partial<Task> = {}): Task {
  return {
    id: uid(n),
    title: `任务${n}`,
    list: '收集箱',
    status: 'open',
    createdAt: '2026-10-20T08:00:00+08:00',
    doneAt: null,
    due: null,
    checkpoints: [],
    notes: '',
    ...patch,
  }
}

export function todayFixture(patch: Partial<TodaySnapshot> = {}): TodaySnapshot {
  return {
    date: '2026-10-23',
    dayStartsAt: '04:00',
    plan: emptyPlan('2026-10-23'),
    planTasks: [],
    openTasks: [],
    lists: ['收集箱'],
    unfinished: [],
    fixedToday: [],
    wake: null,
    sleep: null,
    heatmap: makeCells('2026-08-03', 84, '2026-10-23'),
    welcomeBack: false,
    warnings: [],
    ...patch,
  }
}
