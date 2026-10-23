import { generateText, type LanguageModel } from 'ai'
import type { ProviderKind } from '../../shared/schema'
import type { AppContext } from '../app/context'
import { buildSystemPrompt } from './prompt'
import { logUsage } from './usage'

const ASK =
  '用一句话对用户说，口吻符合你的性格，不超过 24 个字。直接说话，不要加引号，不要提出修改数据。' +
  '只依据上面的事实，不要编造用户没做过的事。'

export interface PetLineInput {
  ctx: AppContext
  model: LanguageModel
  provider: { kind: ProviderKind; model: string }
  persona: string
  /** 刚发生了什么（几句事实） */
  facts: string
  signal?: AbortSignal
}

/** 桌宠台词：让管家用自己的人格说一句话。不带工具，不改任何数据；调用量记在“桌宠台词”名下 */
export async function writePetLine(input: PetLineInput): Promise<string> {
  const system = buildSystemPrompt({ persona: input.persona, context: input.facts, mode: 'tools', actions: [] })
  const result = await generateText({
    model: input.model,
    instructions: system,
    prompt: ASK,
    maxOutputTokens: 80,
    maxRetries: 0,
    abortSignal: input.signal,
  })
  try {
    await logUsage(input.ctx, { provider: input.provider.kind, model: input.provider.model, feature: 'pet', usage: result.totalUsage })
  } catch {
    // 记用量失败不该影响台词
  }
  const text = result.text
    .replace(/\s+/g, ' ')
    .replace(/^[“"「『']+|[”"」』']+$/g, '')
    .trim()
  if (!text) throw new Error('模型没有返回内容')
  return text
}
