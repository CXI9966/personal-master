import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { ActionEngine } from '../../../src/main/ai/engine'
import { createModel } from '../../../src/main/ai/provider'
import { runChat, type RunInput } from '../../../src/main/ai/runner'
import { shortId } from '../../../src/main/ai/taskRef'
import { createTask } from '../../../src/main/app/services-tasks'
import { loadPlan, loadTasks } from '../../../src/main/domain/load'
import type { AiEvent } from '../../../src/shared/ai'
import { PATHS } from '../../../src/shared/paths'
import { UsageEntry, type ActionMode, type ContextStrategy, type ProviderKind } from '../../../src/shared/schema'
import { newTestId, openTestSession, useShanghaiTimezone } from '../app/helpers'
// （这个文件只测对话循环本身；密钥、配置这些在 service.test.ts）
import { startMockServer, type MockServer } from './mockServer'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

let server: MockServer
beforeAll(async () => {
  server = await startMockServer()
})
afterAll(async () => {
  await server.close()
})

let test: Awaited<ReturnType<typeof openTestSession>>
beforeEach(async () => {
  server.reset()
  test = await openTestSession()
})
afterEach(async () => {
  await test.cleanup()
})
const ctx = () => test.session.ctx()

interface Setup {
  kind?: ProviderKind
  mode?: ActionMode
  strategy?: ContextStrategy
  signal?: AbortSignal
  maxRounds?: number
  scene?: RunInput['scene']
}

/** 跑一次对话，返回所有事件和引擎（用来确认待确认的卡片） */
async function chat(text: string, setup: Setup = {}): Promise<{ events: AiEvent[]; engine: ActionEngine }> {
  const kind = setup.kind ?? 'openai-compatible'
  const engine = new ActionEngine(ctx(), newTestId)
  const events: AiEvent[] = []
  await runChat({
    ctx: ctx(),
    engine,
    model: createModel({ kind, baseURL: server.baseURL, model: 'test-model', apiKey: 'sk-test' }),
    provider: { kind, model: 'test-model' },
    actionMode: setup.mode ?? 'tools',
    contextStrategy: setup.strategy ?? 'scene',
    persona: '# 管家人格\n测试用的人格',
    scene: setup.scene ?? 'chat',
    messages: [{ role: 'user', text }],
    signal: setup.signal ?? new AbortController().signal,
    runId: 'run-1',
    emit: (event) => events.push(event),
    maxRetries: 0,
    maxRounds: setup.maxRounds,
  })
  return { events, engine }
}

const textOf = (events: AiEvent[]): string => events.flatMap((e) => (e.type === 'text' ? [e.delta] : [])).join('')
const types = (events: AiEvent[]): string[] => events.map((e) => e.type)
const cards = (events: AiEvent[]) => events.flatMap((e) => (e.type === 'action' ? [e.card] : []))

