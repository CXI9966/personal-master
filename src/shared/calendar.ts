// 纯日历运算：只用 "YYYY-MM-DD" 字符串和 UTC，不受本机时区和夏令时影响。主进程和界面都能用。

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

/** "YYYY-MM-DD" 加减天数 */
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

/** 1 周一 … 7 周日 */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = parseYmd(ymd)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return dow === 0 ? 7 : dow
}

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

/** 周一 … 周日 */
export function weekdayName(ymd: string): string {
  return WEEKDAY_NAMES[weekdayOf(ymd) - 1] ?? ''
}

/** 1 → 周一 … 7 → 周日 */
export function weekdayLabel(weekday: number): string {
  return WEEKDAY_NAMES[weekday - 1] ?? ''
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

/** 记录自己的墙上时间的 HH:mm（不看偏移），例如 2026-10-23T07:02:11+08:00 → 07:02 */
export function clockOf(at: string): string {
  const m = /T(\d{2}):(\d{2})/.exec(at)
  return m ? `${m[1]}:${m[2]}` : at
}
