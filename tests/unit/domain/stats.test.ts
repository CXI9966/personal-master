import { describe, expect, it } from 'vitest'
import type { Sources } from '../../../src/main/domain/heatmap'
import { describeWeek, formatMinutes, weeklyStats } from '../../../src/main/domain/stats'
import { defaultSettings, type Checkin } from '../../../src/shared/schema'

const CONFIG = { dayStartsAt: '04:00', weights: defaultSettings().heatmap.weights }
let n = 0
const uid = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const checkin = (type: Checkin['type'], at: string): Checkin => ({ id: uid(), type, at, source: 'desktop' })
const none = (): Sources => ({ checkins: [], tasks: [], weights: [], workouts: [], plans: [], learning: [] })

describe('formatMinutes', () => {
  it('补零，超过 24 小时回绕', () => {
    expect(formatMinutes(432)).toBe('07:12')
    expect(formatMinutes(24 * 60 + 30)).toBe('00:30')
  })
})

describe('weeklyStats', () => {
  it('统计一周的打卡天数和平均时间（睡前过了午夜也能平均）', () => {
    const sources: Sources = {
      ...none(),
      checkins: [
        checkin('wake', '2026-10-19T07:00:00+08:00'),
        checkin('wake', '2026-10-20T07:30:00+08:00'),
        checkin('sleep', '2026-10-19T23:30:00+08:00'),
        checkin('sleep', '2026-10-21T00:30:00+08:00'), // 算周二
        checkin('wake', '2026-10-26T07:00:00+08:00'), // 下一周，不算
      ],
    }
    const stats = weeklyStats('2026-10-22', sources, CONFIG) // 传周中的某天也行
    expect(stats).toMatchObject({ weekStart: '2026-10-19', weekEnd: '2026-10-25', weekKey: '2026-W43' })
    expect(stats).toMatchObject({ wakeDays: 2, sleepDays: 2, avgWake: '07:15', avgSleep: '00:00' })
    expect(stats.activeDays).toBe(2)
    expect(stats.score).toBe(4)
  })

  it('体重取本周第一条和最后一条', () => {
    const sources: Sources = {
      ...none(),
      weights: [
        { id: uid(), at: '2026-10-21T07:00:00+08:00', kg: 76.4 },
        { id: uid(), at: '2026-10-19T07:00:00+08:00', kg: 77 },
        { id: uid(), at: '2026-10-25T07:00:00+08:00', kg: 76.1 },
      ],
    }
    expect(weeklyStats('2026-10-19', sources, CONFIG)).toMatchObject({ weightFirst: 77, weightLast: 76.1, weightDelta: -0.9 })
  })

  it('只有一条体重就没有变化量', () => {
    const sources: Sources = { ...none(), weights: [{ id: uid(), at: '2026-10-21T07:00:00+08:00', kg: 76.4 }] }
    expect(weeklyStats('2026-10-19', sources, CONFIG)).toMatchObject({ weightLast: 76.4, weightDelta: null })
  })
})

describe('describeWeek：只说做到的，口径正向', () => {
  it('有记录时逐项说明', () => {
    const sources: Sources = {
      ...none(),
      checkins: [checkin('wake', '2026-10-19T07:00:00+08:00'), checkin('wake', '2026-10-20T07:30:00+08:00')],
      workouts: [{ id: uid(), at: '2026-10-21T21:00:00+08:00', summary: '跑步', durationMin: 30 }],
    }
    const lines = describeWeek(weeklyStats('2026-10-19', sources, CONFIG))
    expect(lines).toContain('起床打卡 2/7 天，平均 07:15')
    expect(lines).toContain('健身 1 次')
  })

  it('什么都没记录时给一句鼓励，不出现“缺勤”“断网”', () => {
    const lines = describeWeek(weeklyStats('2026-10-19', none(), CONFIG))
    expect(lines).toEqual(['这一周还没有记录，从今天开始就好'])
  })

  it.each([none(), { ...none(), checkins: [checkin('wake', '2026-10-19T07:00:00+08:00')] }])('任何情况下都不含负面词', (sources) => {
    const text = describeWeek(weeklyStats('2026-10-19', sources, CONFIG)).join('\n')
    expect(text).not.toMatch(/缺勤|断网|没做|失败/)
  })
})
