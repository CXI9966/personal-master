import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { APICallError, generateText, type LanguageModel } from 'ai'
import type { ModelConfig } from '../../shared/ai'
import { DomainError } from '../domain/errors'

// SDK 默认会把“这个功能走兼容模式”之类的警告打到控制台，对用户没用
;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false

export interface ModelSettings extends ModelConfig {
  apiKey: string
}

/** 去掉首尾空白和末尾的 /。不替用户补 /v1：不同服务商的路径不一样，让用户照文档填 */
export const normalizeBaseURL = (url: string): string => url.trim().replace(/\/+$/, '')

/** 配置缺哪一项，就明确说缺哪一项 */
export function assertConfigured(settings: ModelSettings): void {
  const missing = [
    !normalizeBaseURL(settings.baseURL) && '接口地址',
    !settings.model.trim() && '模型名',
    !settings.apiKey.trim() && 'API key',
  ].filter(Boolean)
  if (missing.length > 0) throw new DomainError('invalid', `还没有配置好模型接口：缺 ${missing.join('、')}。请先在设置里填好。`)
}

export function createModel(settings: ModelSettings): LanguageModel {
  assertConfigured(settings)
  const baseURL = normalizeBaseURL(settings.baseURL)
  const model = settings.model.trim()
  const apiKey = settings.apiKey.trim()
  if (settings.kind === 'anthropic') return createAnthropic({ baseURL, apiKey })(model)
  return createOpenAICompatible({ name: 'custom', baseURL, apiKey })(model)
}

/** 任何模型调用的错误 → 给用户看的、能指出下一步该检查什么的中文 */
export function describeAiError(error: unknown): string {
  if (error instanceof DomainError) return error.message
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    const detail = error.message
    if (status === undefined) return `连不上模型接口：${detail}。请检查接口地址和网络。`
    if (status === 401) return '接口拒绝了密钥（401）：请检查 API key 是否正确、有没有过期。'
    if (status === 403) return `没有权限（403）：${detail}`
    if (status === 404) return '找不到这个接口或模型（404）：请检查接口地址（通常以 /v1 结尾）和模型名是否正确。'
    if (status === 429) return '请求太频繁，或者账户额度用完了（429）：稍后再试，或者检查服务商那边的余额。'
    if (status === 400 && /tool|function/i.test(detail)) {
      return `接口拒绝了请求（400）：${detail}。这个模型可能不支持工具调用，可以在设置里把“动作模式”改成“JSON 文本”。`
    }
    if (status >= 500) return `服务商那边出错了（${status}）：稍后再试。`
    return `接口返回了错误（${status}）：${detail}`
  }
  if (error instanceof Error && error.name === 'AbortError') return '已中断'
  return `出错了：${error instanceof Error ? error.message : String(error)}`
}

export type ConnectionResult = { ok: true; reply: string; inputTokens: number | null; outputTokens: number | null } | { ok: false; message: string }

const finite = (n: number | undefined): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null)

/** 设置页的“测试连接”：最省 token 的一次调用，永远不抛异常 */
export async function testConnection(settings: ModelSettings): Promise<ConnectionResult> {
  try {
    const result = await generateText({
      model: createModel(settings),
      prompt: '只回复“好”',
      maxOutputTokens: 8,
      maxRetries: 0,
    })
    return { ok: true, reply: result.text.trim(), inputTokens: finite(result.usage.inputTokens), outputTokens: finite(result.usage.outputTokens) }
  } catch (error) {
    return { ok: false, message: describeAiError(error) }
  }
}
