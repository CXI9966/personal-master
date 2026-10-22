import { describe, expect, it } from 'vitest'
import { weeklyStats, weekRows } from '../../../src/main/domain/stats'
import { sanitizeFileName } from '../../../src/main/render/common'
import { planHasContent, renderDayArchive } from '../../../src/main/render/archive'
import { renderProfile } from '../../../src/main/render/profile'
import { renderCheckins, renderLearning, renderWeight, renderWorkouts } from '../../../src/main/render/records'
import { renderTaskList } from '../../../src/main/render/tasks'
import { renderToday } from '../../../src/main/render/today'
import { renderWeek } from '../../../src/main/render/week'
import { GENERATED_MARKER } from '../../../src/shared/labels'
import {
  defaultSettings,
  emptyPlan,
  emptyProfile,
  type Checkin,
  type LearningCheck,
  type PlanFile,
  type ProfileFile,
  type Task,
} from '../../../src/shared/schema'

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const task = (n: number, patch: Partial<Task> = {}): Task => ({
  id: id(n), title: `任务${n}`, list: '收集箱', status: 'open', createdAt: '2026-10-20T08:00:00+08:00',
  doneAt: null, due: null, checkpoints: [], notes: '', ...patch,
})
const checkin = (n: number, type: Checkin['type'], at: string, source: Checkin['source'] = 'desktop'): Checkin => ({ id: id(n), type, at, source })

const PLAN: PlanFile = {
  ...emptyPlan('2026-10-23'),
  energy: 'mid',
  timeline: [{ start: '09:00', end: '10:30', title: '电机选型', taskId: null }, { start: '14:00', end: '15:00', title: '看书', taskId: null }],
  taskIds: [id(1), id(2)],
  review: { done: '选完了电机', learned: '堵转电流', change: '早点开始', at: '2026-10-23T22:40:00+08:00' },
}
const PROFILE: ProfileFile = {
  ...emptyProfile(),
  goals: { weightTargetKg: 70, notes: '先把作息稳定下来' },
  schedule: {
    wakeTarget: '07:00', sleepTarget: '23:40', gymDays: [1, 3, 5],
    fixed: [{ weekday: 3, start: '08:00', end: '09:40', title: '电力电子' }, { weekday: 1, start: '10:00', end: '11:40', title: '信号与系统' }],
  },
}
const SOURCES = {
  checkins: [checkin(1, 'wake', '2026-10-23T07:02:00+08:00', 'phone'), checkin(2, 'sleep', '2026-10-23T23:41:00+08:00')],
  tasks: [task(1, { due: '2026-10-30' }), task(2, { status: 'done', doneAt: '2026-10-23T16:00:00+08:00' })],
  weights: [{ id: id(3), at: '2026-10-19T07:00:00+08:00', kg: 77 }, { id: id(4), at: '2026-10-23T07:10:00+08:00', kg: 76.4 }],
  workouts: [{ id: id(5), at: '2026-10-21T21:30:00+08:00', summary: '有氧 30 分钟 + 推', durationMin: 65 }],
  plans: [PLAN],
  learning: [{ id: id(6), seq: 1, at: '2026-10-23T22:50:00+08:00', taskId: null, topic: 'Buck 电路', checks: [{ q: '电感饱和会怎样？', result: 'mastered' }, { q: '占空比公式', result: 'partial' }] }] as LearningCheck[],
}
const CONFIG = { dayStartsAt: '04:00', weights: defaultSettings().heatmap.weights }

describe('每个生成的视图第一行都是固定说明', () => {
  const views: Array<[string, string]> = [
    ['今日', renderToday({ date: '2026-10-23', plan: emptyPlan('2026-10-23'), tasks: [], wake: null, sleep: null })],
    ['本周', renderWeek({ stats: weeklyStats('2026-10-23', { ...SOURCES, checkins: [], tasks: [], weights: [], workouts: [], plans: [], learning: [] }, CONFIG), rows: [], fixed: [] })],
    ['设定', renderProfile(emptyProfile())],
    ['任务库', renderTaskList('收集箱', [])],
    ['打卡', renderCheckins([], '04:00')],
    ['体重', renderWeight([], null, '04:00')],
    ['健身', renderWorkouts([], '04:00')],
    ['学习', renderLearning([], '04:00')],
    ['归档', renderDayArchive(emptyPlan('2026-10-23'), [])],
  ]
  it.each(views)('%s', (_name, text) => {
    expect(text.split('\n')[0]).toBe(GENERATED_MARKER)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toMatch(/缺勤|断网/)
  })
})

describe('有数据时的样子（快照）', () => {
  it('今日', () => {
    expect(renderToday({ date: '2026-10-23', plan: PLAN, tasks: SOURCES.tasks, wake: SOURCES.checkins[0] ?? null, sleep: SOURCES.checkins[1] ?? null })).toMatchSnapshot()
  })
  it('本周', () => {
    expect(renderWeek({ stats: weeklyStats('2026-10-23', SOURCES, CONFIG), rows: weekRows('2026-10-23', SOURCES, CONFIG), fixed: PROFILE.schedule.fixed })).toMatchSnapshot()
  })
  it('我的设定', () => expect(renderProfile(PROFILE)).toMatchSnapshot())
  it('任务库', () => expect(renderTaskList('收集箱', [...SOURCES.tasks, task(3, { status: 'dropped' }), task(4, { checkpoints: ['为什么堵转电流大'], notes: '第一章' })])).toMatchSnapshot())
  it('记录：打卡、体重、健身、学习', () => {
    expect(renderCheckins(SOURCES.checkins, '04:00')).toMatchSnapshot()
    expect(renderWeight(SOURCES.weights, 70, '04:00')).toMatchSnapshot()
    expect(renderWorkouts(SOURCES.workouts, '04:00')).toMatchSnapshot()
    expect(renderLearning(SOURCES.learning, '04:00')).toMatchSnapshot()
  })
  it('归档', () => expect(renderDayArchive(PLAN, SOURCES.tasks)).toMatchSnapshot())
})

describe('空数据也有合理的样子', () => {
  it('今日页没有打卡、计划、复盘时给出温和的占位', () => {
    const text = renderToday({ date: '2026-10-23', plan: emptyPlan('2026-10-23'), tasks: [], wake: null, sleep: null })
    for (const hint of ['今天还没有打卡', '还没选', '还没有安排', '还没有排任务', '还没有复盘']) expect(text).toContain(hint)
  })
  it('设定页的栏目齐全、值是“还没填”', () => {
    const text = renderProfile(emptyProfile())
    expect(text).toContain('目标体重：（还没填）')
    expect(text).toContain('健身日：（还没填）')
  })
})

describe('其他', () => {
  it('planHasContent：空计划不存档', () => {
    expect(planHasContent(emptyPlan('2026-10-23'))).toBe(false)
    expect(planHasContent({ ...emptyPlan('2026-10-23'), energy: 'low' })).toBe(true)
  })
  it('sanitizeFileName 去掉 Windows 不允许的字符和保留名', () => {
    expect(sanitizeFileName('学习/RM')).toBe('学习_RM')
    expect(sanitizeFileName('a:b*c?')).toBe('a_b_c_')
    expect(sanitizeFileName('  ')).toBe('清单')
    expect(sanitizeFileName('con')).toBe('con_')
    expect(sanitizeFileName('名字...')).toBe('名字')
  })
})
