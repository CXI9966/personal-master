// 管家对话用到的数据形状：界面和主进程共用

import type { ProviderKind } from './schema'

export type AiScene = 'chat' | 'plan' | 'review' | 'weekly'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

export type CardStatus = 'applied' | 'pending' | 'cancelled' | 'failed'

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
