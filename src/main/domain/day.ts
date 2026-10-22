import { formatISO, parseISO } from 'date-fns'

const ISO_LOCAL_PART = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/

/** "HH:mm" → 当天第几分钟 */
export function minutesOfDay(hhmm: string): number {
  const m = HH_MM.exec(hhmm)
  if (!m) throw new Error(`时间应为 HH:mm：${hhmm}`)
  return Number(m[1]) * 60 + Number(m[2])
}

function parseYmd(ymd: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) throw new Error(`日期应为 YYYY-MM-DD：${ymd}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** "YYYY-MM-DD" 加减天数。用 UTC 做纯日历运算，不受时区和夏令时影响 */
export function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = parseYmd(ymd)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** b 比 a 晚几天 */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parseYmd(a)
  const [by, bm, bd] = parseYmd(b)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** 从 a 到 b 的每一天，含首尾；b 早于 a 返回空数组 */
export function datesBetween(a: string, b: string): string[] {
  const count = daysBetween(a, b) + 1
  return Array.from({ length: Math.max(count, 0) }, (_, i) => shiftDate(a, i))
}

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

/** 当前时刻 → 带本机偏移、精确到秒的 ISO 字符串（存储用，不要用 toISOString） */
export function nowISO(now: Date = new Date()): string {
  return formatISO(now)
}

/** 以 Z 结尾的时间换成本机偏移，再拿去归日 */
export function normalizeAt(at: string): string {
  return formatISO(parseISO(at))
}

/** 记录自己的墙上时间是当天第几分钟（不看偏移） */
export function wallMinutesOf(at: string): number {
  const m = ISO_LOCAL_PART.exec(at)
  if (!m) throw new Error(`不是 ISO 时间：${at}`)
  return Number(m[4]) * 60 + Number(m[5])
}

/** 今天的逻辑日期 */
export function logicalToday(dayStartsAt: string, now: Date = new Date()): string {
  return logicalDateOf(nowISO(now), dayStartsAt)
}

/** 1 周一 … 7 周日 */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = parseYmd(ymd)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dow === 0 ? 7 : dow
}

/** 当周周一 */
export function startOfWeek(ymd: string): string {
  return shiftDate(ymd, 1 - weekdayOf(ymd))
}

/** ISO 周：year 是 ISO 周年（2027-01-02 属于 2026 年的第 53 周），key 形如 2026-W43 */
export function isoWeekOf(ymd: string): { year: number; week: number; key: string } {
  const thursday = shiftDate(ymd, 4 - weekdayOf(ymd)) // 周四所在的年份就是 ISO 周年
  const year = Number(thursday.slice(0, 4))
  const week = Math.floor(daysBetween(`${year}-01-01`, thursday) / 7) + 1
  return { year, week, key: `${year}-W${String(week).padStart(2, '0')}` }
}

/** 归档目录：归档/<ISO周年>/<周年-Www> */
export function archiveDir(ymd: string): string {
  const { year, key } = isoWeekOf(ymd)
  return `归档/${year}/${key}`
}
