import { describe, expect, it } from 'vitest'
import type { Sources } from '../../../src/main/domain/heatmap'
import { completedWeekStarts, weeklyReportViews, type WeeklyInput } from '../../../src/main/domain/weekly'
import { defaultSettings, type Checkin, type UsageEntry, type WeeklyComment } from '../../../src/shared/schema'

let n = 0
const uid = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const checkin = (type: Checkin['type'], at: string): Checkin => ({ id: uid(), type, at, source: 'desktop' })
const none = (): Sources => ({ checkins: [], tasks: [], weights: [], workouts: [], plans: [], learning: [] })
const usage = (at: string, input: number, output: number): UsageEntry => ({
  id: uid(),
  at,
  provider: 'p',
  model: 'm',
  feature: 'chat',
  inputTokens: input,
  outputTokens: output,
})
const comment = (weekStart: string, at: string, text: string): WeeklyComment => ({ id: uid(), weekStart, at, text })

// 2026-10-23 是周五，在 2026-W43。上一周 W42 是 10-12 ~ 10-18
const TODAY = '2026-10-23'
const input = (overrides: Partial<WeeklyInput>): WeeklyInput => ({
  sources: none(),
  dayStartsAt: '04:00',
  weights: defaultSettings().heatmap.weights,
  today: TODAY,
  weeks: 8,
  usage: [],
  comments: [],
  ...overrides,
})

describe('completedWeekStarts', () => {
  const scores = new Map([
    ['2026-10-23', 3], // 本周，还没结束，不算
    ['2026-10-14', 2], // W42
    ['2026-10-15', 1], // 同一周只算一次
    ['2026-09-30', 4], // W40
    ['2026-10-06', 0], // 分数是 0 等于没记录
    ['2026-08-05', 1], // 很久以前
  ])

  it('只列已经结束、有记录的周，周一的日期，最新的在前', () => {
    expect(completedWeekStarts(scores, TODAY, 8)).toEqual(['2026-10-12', '2026-09-28'])
  })

  it('周数有上限；上限之外的周不列', () => {
    expect(completedWeekStarts(scores, TODAY, 1)).toEqual(['2026-10-12'])
    expect(completedWeekStarts(scores, TODAY, 12)).toContain('2026-08-03')
  })

  it('周一当天：上一周刚结束，可以出周报', () => {
    expect(completedWeekStarts(new Map([['2026-10-18', 1]]), '2026-10-19', 4)).toEqual(['2026-10-12'])
  })

  it('一条记录都没有就是空', () => {
    expect(completedWeekStarts(new Map(), TODAY, 8)).toEqual([])
  })
})

describe('weeklyReportViews', () => {
  const sources: Sources = {
    ...none(),
    checkins: [
      checkin('wake', '2026-10-12T07:00:00+08:00'),
      checkin('wake', '2026-10-13T07:30:00+08:00'),
      checkin('sleep', '2026-10-13T23:30:00+08:00'),
      checkin('wake', '2026-10-21T07:00:00+08:00'), // 本周，不出周报
    ],
  }

  it('一份周报里有周的范围、做到的事、每天一行', () => {
    const [report, ...rest] = weeklyReportViews(input({ sources }))
    expect(rest).toEqual([])
    expect(report).toMatchObject({ weekKey: '2026-W42', weekStart: '2026-10-12', weekEnd: '2026-10-18' })
    expect(report!.lines).toContain('起床打卡 2/7 天，平均 07:15')
    expect(report!.rows).toHaveLength(7)
    expect(report!.rows[0]).toMatchObject({ date: '2026-10-12', wake: '07:00', sleep: null })
    expect(report!.comment).toBeNull()
  })

  it('用量只算这一周的，按换日时间归日', () => {
    const [report] = weeklyReportViews(
      input({
        sources,
        usage: [
          usage('2026-10-13T10:00:00+08:00', 100, 20), // W42
          usage('2026-10-19T02:00:00+08:00', 30, 5), // 周一凌晨，算上周日，W42
          usage('2026-10-19T09:00:00+08:00', 999, 999), // W43
          usage('2026-10-11T23:00:00+08:00', 999, 999), // W41
        ],
      }),
    )
    expect(report!.usage.total).toEqual({ calls: 2, inputTokens: 130, outputTokens: 25 })
  })

  it('点评：同一周取最新的一条；别的周的点评不会串过来', () => {
    const [report] = weeklyReportViews(
      input({
        sources,
        comments: [
          comment('2026-10-12', '2026-10-20T09:00:00+08:00', '第一次点评'),
          comment('2026-10-12', '2026-10-21T09:00:00+08:00', '第二次点评'),
          comment('2026-10-05', '2026-10-22T09:00:00+08:00', '别的周'),
        ],
      }),
    )
    expect(report!.comment).toEqual({ text: '第二次点评', at: '2026-10-21T09:00:00+08:00' })
  })

  it('没有任何记录：没有周报', () => {
    expect(weeklyReportViews(input({}))).toEqual([])
  })
})

describe('跨年和第 53 周', () => {
  // 2026 年有 53 周：2026-W53 是 12-28 ~ 2027-01-03，元旦那天还算 2026 年的最后一周
  it('新年第一周里，上一周是 W53，周的范围跨年', () => {
    const sources: Sources = { ...none(), checkins: [checkin('wake', '2026-12-30T07:00:00+08:00'), checkin('wake', '2027-01-02T07:00:00+08:00')] }
    const [report, ...rest] = weeklyReportViews(input({ sources, today: '2027-01-05' }))
    expect(rest).toEqual([])
    expect(report).toMatchObject({ weekKey: '2026-W53', weekStart: '2026-12-28', weekEnd: '2027-01-03' })
    expect(report!.lines).toContain('起床打卡 2/7 天，平均 07:00')
  })

  it('再往前一周是 W52，周与周之间不重叠', () => {
    const sources: Sources = { ...none(), checkins: [checkin('wake', '2026-12-22T07:00:00+08:00'), checkin('wake', '2026-12-30T07:00:00+08:00')] }
    const reports = weeklyReportViews(input({ sources, today: '2027-01-05' }))
    expect(reports.map((r) => r.weekKey)).toEqual(['2026-W53', '2026-W52'])
  })
})
