import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { OffsetDateTime } from '../../../src/shared/schema'
import {
  archiveDir,
  datesBetween,
  isoWeekOf,
  logicalDateOf,
  logicalToday,
  minutesOfDay,
  normalizeAt,
  nowISO,
  shiftDate,
  startOfWeek,
  weekdayOf,
} from '../../../src/main/domain/day'

const originalTz = process.env.TZ
beforeAll(() => {
  process.env.TZ = 'Asia/Shanghai'
})
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

describe('logicalDateOf：按 dayStartsAt 把时间归到某一天', () => {
  it.each([
    ['2026-10-23T00:30:00+08:00', '04:00', '2026-10-22'], // 凌晨归前一天
    ['2026-10-23T03:59:59+08:00', '04:00', '2026-10-22'],
    ['2026-10-23T04:00:00+08:00', '04:00', '2026-10-23'], // 正好 04:00 算当天
    ['2026-10-23T23:59:59+08:00', '04:00', '2026-10-23'],
    ['2026-11-01T00:30:00+08:00', '04:00', '2026-10-31'], // 跨月
    ['2026-03-01T01:00:00+08:00', '04:00', '2026-02-28'], // 平年 2 月
    ['2028-03-01T01:00:00+08:00', '04:00', '2028-02-29'], // 闰年 2 月
    ['2027-01-01T03:59:00+08:00', '04:00', '2026-12-31'], // 跨年
    ['2026-10-23T00:30:00-05:00', '04:00', '2026-10-22'], // 其他偏移：按它自己的墙上时间
    ['2026-10-23T00:30:00+08:00', '00:00', '2026-10-23'], // 00:00 就是自然日
  ])('%s（dayStartsAt %s）→ %s', (at, dayStartsAt, expected) => {
    expect(logicalDateOf(at, dayStartsAt)).toBe(expected)
  })

  it('以 Z 结尾的时间要先规范成本机偏移再归日', () => {
    expect(logicalDateOf('2026-10-22T20:30:00Z', '04:00')).toBe('2026-10-22') // 直接算：按 UTC 墙上时间
    expect(logicalDateOf(normalizeAt('2026-10-22T20:30:00Z'), '04:00')).toBe('2026-10-23') // 本机是 04:30
  })

  it('不是 ISO 时间就报错', () => {
    expect(() => logicalDateOf('昨天', '04:00')).toThrow()
  })

  it('logicalToday 用本机时区', () => {
    expect(logicalToday('04:00', new Date('2026-10-23T03:30:00+08:00'))).toBe('2026-10-22')
    expect(logicalToday('04:00', new Date('2026-10-23T04:30:00+08:00'))).toBe('2026-10-23')
  })

  it('nowISO 带本机偏移，能通过 schema 校验', () => {
    const value = nowISO(new Date('2026-10-22T13:53:36.789Z'))
    expect(value).toBe('2026-10-22T21:53:36+08:00')
    expect(OffsetDateTime.safeParse(value).success).toBe(true)
  })
})

describe('日期运算', () => {
  it('minutesOfDay', () => {
    expect(minutesOfDay('04:00')).toBe(240)
    expect(minutesOfDay('23:59')).toBe(1439)
    expect(() => minutesOfDay('4:00')).toThrow()
  })

  it('shiftDate 跨月、跨年、闰年', () => {
    expect(shiftDate('2026-10-31', 1)).toBe('2026-11-01')
    expect(shiftDate('2026-01-01', -1)).toBe('2025-12-31')
    expect(shiftDate('2028-02-28', 1)).toBe('2028-02-29')
  })

  it('weekdayOf：1 周一 … 7 周日；startOfWeek 返回周一', () => {
    expect(weekdayOf('2026-10-22')).toBe(4)
    expect(weekdayOf('2026-10-25')).toBe(7)
    expect(startOfWeek('2026-10-22')).toBe('2026-10-19')
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19')
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19')
  })

  it('datesBetween 含首尾', () => {
    expect(datesBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
})

describe('ISO 周和归档目录', () => {
  it.each([
    ['2020-12-31', '2020-W53', '2020-12-28'],
    ['2021-01-03', '2020-W53', '2020-12-28'],
    ['2021-01-04', '2021-W01', '2021-01-04'],
    ['2024-12-29', '2024-W52', '2024-12-23'],
    ['2024-12-30', '2025-W01', '2024-12-30'],
    ['2025-01-01', '2025-W01', '2024-12-30'],
    ['2026-10-22', '2026-W43', '2026-10-19'],
    ['2026-12-28', '2026-W53', '2026-12-28'],
    ['2027-01-01', '2026-W53', '2026-12-28'],
    ['2027-01-03', '2026-W53', '2026-12-28'],
    ['2027-01-04', '2027-W01', '2027-01-04'],
  ])('%s 属于 %s，当周周一是 %s', (date, key, monday) => {
    expect(isoWeekOf(date).key).toBe(key)
    expect(startOfWeek(date)).toBe(monday)
  })

  it('归档目录用 ISO 周年，不是日历年', () => {
    expect(archiveDir('2027-01-02')).toBe('归档/2026/2026-W53')
    expect(archiveDir('2026-10-22')).toBe('归档/2026/2026-W43')
  })
})
