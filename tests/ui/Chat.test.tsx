import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useChat } from '../../src/renderer/src/hooks/useChat'
import Chat from '../../src/renderer/src/pages/Chat'
import { PLAN_PROMPT, ShellContext, type ShellApi } from '../../src/renderer/src/shellContext'
import type { ActionCard, AiStatus } from '../../src/shared/ai'
import { installButler, type ButlerMock } from './butlerMock'

const CONFIGURED: AiStatus = {
  provider: { kind: 'openai-compatible', baseURL: 'http://x/v1', model: 'm' },
  contextStrategy: 'scene',
  actionMode: 'tools',
  hasKey: true,
  encryptionAvailable: true,
  configured: true,
}
const card = (patch: Partial<ActionCard> = {}): ActionCard => ({ id: 'k1', name: 'add_task', level: 'small', summary: '新建任务「写周报」', status: 'applied', changeId: 'c1', ...patch })

function Harness() {
  const chat = useChat()
  return <Chat chat={chat} />
}

function setup(handlers: Record<string, unknown> = {}, shell?: Partial<ShellApi>): ButlerMock {
  const butler = installButler({
    'ai:status': CONFIGURED,
    'ai:send': { runId: 'r1' },
    'ai:cancel': undefined,
    'ai:reset': undefined,
    'history:last': { id: 'c1', label: '新建任务' },
    ...handlers,
  })
  const api: ShellApi = { ask: vi.fn(), goto: vi.fn(), ...shell }
  render(
    <ShellContext.Provider value={api}>
      <Harness />
    </ShellContext.Provider>,
  )
  return butler
}
const emit = (butler: ButlerMock, event: object): void => act(() => butler.emit('ai:event', { runId: 'r1', ...event } as never))

describe('管家页：发送和接收', () => {
  it('输入、Enter 发送：输入框清空，消息发给主进程，边收边显示，done 之后可以再发', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.type(await screen.findByLabelText('给管家发消息'), '早上好')
    await user.keyboard('{Enter}')
    expect(butler.callsOf('ai:send')).toEqual([{ messages: [{ role: 'user', text: '早上好' }], scene: 'chat' }])
    expect((screen.getByLabelText('给管家发消息') as HTMLTextAreaElement).value).toBe('')
    const log = screen.getByRole('log', { name: '对话' })
    expect(within(log).getByText('早上好')).toBeTruthy()
    expect(await screen.findByRole('button', { name: '停止' })).toBeTruthy()

    emit(butler, { type: 'text', delta: '早，' })
    emit(butler, { type: 'text', delta: '今天做什么？' })
    expect(await within(log).findByText('早，今天做什么？')).toBeTruthy()
    emit(butler, { type: 'done', aborted: false })
    expect(await screen.findByRole('button', { name: '发送' })).toBeTruthy()
  })

  it('Shift+Enter 是换行，不发送；输入法选字时的 Enter 也不发送', async () => {
    const user = userEvent.setup()
    const butler = setup()
    const box = (await screen.findByLabelText('给管家发消息')) as HTMLTextAreaElement
    await user.type(box, '第一行{Shift>}{Enter}{/Shift}第二行')
    expect(box.value).toBe('第一行\n第二行')
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true })
    expect(butler.callsOf('ai:send')).toEqual([])
  })

  it('空消息不能发', async () => {
    setup()
    expect((await screen.findByRole('button', { name: '发送' })) as HTMLButtonElement).toHaveProperty('disabled', true)
  })

  it('第二条消息会带上前面的对话，管家说过的话后面附着动作的结果', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.type(await screen.findByLabelText('给管家发消息'), '加个任务')
    await user.keyboard('{Enter}')
    emit(butler, { type: 'text', delta: '好。' })
    emit(butler, { type: 'action', card: card() })
    emit(butler, { type: 'done', aborted: false })
    await user.type(await screen.findByLabelText('给管家发消息'), '谢谢')
    await user.keyboard('{Enter}')
    expect(butler.callsOf('ai:send')[1]).toEqual({
      messages: [
        { role: 'user', text: '加个任务' },
        { role: 'assistant', text: '好。\n[已执行] 新建任务「写周报」' },
        { role: 'user', text: '谢谢' },
      ],
      scene: 'chat',
    })
  })

  it('发送失败（比如还没配置）：错误显示在对话里', async () => {
    const user = userEvent.setup()
    setup({ 'ai:send': () => { throw new Error('还没有配置好模型接口：缺 API key。') } })
    await user.type(await screen.findByLabelText('给管家发消息'), '你好')
    await user.keyboard('{Enter}')
    expect((await screen.findByRole('alert')).textContent).toBe('还没有配置好模型接口：缺 API key。')
    expect(await screen.findByRole('button', { name: '发送' })).toBeTruthy()
  })

  it('对话中出错、被提示、被停止：都显示出来', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.type(await screen.findByLabelText('给管家发消息'), 'x')
    await user.keyboard('{Enter}')
    emit(butler, { type: 'notice', text: '管家给出的动作有问题，已经让它重试一次' })
    emit(butler, { type: 'error', message: '接口拒绝了密钥（401）' })
    emit(butler, { type: 'done', aborted: false })
    expect(await screen.findByText('管家给出的动作有问题，已经让它重试一次')).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toBe('接口拒绝了密钥（401）')
  })

  it('点“停止”取消当前这次对话', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.type(await screen.findByLabelText('给管家发消息'), 'x')
    await user.keyboard('{Enter}')
    emit(butler, { type: 'text', delta: '想' })
    await user.click(await screen.findByRole('button', { name: '停止' }))
    expect(butler.callsOf('ai:cancel')).toEqual([{ runId: 'r1' }])
    emit(butler, { type: 'done', aborted: true })
    expect(await screen.findByText('已停止')).toBeTruthy()
  })

  it('两个快捷按钮：用对应场景发出预设的话；新对话清空并通知主进程', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.click(await screen.findByRole('button', { name: '让管家排今天' }))
    expect(butler.callsOf('ai:send')[0]).toMatchObject({ scene: 'plan', messages: [{ role: 'user', text: PLAN_PROMPT }] })
    emit(butler, { type: 'done', aborted: false })
    await user.click(await screen.findByRole('button', { name: '新对话' }))
    expect(butler.callsOf('ai:reset')).toEqual([undefined])
    expect(within(screen.getByRole('log', { name: '对话' })).queryByText(PLAN_PROMPT)).toBeNull()
  })
})

