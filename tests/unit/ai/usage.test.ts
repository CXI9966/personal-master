import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { logUsage, summarizeUsage } from '../../../src/main/ai/usage'
import { addCheckin } from '../../../src/main/app/services'
import { PATHS } from '../../../src/shared/paths'
import { UsageEntry } from '../../../src/shared/schema'
import { newTestId, openTestSession, useShanghaiTimezone } from '../app/helpers'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

let test: Awaited<ReturnType<typeof openTestSession>>
beforeEach(async () => {
  test = await openTestSession()
})
afterEach(async () => {
  await test.cleanup()
})
const ctx = () => test.session.ctx()

describe('logUsage', () => {
  it('记下 token 数；接口没返回就记 null', async () => {
    await logUsage(ctx(), { provider: 'openai-compatible', model: 'm', feature: 'chat', usage: { inputTokens: 120, outputTokens: 30 } })
    await logUsage(ctx(), { provider: 'anthropic', model: 'c', feature: 'plan' })
    await logUsage(ctx(), { provider: 'openai-compatible', model: 'm', feature: 'review', usage: { inputTokens: Number.NaN } })
    const { items } = await ctx().ws.readLines(PATHS.usage, UsageEntry)
    expect(items).toMatchObject([
      { feature: 'chat', inputTokens: 120, outputTokens: 30, at: '2026-10-23T12:00:00+08:00' },
      { feature: 'plan', inputTokens: null, outputTokens: null },
      { feature: 'review', inputTokens: null, outputTokens: null },
    ])
  })

  it('不进改动历史：不会顶掉“最近一次改动”', async () => {
    await addCheckin(ctx(), 'wake')
    const before = ctx().ws.lastChange()
    await logUsage(ctx(), { provider: 'p', model: 'm', feature: 'chat', usage: { inputTokens: 1, outputTokens: 1 } })
    expect(ctx().ws.lastChange()).toEqual(before)
  })
})

describe('summarizeUsage：一周的用量', () => {
  it('按功能、按天汇总；本周之外的不算；没调用的天是 0', async () => {
    const put = (at: string, feature: 'chat' | 'plan', input: number | null, output: number | null) =>
      ctx().ws.appendLog(PATHS.usage, { id: newTestId(), at, provider: 'p', model: 'm', feature, inputTokens: input, outputTokens: output }, UsageEntry)
    await put('2026-10-19T09:00:00+08:00', 'plan', 100, 20) // 周一
    await put('2026-10-19T21:00:00+08:00', 'chat', 50, 10) // 周一
    await put('2026-10-21T10:00:00+08:00', 'chat', null, null) // 周三，没返回 token 数
    await put('2026-10-22T02:00:00+08:00', 'chat', 30, 5) // 凌晨算周三（前一天）
    await put('2026-10-26T09:00:00+08:00', 'chat', 999, 999) // 下一周
    await put('2026-10-18T23:00:00+08:00', 'chat', 999, 999) // 上一周

    const summary = await summarizeUsage(ctx(), '2026-10-23')
    expect(summary).toMatchObject({ weekKey: '2026-W43', weekStart: '2026-10-19', weekEnd: '2026-10-25' })
    expect(summary.total).toEqual({ calls: 4, inputTokens: 180, outputTokens: 35 })
    expect(summary.byFeature).toEqual({
      plan: { calls: 1, inputTokens: 100, outputTokens: 20 },
      chat: { calls: 3, inputTokens: 80, outputTokens: 15 },
    })
    expect(summary.byDay).toHaveLength(7)
    expect(summary.byDay[0]).toEqual({ date: '2026-10-19', calls: 2, inputTokens: 150, outputTokens: 30 })
    expect(summary.byDay[2]).toEqual({ date: '2026-10-21', calls: 2, inputTokens: 30, outputTokens: 5 })
    expect(summary.byDay[4]).toEqual({ date: '2026-10-23', calls: 0, inputTokens: 0, outputTokens: 0 })
    expect(summary.callsWithoutTokens).toBe(1)
  })

  it('一次调用都没有：全是 0', async () => {
    const summary = await summarizeUsage(ctx(), '2026-10-23')
    expect(summary.total).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0 })
    expect(summary.byDay.every((d) => d.calls === 0)).toBe(true)
  })
})
