import { describe, expect, it } from 'vitest'
import { checkinsByDay, pickCheckins } from '../../../src/main/domain/checkin'
import type { Checkin } from '../../../src/shared/schema'

let counter = 0
const ck = (type: Checkin['type'], at: string, source: Checkin['source'] = 'desktop'): Checkin => ({
  id: `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
  type,
  at,
  source,
})

describe('pickCheckins：同一天多次打卡的取舍', () => {
  it('起床取第一次，睡前取最后一次', () => {
    const events = [
      ck('wake', '2026-10-23T07:30:00+08:00'),
      ck('wake', '2026-10-23T07:02:00+08:00', 'phone'),
      ck('wake', '2026-10-23T09:00:00+08:00'),
      ck('sleep', '2026-10-23T23:10:00+08:00'),
      ck('sleep', '2026-10-23T23:50:00+08:00'),
    ]
    const picked = pickCheckins(events, '2026-10-23', '04:00')
    expect(picked.wake?.at).toBe('2026-10-23T07:02:00+08:00')
    expect(picked.sleep?.at).toBe('2026-10-23T23:50:00+08:00')
  })

  it('凌晨 00:30 的睡前打卡算前一天', () => {
    const events = [ck('sleep', '2026-10-24T00:30:00+08:00')]
    expect(pickCheckins(events, '2026-10-23', '04:00').sleep?.at).toBe('2026-10-24T00:30:00+08:00')
    expect(pickCheckins(events, '2026-10-24', '04:00').sleep).toBeNull()
  })

  it('其他天的记录不会混进来；没有就是 null', () => {
    const events = [ck('wake', '2026-10-22T07:00:00+08:00')]
    expect(pickCheckins(events, '2026-10-23', '04:00')).toEqual({ wake: null, sleep: null })
  })

  it('按真实时间比较，不是按字符串（不同偏移也对）', () => {
    const events = [
      ck('wake', '2026-10-23T08:00:00+08:00'), // 00:00Z
      ck('wake', '2026-10-23T07:30:00+08:00'), // 前一天 23:30Z，更早
    ]
    expect(pickCheckins(events, '2026-10-23', '04:00').wake?.at).toBe('2026-10-23T07:30:00+08:00')
  })
})

describe('checkinsByDay', () => {
  it('按逻辑日期分组', () => {
    const events = [
      ck('wake', '2026-10-22T07:00:00+08:00'),
      ck('sleep', '2026-10-23T00:20:00+08:00'),
      ck('wake', '2026-10-23T07:10:00+08:00'),
    ]
    const days = checkinsByDay(events, '04:00')
    expect([...days.keys()].sort()).toEqual(['2026-10-22', '2026-10-23'])
    expect(days.get('2026-10-22')?.sleep?.at).toBe('2026-10-23T00:20:00+08:00')
    expect(days.get('2026-10-23')?.wake?.at).toBe('2026-10-23T07:10:00+08:00')
  })
})
