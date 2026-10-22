import { describe, expect, it } from 'vitest'
import { renderWeeklyReport } from '../../../src/main/render/weekly'
import { GENERATED_MARKER } from '../../../src/shared/labels'
import { usageLine } from '../../../src/shared/usageText'
import type { UsageSummary } from '../../../src/shared/ai'
import type { WeeklyReportView } from '../../../src/shared/views'

const emptyUsage = (): UsageSummary => ({
  weekKey: '2026-W42',
  weekStart: '2026-10-12',
  weekEnd: '2026-10-18',
  total: { calls: 0, inputTokens: 0, outputTokens: 0 },
  byFeature: {},
  byDay: [],
  callsWithoutTokens: 0,
})

const view = (overrides: Partial<WeeklyReportView> = {}): WeeklyReportView => ({
  weekKey: '2026-W42',
  weekStart: '2026-10-12',
  weekEnd: '2026-10-18',
  lines: ['起床打卡 2/7 天，平均 07:15', '完成任务 3 个'],
  rows: [
    { date: '2026-10-12', wake: '07:00', sleep: null, tasksDone: 2, score: 3 },
    { date: '2026-10-13', wake: null, sleep: null, tasksDone: 0, score: 0 },
  ],
  usage: emptyUsage(),
  comment: null,
  ...overrides,
})

describe('usageLine', () => {
  it('没调用就直说', () => {
    expect(usageLine(view().usage)).toBe('这一周没有调用管家')
  })

  it('有调用：次数、token 数和按功能的次数', () => {
    const usage = emptyUsage()
    usage.total = { calls: 3, inputTokens: 300, outputTokens: 40 }
    usage.byFeature = { chat: { calls: 2, inputTokens: 200, outputTokens: 30 }, weekly: { calls: 1, inputTokens: 100, outputTokens: 10 } }
    expect(usageLine(usage)).toBe('调用 3 次，输入 300 token，输出 40 token（聊天 2 次、周报点评 1 次）')
  })
})

describe('renderWeeklyReport', () => {
  it('第一行是固定说明，有标题、做到的事、每天的表格、用量', () => {
    const text = renderWeeklyReport(view())
    expect(text.split('\n')[0]).toBe(GENERATED_MARKER)
    expect(text).toContain('# 周报 · 2026-W42（2026-10-12 ~ 2026-10-18）')
    expect(text).toContain('- 起床打卡 2/7 天，平均 07:15')
    expect(text).toContain('| 10-12 周一 | 07:00 |')
    expect(text).toContain('- 这一周没有调用管家')
  })

  it('没点评过：提示怎么点评；点评过：写出点评的文字', () => {
    expect(renderWeeklyReport(view())).toContain('还没有点评')
    const withComment = renderWeeklyReport(view({ comment: { text: '这周起得很稳，继续。', at: '2026-10-20T09:00:00+08:00' } }))
    expect(withComment).toContain('这周起得很稳，继续。')
    expect(withComment).not.toContain('还没有点评')
  })

  it('不出现“缺勤”“断网”这类词', () => {
    expect(renderWeeklyReport(view())).not.toMatch(/缺勤|断网/)
  })
})
