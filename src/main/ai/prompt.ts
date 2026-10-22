import type { ActionDef } from './actions'
import { jsonModeSection } from './jsonMode'

/** 不能让用户改的规则，放在最前面 */
export const FIXED_RULES = [
  '你是用户的个人管家，运行在用户自己电脑上的 Butler 软件里，帮他管理计划、任务、打卡和学习。',
  '',
  '规则：',
  '1. 一律用中文回复，简短直接，先说结论。',
  '2. 想改数据只能用提供的工具（动作）。没有真的调用工具，就不要说“已经改好了”。',
  '3. 重大改动（重排整天、删除任务、批量改期、改目标作息）会先让用户确认：你只管提出，用户确认之前不要说已经生效。',
  '4. 日期用 YYYY-MM-DD，时间用 HH:mm，按用户本地时区。',
  '5. 引用任务时用上下文里任务前面的 8 位编号；回复正文里不要念出编号和工具名，用人话说。',
  '6. 不要编造用户没做过的记录。不知道的就说不知道，或者先问。',
].join('\n')

export interface PromptInput {
  /** 管家人格.md 的全文 */
  persona: string
  /** 按场景和策略组装好的上下文 */
  context: string
  /** tools：工具调用；json：模型不支持工具时，让它在回复末尾输出 json 代码块 */
  mode: 'tools' | 'json'
  /** json 模式下要写进提示词的动作 */
  actions: ActionDef[]
}

/** 系统提示词：固定规则 → 管家人格 → 当前情况 →（JSON 模式的动作说明） */
export function buildSystemPrompt(input: PromptInput): string {
  const parts = [FIXED_RULES, `# 你的性格和做事方式\n${input.persona.trim()}`, `# 当前情况\n${input.context.trim()}`]
  if (input.mode === 'json') parts.push(`# 动作\n${jsonModeSection(input.actions)}`)
  return parts.join('\n\n')
}
