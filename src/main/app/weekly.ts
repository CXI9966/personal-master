import { PATHS } from '../../shared/paths'
import { UsageEntry, WeeklyComment } from '../../shared/schema'
import type { WeeklyReportView } from '../../shared/views'
import { logicalToday, nowISO } from '../domain/day'
import { loadSettings, loadSources } from '../domain/load'
import { weeklyReportViews } from '../domain/weekly'
import type { AppContext } from './context'
import { mutate } from './services'

/** 读出全部数据，给界面用 */
export async function buildWeeklyReports(ctx: AppContext, options: { weeks?: number } = {}): Promise<WeeklyReportView[]> {
  const settings = await loadSettings(ctx.ws)
  const { sources } = await loadSources(ctx.ws)
  return weeklyReportViews({
    sources,
    dayStartsAt: settings.dayStartsAt,
    weights: settings.heatmap.weights,
    today: logicalToday(settings.dayStartsAt, ctx.now()),
    weeks: options.weeks ?? 8,
    usage: (await ctx.ws.readLines(PATHS.usage, UsageEntry)).items,
    comments: (await ctx.ws.readLines(PATHS.weeklyComments, WeeklyComment)).items,
  })
}

/** 保存管家对某一周的点评（同一周再点评，新的盖过旧的） */
export const saveWeeklyComment = (ctx: AppContext, weekStart: string, text: string): Promise<void> =>
  mutate(ctx, '保存周报点评', (tx) =>
    tx.appendLine(PATHS.weeklyComments, { id: ctx.newId(), weekStart, at: nowISO(ctx.now()), text: text.trim() }, WeeklyComment),
  )
