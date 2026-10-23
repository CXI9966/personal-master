import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { ActionCard, AiScene } from '../../../shared/ai'
import { activeRunId, chatReducer, initialChat, isBusy, toModelMessages, type ChatItem } from './chatState'

export interface ChatApi {
  items: ChatItem[]
  busy: boolean
  /** 输入框里还没发出去的字。和对话放在同一层，切到别的页面再回来不会丢 */
  draft: string
  setDraft: (text: string) => void
  send: (text: string, scene: AiScene) => Promise<void>
  stop: () => void
  reset: () => void
  /** 确认、取消、撤销之后换上最新的卡片 */
  setCard: (card: ActionCard) => void
}

/** 对话的状态。放在主界面最外层，切换页面时对话不会丢，正在进行的对话也不会断 */
export function useChat(): ChatApi {
  const [state, dispatch] = useReducer(chatReducer, initialChat)
  const [draft, setDraft] = useState('')
  const latest = useRef(state)
  latest.current = state
  const counter = useRef(0)

  useEffect(() => window.butler.on('ai:event', (event) => dispatch({ type: 'event', event })), [])

  const send = useCallback(async (text: string, scene: AiScene) => {
    const trimmed = text.trim()
    if (!trimmed || isBusy(latest.current)) return
    const userId = `u${++counter.current}`
    const assistantId = `a${counter.current}`
    const messages = [...toModelMessages(latest.current.items), { role: 'user' as const, text: trimmed }]
    dispatch({ type: 'send', userId, assistantId, text: trimmed })
    try {
      const { runId } = await window.butler.invoke('ai:send', { messages, scene })
      dispatch({ type: 'runId', assistantId, runId })
    } catch (e) {
      dispatch({ type: 'fail', assistantId, message: e instanceof Error ? e.message : String(e) })
    }
  }, [])

  const stop = useCallback(() => {
    const runId = activeRunId(latest.current)
    if (runId) void window.butler.invoke('ai:cancel', { runId })
  }, [])

  const reset = useCallback(() => {
    dispatch({ type: 'reset' })
    void window.butler.invoke('ai:reset')
  }, [])

  const setCard = useCallback((card: ActionCard) => dispatch({ type: 'card', card }), [])

  return { items: state.items, busy: isBusy(state), draft, setDraft, send, stop, reset, setCard }
}
