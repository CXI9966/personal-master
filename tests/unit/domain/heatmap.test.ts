import { describe, expect, it } from 'vitest'
import {
  collectDays,
  dayScore,
  emptyDayData,
  heatLevelOf,
  heatmapCells,
  levelThresholds,
  scoresByDay,
  type Sources,
} from '../../../src/main/domain/heatmap'
import { defaultSettings, type Checkin, type LearningCheck, type PlanFile, type Task } from '../../../src/shared/schema'

const W = defaultSettings().heatmap.weights
let n = 0
const uid = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

const none = (): Sources => ({ checkins: [], tasks: [], weights: [], workouts: [], plans: [], learning: [] })
const checkin = (type: Checkin['type'], at: string): Checkin => ({ id: uid(), type, at, source: 'desktop' })
const doneTask = (doneAt: string): Task => ({
  id: uid(), title: 't', list: '收集箱', status: 'done', createdAt: '2026-10-01T08:00:00+08:00',
  doneAt, due: null, checkpoints: [], notes: '',
})
const learning = (at: string, results: Array<'mastered' | 'partial' | 'missed'>): LearningCheck => ({
  id: uid(), seq: 1, at, taskId: null, topic: '主题', checks: results.map((result) => ({ q: '问题', result })),
})
const planWithReview = (date: string): PlanFile => ({
  version: 1, date, energy: null, timeline: [], taskIds: [],
  review: { done: 'a', learned: 'b', change: 'c', at: `${date}T22:40:00+08:00` },
})

describe('dayScore：默认权重', () => {
  it('打卡各 1 分，完成任务每个 1 分，复盘 2 分，健身每次 1 分', () => {
    const data = { ...emptyDayData(), wake: true, sleep: true, tasksDone: 3, review: true, workouts: 1 }
    expect(dayScore(data, W)).toBe(1 + 1 + 3 + 2 + 1)
  })

  it('记体重一天最多算 1 分（有几条记录都一样）', () => {
    expect(dayScore({ ...emptyDayData(), weight: true }, W)).toBe(1)
  })

  it('学习检验：掌握 3 分、部分掌握 2 分、没掌握 1 分，按每道题算', () => {
    const data = { ...emptyDayData(), learning: { mastered: 2, partial: 1, missed: 1 } }
    expect(dayScore(data, W)).toBe(2 * 3 + 2 + 1)
  })

  it('权重可以改', () => {
    expect(dayScore({ ...emptyDayData(), review: true }, { ...W, review: 5 })).toBe(5)
  })

  it('什么都没有就是 0 分', () => {
    expect(dayScore(emptyDayData(), W)).toBe(0)
  })
})

describe('collectDays：从各种记录汇总每天的数据', () => {
  it('按逻辑日期归日，凌晨的记录算前一天', () => {
    const sources: Sources = {
      ...none(),
      checkins: [checkin('wake', '2026-10-23T07:00:00+08:00'), checkin('sleep', '2026-10-24T00:30:00+08:00')],
      tasks: [doneTask('2026-10-23T10:00:00+08:00'), doneTask('2026-10-24T01:00:00+08:00')],
      weights: [
        { id: uid(), at: '2026-10-23T07:10:00+08:00', kg: 76 },
        { id: uid(), at: '2026-10-23T21:00:00+08:00', kg: 76.2 },
      ],
      workouts: [{ id: uid(), at: '2026-10-23T21:30:00+08:00', summary: '跑步', durationMin: 30 }],
      plans: [planWithReview('2026-10-23')],
      learning: [learning('2026-10-23T22:50:00+08:00', ['mastered', 'partial'])],
    }
    const day = collectDays(sources, '04:00').get('2026-10-23')
    expect(day).toEqual({
      wake: true, sleep: true, tasksDone: 2, weight: true, workouts: 1, review: true,
      learning: { mastered: 1, partial: 1, missed: 0 },
    })
    expect(collectDays(sources, '04:00').get('2026-10-24')).toBeUndefined()
  })

  it('没做完的任务不计，没有复盘的计划不计', () => {
    const open: Task = { ...doneTask('2026-10-23T10:00:00+08:00'), status: 'open', doneAt: null }
    const plan: PlanFile = { ...planWithReview('2026-10-23'), review: null }
    const days = collectDays({ ...none(), tasks: [open], plans: [plan] }, '04:00')
    expect(days.size).toBe(0)
  })

  it('scoresByDay 用权重算出每天的分数', () => {
    const sources: Sources = { ...none(), checkins: [checkin('wake', '2026-10-23T07:00:00+08:00')], plans: [planWithReview('2026-10-23')] }
    expect(scoresByDay(collectDays(sources, '04:00'), W).get('2026-10-23')).toBe(3)
  })
})

describe('热力图分档：跟自己比，四分位', () => {
  const scores = (values: number[]): Map<string, number> =>
    new Map(values.map((v, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, v]))

  it('阈值是正分数的 1/4、1/2、3/4 分位（线性插值）', () => {
    expect(levelThresholds(scores([1, 2, 3, 4, 5, 6, 7, 8]), '2026-10-30')).toEqual([2.75, 4.5, 6.25])
  })

  it('不超过第一四分位为 1 档，不超过中位数为 2 档，不超过第三四分位为 3 档，更高为 4 档', () => {
    const t = levelThresholds(scores([1, 2, 3, 4, 5, 6, 7, 8]), '2026-10-30')
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((s) => heatLevelOf(s, t))).toEqual([1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('0 分永远是 0 档（留空）', () => {
    expect(heatLevelOf(0, [1, 2, 3])).toBe(0)
    expect(levelThresholds(scores([0, 0, 0]), '2026-10-30')).toBeNull()
  })

  it('数据很少时：只有一天就是 1 档，两天里分高的一天直接到最深', () => {
    expect(heatLevelOf(5, levelThresholds(scores([5]), '2026-10-30'))).toBe(1)
    const t = levelThresholds(scores([1, 5]), '2026-10-30')
    expect([1, 5].map((s) => heatLevelOf(s, t))).toEqual([1, 4])
  })

  it('只用最近 365 天的分数来定阈值', () => {
    const data = new Map([['2025-01-01', 100], ['2026-10-01', 2], ['2026-10-02', 4]])
    expect(levelThresholds(data, '2026-10-30')).toEqual([2.5, 3, 3.5])
  })
})

describe('heatmapCells：最近 N 周，每列一周，周一开头', () => {
  it('12 周 = 84 格，第一格是周一，最后一格是本周日，今天之后标为 future', () => {
    const cells = heatmapCells(new Map([['2026-10-22', 3], ['2026-10-21', 1]]), '2026-10-22', 12)
    expect(cells).toHaveLength(84)
    expect(cells[0]?.date).toBe('2026-08-03')
    expect(cells.at(-1)?.date).toBe('2026-10-25')
    expect(cells.find((c) => c.date === '2026-10-22')).toMatchObject({ score: 3, level: 4, future: false })
    expect(cells.find((c) => c.date === '2026-10-23')).toMatchObject({ score: 0, level: 0, future: true })
  })
})
