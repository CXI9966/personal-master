import type { UsageSummary, UsageTotals } from '../../shared/ai'
import { datesBetween, isoWeekOf, shiftDate, startOfWeek } from '../../shared/calendar'
import type { UsageEntry } from '../../shared/schema'
import { logicalDateOf } from './day'

const zero = (): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0 })

/** 某一周（周一到周日）的用量：按功能、按天。entries 是整个用量流水账 */
export function summarizeUsageFrom(entries: UsageEntry[], dayStartsAt: string, dateInWeek: string): UsageSummary {
  const weekStart = startOfWeek(dateInWeek)
  const weekEnd = shiftDate(weekStart, 6)
  const days = new Map(datesBetween(weekStart, weekEnd).map((date) => [date, { date, ...zero() }]))
  const summary: UsageSummary = {
    weekKey: isoWeekOf(weekStart).key,
    weekStart,
    weekEnd,
    total: zero(),
    byFeature: {},
    byDay: [],
    callsWithoutTokens: 0,
  }
  for (const entry of entries) {
    const day = days.get(logicalDateOf(entry.at, dayStartsAt))
    if (!day) continue
    const add = (t: UsageTotals): void => {
      t.calls++
      t.inputTokens += entry.inputTokens ?? 0
      t.outputTokens += entry.outputTokens ?? 0
    }
    add(summary.total)
    add(day)
    add((summary.byFeature[entry.feature] ??= zero()))
    if (entry.inputTokens === null && entry.outputTokens === null) summary.callsWithoutTokens++
  }
  summary.byDay = [...days.values()]
  return summary
}
