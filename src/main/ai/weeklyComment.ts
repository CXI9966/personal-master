import { generateText, type LanguageModel } from 'ai'
import type { ProviderKind } from '../../shared/schema'
import { weekdayName } from '../../shared/calendar'
import type { WeeklyReportView } from '../../shared/views'
import type { AppContext } from '../app/context'
import { DomainError } from '../domain/errors'
import { buildSystemPrompt } from './prompt'
import { describeAiError } from './provider'
import { logUsage } from './usage'

const ASK =
  '请点评上面这一周，100 到 200 字：先肯定做到的，再指出一件值得注意的事，最后给下周一个具体的小建议。' +
  '只依据上面的数据；没有记录的地方不要猜，也不要批评没打卡。不要提出修改数据。'

/** 给管家看的“这一周”：统计说明加每天一行。只放这一周，不放别的周 */
export function weeklyReportContext(view: WeeklyReportView): string {
  const days = view.rows.map(
    (row) =>
      `- ${row.date.slice(5)} ${weekdayName(row.date)}：起床 ${row.wake ?? '无记录'}，睡前 ${row.sleep ?? '无记录'}，完成任务 ${row.tasksDone} 个，得分 ${row.score}`,
  )
  return [`## 要点评的这一周：${view.weekKey}（${view.weekStart} ~ ${view.weekEnd}）`, ...view.lines.map((line) => `- ${line}`), '', '## 每天', ...days].join('\n')
}

export interface CommentInput {
  ctx: AppContext
  model: LanguageModel
  provider: { kind: ProviderKind; model: string }
  persona: string
  view: WeeklyReportView
  signal?: AbortSignal
}

/** 让管家点评一周。只出一段文字，不带工具，所以不会改任何数据；调用量记在“周报点评”名下 */
export async function commentOnWeek(input: CommentInput): Promise<string> {
  const system = buildSystemPrompt({ persona: input.persona, context: weeklyReportContext(input.view), mode: 'tools', actions: [] })
  let result: Awaited<ReturnType<typeof generateText>>
  try {
    result = await generateText({ model: input.model, instructions: system, prompt: ASK, maxOutputTokens: 1024, maxRetries: 1, abortSignal: input.signal })
  } catch (error) {
    throw new DomainError('invalid', describeAiError(error))
  }
  try {
    await logUsage(input.ctx, { provider: input.provider.kind, model: input.provider.model, feature: 'weekly', usage: result.totalUsage })
  } catch {
    // 记用量失败不该影响点评
  }
  const text = result.text.trim()
  if (!text) throw new DomainError('invalid', '管家这次没有回复内容，请再试一次')
  return text
}