describe.each<ProviderKind>(['openai-compatible', 'anthropic'])('%s', (kind) => {
  it('只有文字：边收边推给界面，最后 done；记一笔用量', async () => {
    server.queue({ kind: 'text', text: '早上好，今天先做哪一件？', usage: { input: 40, output: 9 } })
    const { events } = await chat('早', { kind })
    expect(textOf(events)).toBe('早上好，今天先做哪一件？')
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(1) // 是分段到的
    expect(events.at(-1)).toEqual({ runId: 'run-1', type: 'done', aborted: false })
    const { items } = await ctx().ws.readLines(PATHS.usage, UsageEntry)
    expect(items).toMatchObject([{ provider: kind, model: 'test-model', feature: 'chat', inputTokens: 40, outputTokens: 9 }])
  })

  it('请求里带着系统提示词（规则、人格、上下文）和工具定义，且用的是对应的协议和密钥', async () => {
    await chat('你好', { kind })
    const request = server.requests[0]!
    expect(request.protocol).toBe(kind === 'anthropic' ? 'anthropic' : 'openai')
    const system = kind === 'anthropic'
      ? JSON.stringify(request.body.system)
      : JSON.stringify((request.body.messages as Array<{ role: string; content: unknown }>)[0])
    for (const part of ['你是用户的个人管家', '测试用的人格', '## 今天的计划']) expect(system).toContain(part)
    const toolNames = (request.body.tools as Array<{ name?: string; function?: { name: string } }>).map((t) => t.name ?? t.function?.name)
    expect(toolNames).toHaveLength(12) // 只有改数据的动作，没有查询工具
    expect(toolNames).not.toContain('get_tasks')
    expect(request.body.max_tokens).toBe(4096)
  })

  it('小改动：模型提出新建任务，直接执行，卡片是已执行，带可以撤销的编号', async () => {
    server.queue({ kind: 'tools', text: '好，我来加。', calls: [{ name: 'add_task', args: { title: '写周报', addToToday: true } }] })
    const { events } = await chat('帮我加个任务：写周报', { kind })
    expect(textOf(events)).toBe('好，我来加。')
    const [card] = cards(events)
    expect(card).toMatchObject({ name: 'add_task', level: 'small', status: 'applied', summary: '新建任务「写周报」，加入今天' })
    expect(card?.changeId).toBeTruthy()
    expect((await loadTasks(ctx().ws)).tasks.map((t) => t.title)).toEqual(['写周报'])
    expect(server.requests).toHaveLength(1) // 没有第二轮
    expect(types(events).at(-1)).toBe('done')
  })

  it('大改动：只出待确认的卡片，数据一点没动；确认后才生效', async () => {
    const task = await createTask(ctx(), { title: '旧任务' })
    server.queue({ kind: 'tools', text: '要删掉它吗？', calls: [{ name: 'delete_task', args: { taskId: shortId(task.id) } }] })
    const { events, engine } = await chat('删掉旧任务', { kind })
    const [card] = cards(events)
    expect(card).toMatchObject({ name: 'delete_task', level: 'big', status: 'pending', summary: '删除任务「旧任务」' })
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(1)
    expect(await engine.confirm(card!.id, true)).toMatchObject({ status: 'applied' })
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(0)
  })
})

describe('校验和重试', () => {
  it('参数不合法：整批不执行，把原因发回去让模型重试一次，改对后执行', async () => {
    server.queue(
      { kind: 'tools', calls: [{ name: 'add_task', args: { title: '写周报' } }, { name: 'log_weight', args: { kg: '很重' } }] },
      { kind: 'tools', text: '改好了。', calls: [{ name: 'add_task', args: { title: '写周报' } }, { name: 'log_weight', args: { kg: 76.4 } }] },
    )
    const { events } = await chat('加任务，体重 76.4')
    expect(types(events)).toContain('notice')
    expect(cards(events).map((c) => c.status)).toEqual(['applied', 'applied'])
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(1) // 只加了一次，不是两次
    expect(server.requests).toHaveLength(2)
    // 第二次请求里带着第一次的调用和每个调用的失败原因（包括那个本身没问题的）
    const second = JSON.stringify(server.requests[1]!.body.messages)
    expect(second).toContain('log_weight')
    expect(second).toContain('参数有误')
    expect(second).toContain('没有执行')
  })

  it('两次都不对：给出错误，一个动作都没执行', async () => {
    server.queue(
      { kind: 'tools', calls: [{ name: 'add_task', args: { title: 123 } }] },
      { kind: 'tools', calls: [{ name: 'add_task', args: { title: 456 } }] },
    )
    const { events } = await chat('加任务')
    const error = events.find((e) => e.type === 'error')
    expect(error).toMatchObject({ message: expect.stringContaining('两次给出的动作都有问题') })
    expect(cards(events)).toEqual([])
    expect((await loadTasks(ctx().ws)).tasks).toEqual([])
    expect(server.requests).toHaveLength(2)
    expect(types(events).at(-1)).toBe('done')
  })

  it('引用了不存在的任务：校验阶段就发现，消息里列出现有编号，重试后成功', async () => {
    const task = await createTask(ctx(), { title: 'A' })
    server.queue(
      { kind: 'tools', calls: [{ name: 'complete_task', args: { taskId: 'deadbeef' } }] },
      { kind: 'tools', calls: [{ name: 'complete_task', args: { taskId: shortId(task.id) } }] },
    )
    const { events } = await chat('完成 A')
    expect(JSON.stringify(server.requests[1]!.body.messages)).toContain(shortId(task.id))
    expect(cards(events)).toMatchObject([{ name: 'complete_task', status: 'applied' }])
  })

  it('同一次回复里有好几个动作：按顺序都执行', async () => {
    server.queue({ kind: 'tools', calls: [{ name: 'log_weight', args: { kg: 76 } }, { name: 'log_workout', args: { summary: '跑步' } }, { name: 'add_task', args: { title: 'T' } }] })
    const { events } = await chat('记一下')
    expect(cards(events).map((c) => c.name)).toEqual(['log_weight', 'log_workout', 'add_task'])
  })

  it('执行时才发现的错误（比如时间倒过来）：卡片显示失败和原因，其余照常', async () => {
    server.queue({ kind: 'tools', calls: [{ name: 'add_plan_item', args: { start: '10:00', end: '09:00', title: '倒着' } }, { name: 'log_weight', args: { kg: 76 } }] })
    const { events } = await chat('排一下')
    expect(cards(events)).toMatchObject([{ status: 'failed', error: expect.stringContaining('晚于') }, { status: 'applied' }])
    expect((await loadPlan(ctx().ws, '2026-10-23')).timeline).toEqual([])
  })
})