describe('管家页：还没配置', () => {
  it('提示去设置，点按钮跳到设置页', async () => {
    const user = userEvent.setup()
    const goto = vi.fn()
    setup({ 'ai:status': { ...CONFIGURED, configured: false, hasKey: false } }, { goto })
    expect(await screen.findByRole('region', { name: '还没有配置模型接口' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '去设置' }))
    expect(goto).toHaveBeenCalledWith('settings')
  })

  it('配置好了就没有这个提示', async () => {
    setup()
    await screen.findByLabelText('给管家发消息')
    await waitFor(() => expect(screen.queryByRole('region', { name: '还没有配置模型接口' })).toBeNull())
  })
})

describe('动作卡片', () => {
  async function withCard(c: ActionCard, handlers: Record<string, unknown> = {}) {
    const user = userEvent.setup()
    const butler = setup(handlers)
    await user.type(await screen.findByLabelText('给管家发消息'), '来')
    await user.keyboard('{Enter}')
    emit(butler, { type: 'action', card: c })
    return { user, butler }
  }

  it('小改动已执行：显示一句话，还是最近一次改动时可以撤销，撤销后变成已撤销', async () => {
    const { user, butler } = await withCard(card(), { 'history:undo': true })
    const list = await screen.findByRole('list', { name: '管家提出的动作' })
    expect(within(list).getByText('已执行')).toBeTruthy()
    expect(within(list).getByText('新建任务「写周报」')).toBeTruthy()
    await user.click(await within(list).findByRole('button', { name: '撤销：新建任务「写周报」' }))
    expect(butler.callsOf('history:undo')).toEqual([{ changeId: 'c1' }])
    expect(await within(list).findByText('已撤销')).toBeTruthy()
  })

  it('之后又有了新改动，就不再给撤销按钮', async () => {
    await withCard(card(), { 'history:last': { id: 'later', label: '别的改动' } })
    const list = await screen.findByRole('list', { name: '管家提出的动作' })
    expect(within(list).queryByRole('button', { name: /撤销/ })).toBeNull()
  })

  it('大改动待确认：点确认才执行，卡片换成主进程返回的最新状态', async () => {
    const pending = card({ id: 'k2', level: 'big', status: 'pending', summary: '删除任务「旧的」', changeId: undefined })
    const { user, butler } = await withCard(pending, { 'ai:confirm': card({ id: 'k2', level: 'big', status: 'applied', summary: '删除任务「旧的」', changeId: 'c2' }) })
    const list = await screen.findByRole('list', { name: '管家提出的动作' })
    expect(within(list).getByText('需要你确认')).toBeTruthy()
    await user.click(within(list).getByRole('button', { name: '确认：删除任务「旧的」' }))
    expect(butler.callsOf('ai:confirm')).toEqual([{ cardId: 'k2', accept: true }])
    expect(await within(list).findByText('已执行')).toBeTruthy()
  })

  it('点取消：发 accept:false，卡片变成已取消', async () => {
    const pending = card({ id: 'k3', level: 'big', status: 'pending', summary: '删除任务「旧的」', changeId: undefined })
    const { user, butler } = await withCard(pending, { 'ai:confirm': card({ id: 'k3', level: 'big', status: 'cancelled', summary: '删除任务「旧的」' }) })
    await user.click(await screen.findByRole('button', { name: '取消：删除任务「旧的」' }))
    expect(butler.callsOf('ai:confirm')).toEqual([{ cardId: 'k3', accept: false }])
    expect(await screen.findByText('已取消')).toBeTruthy()
  })

  it('确认时出错（比如卡片过期了）：显示原因', async () => {
    const pending = card({ id: 'k4', level: 'big', status: 'pending', changeId: undefined })
    const { user } = await withCard(pending, { 'ai:confirm': () => { throw new Error('这个待确认的操作已经过期了，请让管家重新提出') } })
    await user.click(await screen.findByRole('button', { name: /确认：/ }))
    expect(await screen.findByText('这个待确认的操作已经过期了，请让管家重新提出')).toBeTruthy()
  })

  it('执行失败的卡片显示失败原因', async () => {
    await withCard(card({ status: 'failed', error: '结束时间要晚于开始时间', changeId: undefined }))
    expect(await screen.findByText('没成功')).toBeTruthy()
    expect(screen.getByText('结束时间要晚于开始时间')).toBeTruthy()
  })
})
