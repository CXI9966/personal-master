import type { AiScene, UsageSummary, UsageTotals } from '../../shared/ai'
import { datesBetween, isoWeekOf, shiftDate, startOfWeek } from '../../shared/calendar'
import { PATHS } from '../../shared/paths'
import { UsageEntry } from '../../shared/schema'
import type { AppContext } from '../app/context'
import { logicalDateOf, nowISO } from '../domain/day'
import { loadSettings } from '../domain/load'

const finite = (n: number | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null)

/** 每次调用模型后记一笔 token 数。用量是流水账，不进改动历史（不会顶掉“最近一次改动”） */
export function logUsage(
  ctx: AppContext,
  entry: { provider: string; model: string; feature: AiScene; usage?: { inputTokens?: number; outputTokens?: number } },
): Promise<void> {
  return ctx.ws.appendLog(
    PATHS.usage,
    {
      id: ctx.newId(),
      at: nowISO(ctx.now()),
      provider: entry.provider,
      model: entry.model,
      feature: entry.feature,
      inputTokens: finite(entry.usage?.inputTokens),
      outputTokens: finite(entry.usage?.outputTokens),
    },
    UsageEntry,
  )
}

export type { UsageSummary, UsageTotals }

const zero =(): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0 })

/** 某一周（周一到周日）的用量：按功能、按天 */
export async function summarizeUsage(ctx: AppContext, dateInWeek: string): Promise<UsageSummary> {
  const { dayStartsAt } = await loadSettings(ctx.ws)
  const weekStart = startOfWeek(dateInWeek)
  const weekEnd = shiftDate(weekStart, 6)
  const { items } = await ctx.ws.readLines(PATHS.usage, UsageEntry)
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
  for (const entry of items) {
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
