import { formatISO, parseISO } from 'date-fns'
import { minutesOfDay, shiftDate } from '../../shared/calendar'

// 纯日历运算在 shared/calendar.ts，这里重新导出，主进程里统一从 domain/day 引用
export * from '../../shared/calendar'

const ISO_LOCAL_PART = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/

/**
 * 逻辑日期：取记录自己的墙上时间（偏移之前的部分），早于 dayStartsAt 的归前一天。
 * 存储用的时间一律带本机偏移（nowISO），所以不依赖运行时的时区。
 */
export function logicalDateOf(at: string, dayStartsAt: string): string {
  const m = ISO_LOCAL_PART.exec(at)
  if (!m) throw new Error(`不是 ISO 时间：${at}`)
  const date = `${m[1]}-${m[2]}-${m[3]}`
  const minutes = Number(m[4]) * 60 + Number(m[5])
  return minutes < minutesOfDay(dayStartsAt) ? shiftDate(date, -1) : date
}

/** 记录自己的墙上时间是当天第几分钟（不看偏移） */
export function wallMinutesOf(at: string): number {
  const m = ISO_LOCAL_PART.exec(at)
  if (!m) throw new Error(`不是 ISO 时间：${at}`)
  return Number(m[4]) * 60 + Number(m[5])
}

/** 当前时刻 → 带本机偏移、精确到秒的 ISO 字符串（存储用，不要用 toISOString） */
export function nowISO(now: Date = new Date()): string {
  return formatISO(now)
}

/** 以 Z 结尾的时间换成本机偏移，再拿去归日 */
export function normalizeAt(at: string): string {
  return formatISO(parseISO(at))
}

/** 今天的逻辑日期 */
export function logicalToday(dayStartsAt: string, now: Date = new Date()): string {
  return logicalDateOf(nowISO(now), dayStartsAt)
}
