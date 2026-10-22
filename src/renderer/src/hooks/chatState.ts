import type { ActionCard, AiEvent, ChatMessage } from '../../../shared/ai'

export interface UserItem {
  kind: 'user'
  id: string
  text: string
}

export interface AssistantItem {
  kind: 'assistant'
  id: string
  /** 主进程给这次对话起的编号；事件靠它对号入座 */
  runId: string | null
  text: string
  cards: ActionCard[]
  notices: string[]
  error: string | null
  streaming: boolean
  aborted: boolean
}

export type ChatItem = UserItem | AssistantItem

export interface ChatState {
  items: ChatItem[]
}

export type ChatAction =
  | { type: 'send'; userId: string; assistantId: string; text: string }
  | { type: 'runId'; assistantId: string; runId: string }
  | { type: 'event'; event: AiEvent }
  /** 发都没发出去（比如还没配置好模型接口） */
  | { type: 'fail'; assistantId: string; message: string }
  /** 确认、取消、撤销之后，换上最新的卡片 */
  | { type: 'card'; card: ActionCard }
  | { type: 'reset' }

export const initialChat: ChatState = { items: [] }

const mapAssistant = (items: ChatItem[], match: (item: AssistantItem) => boolean, change: (item: AssistantItem) => AssistantItem): ChatItem[] => {
  let done = false
  return items.map((item) => {
    if (done || item.kind !== 'assistant' || !match(item)) return item
    done = true
    return change(item)
  })
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send':
      return {
        items: [
          ...state.items,
          { kind: 'user', id: action.userId, text: action.text },
          { kind: 'assistant', id: action.assistantId, runId: null, text: '', cards: [], notices: [], error: null, streaming: true, aborted: false },
        ],
      }
    case 'runId':
      return { items: mapAssistant(state.items, (a) => a.id === action.assistantId && a.runId === null, (a) => ({ ...a, runId: action.runId })) }
    case 'fail':
      return { items: mapAssistant(state.items, (a) => a.id === action.assistantId, (a) => ({ ...a, error: action.message, streaming: false })) }
    case 'reset':
      return initialChat
    case 'card': {
      const { card } = action
      return {
        items: state.items.map((item) =>
          item.kind === 'assistant' && item.cards.some((c) => c.id === card.id)
            ? { ...item, cards: item.cards.map((c) => (c.id === card.id ? card : c)) }
            : item,
        ),
      }
    }
    case 'event': {
      const { event } = action
      // 事件可能比 ai:send 的应答先到：还没有 runId 的、正在收的那条，认领第一个事件的 runId
      const target = (a: AssistantItem): boolean => a.runId === event.runId || (a.runId === null && a.streaming)
      return {
        items: mapAssistant(
          [...state.items].reverse(),
          target,
          (a) => {
            const base = a.runId === null ? { ...a, runId: event.runId } : a
            switch (event.type) {
              case 'text':
                return { ...base, text: base.text + event.delta }
              case 'action':
                return {
                  ...base,
                  cards: base.cards.some((c) => c.id === event.card.id)
                    ? base.cards.map((c) => (c.id === event.card.id ? event.card : c))
                    : [...base.cards, event.card],
                }
              case 'notice':
                return { ...base, notices: [...base.notices, event.text] }
              case 'error':
                return { ...base, error: event.message }
              case 'done':
                return { ...base, streaming: false, aborted: event.aborted }
            }
          },
        ).reverse(),
      }
    }
  }
}

const STATUS_NOTE: Record<ActionCard['status'], string> = {
  applied: '已执行',
  pending: '等用户确认',
  cancelled: '用户取消了',
  failed: '执行失败',
  undone: '执行后被用户撤销了',
}

/** 发给模型的历史：只有文字，但动作的结果也写进去，让它知道哪些已经做了 */
export function toModelMessages(items: ChatItem[]): ChatMessage[] {
  return items.flatMap((item): ChatMessage[] => {
    if (item.kind === 'user') return [{ role: 'user', text: item.text }]
    const notes = item.cards.map((card) => `[${STATUS_NOTE[card.status]}] ${card.summary}`)
    const text = [item.text.trim(), ...notes].filter(Boolean).join('\n')
    return text ? [{ role: 'assistant', text }] : []
  })
}

export const activeRunId = (state: ChatState): string | null => {
  const streaming = [...state.items].reverse().find((i): i is AssistantItem => i.kind === 'assistant' && i.streaming)
  return streaming?.runId ?? null
}

export const isBusy = (state: ChatState): boolean => state.items.some((i) => i.kind === 'assistant' && i.streaming)
