import { z } from 'zod'
import type { ActionDef } from './actions'
import type { ProposedCall } from './engine'

const FENCE = '```'

/**
 * “JSON 文本模式”给系统提示词补的一节：模型不支持工具调用时，让它在回复末尾输出一个 json 代码块。
 * 每个动作的参数说明直接用 zod 转出来的 JSON Schema，和工具调用模式用的是同一份定义。
 */
export function jsonModeSection(defs: ActionDef[]): string {
  const lines = defs.map((def) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(def.schema) as Record<string, unknown>
    return `- ${def.name}：${def.description}\n  参数：${JSON.stringify(schema)}`
  })
  return [
    '你不能直接调用工具。需要改数据时，在回复的最后输出一个 json 代码块，格式如下；不需要改数据就不要输出代码块：',
    `${FENCE}json`,
    '{"actions":[{"name":"动作名","args":{"参数名":"参数值"}}]}',
    FENCE,
    '代码块之前正常写给用户看的话，代码块里只放动作。可用的动作和它们的参数（JSON Schema）：',
    ...lines,
  ].join('\n')
}

export interface ExtractedActions {
  /** 去掉代码块后给用户看的文字 */
  text: string
  calls: ProposedCall[]
  /** 代码块有，但不是合法的动作 JSON */
  error?: string
}

/** 从模型的回复里取最后一个 json 代码块里的动作 */
export function extractJsonActions(reply: string): ExtractedActions {
  const matches = [...reply.matchAll(/```json\s*([\s\S]*?)```/g)]
  const last = matches.at(-1)
  if (!last || last.index === undefined) return { text: reply.trim(), calls: [] }
  const text = (reply.slice(0, last.index) + reply.slice(last.index + last[0].length)).trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(last[1] ?? '')
  } catch (error) {
    return { text, calls: [], error: `json 代码块不是合法的 JSON：${(error as Error).message}` }
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { actions?: unknown } | null)?.actions
  if (!Array.isArray(list)) return { text, calls: [], error: 'json 代码块里要有 actions 数组，例如 {"actions":[{"name":"…","args":{…}}]}' }

  const calls: ProposedCall[] = []
  for (const [index, item] of list.entries()) {
    const { name, args } = (item ?? {}) as { name?: unknown; args?: unknown }
    if (typeof name !== 'string' || name === '') {
      return { text, calls: [], error: `第 ${index + 1} 个动作缺少 name` }
    }
    calls.push({ id: `json_${index + 1}`, name, input: args ?? {} })
  }
  return { text, calls }
}
