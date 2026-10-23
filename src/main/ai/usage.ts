import type { UsageFeatureName, UsageSummary, UsageTotals } from '../../shared/ai'
import { PATHS } from '../../shared/paths'
import { UsageEntry } from '../../shared/schema'
import type { AppContext } from '../app/context'
import { nowISO } from '../domain/day'
import { loadSettings } from '../domain/load'
import { summarizeUsageFrom } from '../domain/usage'

const finite = (n: number | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null)

/** 每次调用模型后记一笔 token 数。用量是流水账，不进改动历史（不会顶掉“最近一次改动”） */
export function logUsage(
  ctx: AppContext,
  entry: { provider: string; model: string; feature: UsageFeatureName; usage?: { inputTokens?: number; outputTokens?: number } },
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
export { summarizeUsageFrom }

/** 读用量流水账，汇总某一周 */
export async function summarizeUsage(ctx: AppContext, dateInWeek: string): Promise<UsageSummary> {
  const { dayStartsAt } = await loadSettings(ctx.ws)
  const { items } = await ctx.ws.readLines(PATHS.usage, UsageEntry)
  return summarizeUsageFrom(items, dayStartsAt, dateInWeek)
}