describe('查询工具（让它自己按需查）', () => {
  it('模型先查任务，拿到结果后接着回答：两轮请求，第二轮带着查询结果，界面上没有卡片', async () => {
    const task = await createTask(ctx(), { title: '写周报', due: '2026-10-30' })
    server.queue(
      { kind: 'tools', calls: [{ name: 'get_tasks', args: {} }] },
      { kind: 'text', text: '你有一个任务：写周报。' },
    )
    const { events } = await chat('我有什么任务？', { strategy: 'tools' })
    expect(textOf(events)).toBe('你有一个任务：写周报。')
    expect(cards(events)).toEqual([])
    expect(server.requests).toHaveLength(2)
    expect(JSON.stringify(server.requests[1]!.body.messages)).toContain(`${shortId(task.id)} [收集箱] 写周报`)
    const first = server.requests[0]!.body.tools as Array<{ function: { name: string } }>
    expect(first.map((t) => t.function.name)).toContain('get_tasks')
    expect(first).toHaveLength(16)
  })

  it('来回次数有上限，不会无限查下去', async () => {
    for (let i = 0; i < 6; i++) server.queue({ kind: 'tools', calls: [{ name: 'get_profile', args: {} }] })
    const { events } = await chat('一直查', { strategy: 'tools', maxRounds: 3 })
    expect(server.requests).toHaveLength(3)
    expect(events.find((e) => e.type === 'notice')).toMatchObject({ text: expect.stringContaining('上限') })
    expect(types(events).at(-1)).toBe('done')
  })

  it('按场景策略下不提供查询工具；模型硬要调也会被拒绝并重试', async () => {
    server.queue({ kind: 'tools', calls: [{ name: 'get_tasks', args: {} }] }, { kind: 'text', text: '好吧。' })
    const { events } = await chat('查一下', { strategy: 'scene' })
    expect(types(events)).toContain('notice')
    expect(textOf(events)).toBe('好吧。')
  })
})

