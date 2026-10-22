// 管家对话用到的数据形状：界面和主进程共用

import type { ActionMode, ContextStrategy, ProviderKind } from './schema'

export type AiScene = 'chat' | 'plan' | 'review' | 'weekly'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

/** applied 已执行；pending 等用户确认；cancelled 用户取消了；failed 执行失败；undone 执行后又被撤销了 */
export type CardStatus = 'applied' | 'pending' | 'cancelled' | 'failed' | 'undone'

/** 管家提出的一个动作：小改动直接执行后显示“已执行”，大改动先显示“待确认” */
export interface ActionCard {
  id: string
  /** 动作名，例如 add_task */
  name: string
  level: 'small' | 'big'
  /** 给人看的一句话，例如 新建任务「写周报」 */
  summary: string
  status: CardStatus
  /** 小改动执行后的改动编号，可以用来撤销 */
  changeId?: string
  /** 失败原因 */
  error?: string
}

export type AiEvent =
  | { runId: string; type: 'text'; delta: string }
  | { runId: string; type: 'action'; card: ActionCard }
  | { runId: string; type: 'notice'; text: string }
  | { runId: string; type: 'error'; message: string }
  | { runId: string; type: 'done'; aborted: boolean }

/** 模型接口的配置；API key 单独放，不在这里 */
export interface ModelConfig {
  kind: ProviderKind
  baseURL: string
  model: string
}

/** 设置页和第一次运行页看的：模型接口配置到哪一步了 */
export interface AiStatus {
  provider: ModelConfig
  contextStrategy: ContextStrategy
  actionMode: ActionMode
  /** 已经保存了 API key（key 本身不会传给界面） */
  hasKey: boolean
  /** 这台电脑能不能加密保存 key；不能的话保存 key 会被拒绝 */
  encryptionAvailable: boolean
  /** 地址、模型名、key 都有了 */
  configured: boolean
}

export type ConnectionResult =
  | { ok: true; reply: string; inputTokens: number | null; outputTokens: number | null }
  | { ok: false; message: string }

export interface UsageTotals {
  calls: number
  inputTokens: number
  outputTokens: number
}

export interface UsageSummary {
  weekKey: string
  weekStart: string
  weekEnd: string
  total: UsageTotals
  byFeature: Partial<Record<AiScene, UsageTotals>>
  /** 这一周每一天都有一项，没调用的天是 0 */
  byDay: Array<UsageTotals & { date: string }>
  /** 有的接口不返回 token 数，这些调用只算次数 */
  callsWithoutTokens: number
}

export interface PersonaPresetInfo {
  id: string
  name: string
  summary: string
  markdown: string
}
