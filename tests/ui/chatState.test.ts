import { describe, expect, it } from 'vitest'
import type { ActionCard, AiEvent, AiEventBody } from '../../src/shared/ai'
import {
  activeRunId,
  chatReducer,
  initialChat,
  isBusy,
  toModelMessages,
  type AssistantItem,
  type ChatAction,
  type ChatState,
} from '../../src/renderer/src/hooks/chatState'

const card = (patch: Partial<ActionCard> = {}): ActionCard => ({ id: 'k1', name: 'add_task', level: 'small', summary: '新建任务「写周报」', status: 'applied', ...patch })
const run = (state: ChatState, ...actions: ChatAction[]): ChatState => actions.reduce(chatReducer, state)
const event = (e: AiEventBody & { runId?: string }): ChatAction => ({ type: 'event', event: { runId: 'r1', ...e } as AiEvent })
const assistant = (state: ChatState, index = 1): AssistantItem => state.items[index] as AssistantItem
const sent = (): ChatState => run(initialChat, { type: 'send', userId: 'u1', assistantId: 'a1', text: '你好' })

describe('chatReducer', () => {
  it('发送：加一条用户消息和一条正在收的管家消息', () => {
    const state = sent()
    expect(state.items).toHaveLength(2)
    expect(state.items[0]).toEqual({ kind: 'user', id: 'u1', text: '你好' })
    expect(assistant(state)).toMatchObject({ runId: null, text: '', streaming: true })
    expect(isBusy(state)).toBe(true)
  })

  it('事件比 ai:send 的应答先到：正在收的那条认领这个 runId', () => {
    const state = run(sent(), event({ type: 'text', delta: '早' }), { type: 'runId', assistantId: 'a1', runId: 'r1' })
    expect(assistant(state)).toMatchObject({ runId: 'r1', text: '早' })
    expect(activeRunId(state)).toBe('r1')
  })

  it('文字一段段拼起来；动作卡片按 id 更新而不是重复添加；提示和错误记下来；done 结束', () => {
    const state = run(
      sent(),
      event({ type: 'text', delta: '好，' }),
      event({ type: 'text', delta: '我来加。' }),
      event({ type: 'action', card: card({ status: 'pending' }) }),
      event({ type: 'action', card: card({ status: 'applied' }) }),
      event({ type: 'notice', text: '重试了一次' }),
      event({ type: 'error', message: '接口出错了' }),
      event({ type: 'done', aborted: false }),
    )
    expect(assistant(state)).toMatchObject({ text: '好，我来加。', notices: ['重试了一次'], error: '接口出错了', streaming: false, aborted: false })
    expect(assistant(state).cards).toEqual([card({ status: 'applied' })])
    expect(isBusy(state)).toBe(false)
    expect(activeRunId(state)).toBeNull()
  })

  it('被中断：done 带 aborted', () => {
    const state = run(sent(), event({ type: 'text', delta: '想' }), event({ type: 'done', aborted: true }))
    expect(assistant(state)).toMatchObject({ text: '想', streaming: false, aborted: true })
  })

  it('别的对话的事件、没人认领的事件会被忽略', () => {
    let state = run(sent(), event({ type: 'text', delta: '一', runId: 'r1' }), event({ type: 'done', aborted: false, runId: 'r1' }))
    state = run(state, event({ type: 'text', delta: '不该出现', runId: 'r-old' }))
    expect(assistant(state).text).toBe('一')
  })

  it('连着两轮对话：第二轮的事件只落在第二条管家消息上', () => {
    let state = run(sent(), event({ type: 'text', delta: '一', runId: 'r1' }), event({ type: 'done', aborted: false, runId: 'r1' }))
    state = run(state, { type: 'send', userId: 'u2', assistantId: 'a2', text: '再来' }, event({ type: 'text', delta: '二', runId: 'r2' }))
    expect(assistant(state, 1).text).toBe('一')
    expect(assistant(state, 3)).toMatchObject({ text: '二', runId: 'r2' })
  })

  it('发送失败：错误记在这条管家消息上，不再显示“正在收”', () => {
    const state = run(sent(), { type: 'fail', assistantId: 'a1', message: '还没有配置好模型接口' })
    expect(assistant(state)).toMatchObject({ error: '还没有配置好模型接口', streaming: false })
  })

  it('确认、取消、撤销之后换上新卡片', () => {
    const state = run(sent(), event({ type: 'action', card: card({ status: 'pending' }) }), { type: 'card', card: card({ status: 'cancelled' }) })
    expect(assistant(state).cards[0]?.status).toBe('cancelled')
  })

  it('reset 清空', () => {
    expect(run(sent(), { type: 'reset' })).toEqual(initialChat)
  })
})

describe('toModelMessages：发给模型的历史', () => {
  it('用户的话原样；管家的话后面附上各个动作的结果，让它知道哪些已经做了', () => {
    const state = run(
      sent(),
      event({ type: 'text', delta: '好的。' }),
      event({ type: 'action', card: card({ status: 'applied' }) }),
      event({ type: 'action', card: card({ id: 'k2', summary: '删除任务「旧的」', level: 'big', status: 'pending' }) }),
      event({ type: 'action', card: card({ id: 'k3', summary: '记体重 76 kg', status: 'undone' }) }),
      event({ type: 'done', aborted: false }),
    )
    expect(toModelMessages(state.items)).toEqual([
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '好的。\n[已执行] 新建任务「写周报」\n[等用户确认] 删除任务「旧的」\n[执行后被用户撤销了] 记体重 76 kg' },
    ])
  })

  it('什么都没说的管家消息（出错、被中断）不放进历史', () => {
    const state = run(sent(), { type: 'fail', assistantId: 'a1', message: 'x' })
    expect(toModelMessages(state.items)).toEqual([{ role: 'user', text: '你好' }])
  })
})