describe('中断和错误', () => {
  it('用户中断：done 带 aborted，已经收到的文字保留，不执行任何动作', async () => {
    const controller = new AbortController()
    server.queue({ kind: 'hang', text: '正在想……' })
    const run = chat('慢慢来', { signal: controller.signal })
    await new Promise((resolve) => setTimeout(resolve, 300))
    controller.abort()
    const { events } = await run
    expect(textOf(events)).toBe('正在想……')
    expect(events.at(-1)).toEqual({ runId: 'run-1', type: 'done', aborted: true })
    expect(cards(events)).toEqual([])
  })

  it.each([
    [401, '401'],
    [404, '404'],
    [500, '500'],
  ])('接口回 %i：界面收到可读的错误，不写任何数据', async (status, mark) => {
    server.queue({ kind: 'error', status })
    const { events } = await chat('你好')
    const error = events.find((e) => e.type === 'error')
    expect(error).toMatchObject({ message: expect.stringContaining(mark) })
    expect(types(events).at(-1)).toBe('done')
    expect(cards(events)).toEqual([])
  })

  it('网络不通', async () => {
    const events: AiEvent[] = []
    await runChat({
      ctx: ctx(), engine: new ActionEngine(ctx(), newTestId),
      model: createModel({ kind: 'openai-compatible', baseURL: 'http://127.0.0.1:1/v1', model: 'm', apiKey: 'k' }),
      provider: { kind: 'openai-compatible', model: 'm' }, actionMode: 'tools', contextStrategy: 'scene', persona: 'p', scene: 'chat',
      messages: [{ role: 'user', text: 'hi' }], signal: new AbortController().signal, runId: 'r', emit: (e) => events.push(e), maxRetries: 0,
    })
    expect(events.find((e) => e.type === 'error')).toMatchObject({ message: expect.stringContaining('连不上模型接口') })
  })
})

describe('JSON 文本模式', () => {
  const block = (json: string): string => `好的，我来加。\n\`\`\`json\n${json}\n\`\`\``

  it('不发工具定义，系统提示词里有动作说明；代码块里的动作被执行，界面看到的文字里没有代码块', async () => {
    server.queue({ kind: 'text', text: block('{"actions":[{"name":"add_task","args":{"title":"写周报"}}]}') })
    const { events } = await chat('加任务：写周报', { mode: 'json' })
    expect(server.requests[0]!.body.tools).toBeUndefined()
    expect(JSON.stringify(server.requests[0]!.body.messages)).toContain('在回复的最后输出一个 json 代码块')
    expect(textOf(events)).toBe('好的，我来加。')
    expect(cards(events)).toMatchObject([{ name: 'add_task', status: 'applied' }])
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(1)
  })

  it('JSON 写坏了：让模型重试一次（用普通的用户消息说明问题）', async () => {
    server.queue({ kind: 'text', text: block('{"actions":[') }, { kind: 'text', text: block('{"actions":[{"name":"log_weight","args":{"kg":76}}]}') })
    const { events } = await chat('记体重 76', { mode: 'json' })
    expect(types(events)).toContain('notice')
    expect(JSON.stringify(server.requests[1]!.body.messages)).toContain('你上一条回复里的动作有问题')
    expect(cards(events)).toMatchObject([{ name: 'log_weight', status: 'applied' }])
  })

  it('“让它自己按需查”在 JSON 模式下自动退回按场景：没有查询工具，上下文里有完整的今天', async () => {
    await chat('你好', { mode: 'json', strategy: 'tools' })
    expect(JSON.stringify(server.requests[0]!.body.messages)).not.toContain('get_tasks')
    expect(JSON.stringify(server.requests[0]!.body.messages)).toContain('## 现在')
  })

  it('大改动同样要确认', async () => {
    const task = await createTask(ctx(), { title: 'X' })
    server.queue({ kind: 'text', text: block(`{"actions":[{"name":"delete_task","args":{"taskId":"${shortId(task.id)}"}}]}`) })
    const { events } = await chat('删 X', { mode: 'json' })
    expect(cards(events)).toMatchObject([{ status: 'pending' }])
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(1)
  })
})

describe('场景', () => {
  it('不同场景的用量记在对应的功能下，上下文也不同', async () => {
    await chat('复盘', { scene: 'review' })
    expect(JSON.stringify(server.requests[0]!.body.messages)).toContain('## 最近的学习检验')
    const { items } = await ctx().ws.readLines(PATHS.usage, UsageEntry)
    expect(items[0]?.feature).toBe('review')
  })
})
