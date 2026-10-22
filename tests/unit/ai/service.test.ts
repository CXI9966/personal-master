import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAiService, KEY_NAME, type AiService } from '../../../src/main/ai/service'
import { shortId } from '../../../src/main/ai/taskRef'
import { createTask } from '../../../src/main/app/services-tasks'
import { loadSettings, loadTasks } from '../../../src/main/domain/load'
import type { ActionCard, AiEvent, ModelConfig } from '../../../src/shared/ai'
import { PATHS } from '../../../src/shared/paths'
import { splitPersona } from '../../../src/shared/persona'
import { memorySecrets, newTestId, openTestSession, useShanghaiTimezone } from '../app/helpers'
import { startMockServer, type MockServer } from './mockServer'
import { waitFor } from '../store/helpers'

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
let secrets: ReturnType<typeof memorySecrets>
let ai: AiService
const provider = (): ModelConfig => ({ kind: 'openai-compatible', baseURL: server.baseURL, model: 'test-model' })

beforeEach(async () => {
  server.reset()
  test = await openTestSession()
  secrets = memorySecrets()
  ai = createAiService({ session: test.session, secrets, platform: test.platform, encryptionAvailable: () => true, newId: newTestId })
})
afterEach(async () => {
  await test.cleanup()
})
const ctx = () => test.session.ctx()
const configure = (): Promise<void> =>
  ai.saveConfig({ provider: provider(), contextStrategy: 'scene', actionMode: 'tools', apiKey: 'sk-secret-ABC123' })

/** 等这次对话结束，返回收到的全部事件 */
async function finished(runId: string): Promise<AiEvent[]> {
  expect(await waitFor(() => test.platform.aiEvents.some((e) => e.runId === runId && e.type === 'done'), 8000)).toBe(true)
  return test.platform.aiEvents.filter((e) => e.runId === runId)
}

describe('配置', () => {
  it('一开始没配置', async () => {
    expect(await ai.status()).toMatchObject({ configured: false, hasKey: false, encryptionAvailable: true, contextStrategy: 'scene', actionMode: 'tools' })
  })

  it('保存后：设置文件里有地址和模型，key 在密钥存储里，已配置', async () => {
    await configure()
    expect(await ai.status()).toMatchObject({ configured: true, hasKey: true, provider: provider() })
    expect(secrets.values.get(KEY_NAME)).toBe('sk-secret-ABC123')
    expect((await loadSettings(ctx().ws)).provider).toEqual(provider())
  })

  it('API key 绝不会出现在工作区的任何文件里（包括改动历史）', async () => {
    await configure()
    await ai.saveConfig({ provider: { ...provider(), model: 'other' }, contextStrategy: 'full', actionMode: 'json', apiKey: 'sk-secret-ABC123' })
    const files: string[] = []
    const stack = [test.root]
    while (stack.length > 0) {
      const dir = stack.pop()!
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) stack.push(full)
        else files.push(full)
      }
    }
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) expect(await readFile(file, 'utf8'), file).not.toContain('sk-secret-ABC123')
  })

  it('再次保存不填 key：保持原来的；clearKey：清掉', async () => {
    await configure()
    await ai.saveConfig({ provider: provider(), contextStrategy: 'scene', actionMode: 'tools' })
    expect(secrets.values.get(KEY_NAME)).toBe('sk-secret-ABC123')
    await ai.saveConfig({ provider: provider(), contextStrategy: 'scene', actionMode: 'tools', clearKey: true })
    expect(secrets.values.has(KEY_NAME)).toBe(false)
    expect((await ai.status()).configured).toBe(false)
  })

  it('这台电脑不能加密：拒绝保存 key，设置也没有被改成半成品', async () => {
    const noCrypto = createAiService({ session: test.session, secrets: memorySecrets({ available: false }), platform: test.platform, encryptionAvailable: () => false })
    await expect(noCrypto.saveConfig({ provider: provider(), contextStrategy: 'full', actionMode: 'json', apiKey: 'sk-x' })).rejects.toThrow(/无法加密/)
    const settings = await loadSettings(ctx().ws)
    expect(settings.provider.baseURL).toBe('')
    expect(settings.contextStrategy).toBe('scene')
    expect((await noCrypto.status()).encryptionAvailable).toBe(false)
  })

  it('地址末尾的斜杠和多余空白会被整理掉，不会替用户补 /v1', async () => {
    await ai.saveConfig({ provider: { kind: 'anthropic', baseURL: ' http://example.com/api/ ', model: ' m ' }, contextStrategy: 'scene', actionMode: 'tools', apiKey: 'k' })
    expect((await loadSettings(ctx().ws)).provider).toEqual({ kind: 'anthropic', baseURL: 'http://example.com/api', model: 'm' })
  })
})

describe('测试连接', () => {
  it('用表单里还没保存的 key', async () => {
    server.queue({ kind: 'text', text: '好' })
    expect(await ai.test({ provider: provider(), apiKey: 'sk-draft' })).toMatchObject({ ok: true, reply: '好' })
    expect(server.requests[0]!.headers.authorization).toBe('Bearer sk-draft')
  })

  it('没填 key 就用已保存的', async () => {
    await configure()
    await ai.test({ provider: provider() })
    expect(server.requests[0]!.headers.authorization).toBe('Bearer sk-secret-ABC123')
  })

  it('一个 key 都没有：说缺 API key', async () => {
    expect(await ai.test({ provider: provider() })).toMatchObject({ ok: false, message: expect.stringContaining('API key') })
  })
})

describe('对话', () => {
  it('没配置好就发：直接报错，不发请求', async () => {
    await expect(ai.send({ messages: [{ role: 'user', text: '你好' }], scene: 'chat' })).rejects.toThrow(/缺 接口地址、模型名、API key/)
    expect(server.requests).toHaveLength(0)
  })

  it('最后一条必须是用户说的', async () => {
    await configure()
    await expect(ai.send({ messages: [{ role: 'assistant', text: '我先说' }], scene: 'chat' })).rejects.toThrow(/最后一条/)
  })

  it('send 马上返回 runId，进展通过 notifyAi 推过来，用的是已保存的 key 和人格', async () => {
    await configure()
    await ctx().ws.writeText(PATHS.persona, '# 管家人格\n## 说话风格\n叫我船长\n')
    server.queue({ kind: 'text', text: '收到，船长。' })
    const { runId } = await ai.send({ messages: [{ role: 'user', text: '你好' }], scene: 'chat' })
    const events = await finished(runId)
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta).join('')).toBe('收到，船长。')
    expect(server.requests[0]!.headers.authorization).toBe('Bearer sk-secret-ABC123')
    expect(JSON.stringify(server.requests[0]!.body.messages)).toContain('叫我船长')
  })

  it('cancel：中断，done 带 aborted', async () => {
    await configure()
    server.queue({ kind: 'hang', text: '想……' })
    const { runId } = await ai.send({ messages: [{ role: 'user', text: '慢' }], scene: 'chat' })
    expect(await waitFor(() => test.platform.aiEvents.some((e) => e.type === 'text'), 5000)).toBe(true)
    ai.cancel(runId)
    expect(await finished(runId)).toContainEqual({ runId, type: 'done', aborted: true })
  })

  it('大改动：卡片待确认，ai.confirm 之后才生效；reset 之后旧卡片作废', async () => {
    await configure()
    const task = await createTask(ctx(), { title: '旧任务' })
    const other = await createTask(ctx(), { title: '另一个' })
    server.queue(
      { kind: 'tools', calls: [{ name: 'delete_task', args: { taskId: shortId(task.id) } }] },
      { kind: 'tools', calls: [{ name: 'delete_task', args: { taskId: shortId(other.id) } }] },
    )
    const first = await finished((await ai.send({ messages: [{ role: 'user', text: '删旧任务' }], scene: 'chat' })).runId)
    const card = first.flatMap((e) => (e.type === 'action' ? [e.card] : []))[0] as ActionCard
    expect(card.status).toBe('pending')
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(2)
    expect(await ai.confirm(card.id, true)).toMatchObject({ status: 'applied' })
    expect((await loadTasks(ctx().ws)).tasks.map((t) => t.title)).toEqual(['另一个'])

    const second = await finished((await ai.send({ messages: [{ role: 'user', text: '再删' }], scene: 'chat' })).runId)
    const card2 = second.flatMap((e) => (e.type === 'action' ? [e.card] : []))[0] as ActionCard
    ai.reset()
    await expect(ai.confirm(card2.id, true)).rejects.toThrow(/过期/)
    expect((await loadTasks(ctx().ws)).tasks).toHaveLength(1)
  })

  it('用量：一次对话记一笔，本周汇总里能看到', async () => {
    await configure()
    server.queue({ kind: 'text', text: '好', usage: { input: 100, output: 20 } })
    await finished((await ai.send({ messages: [{ role: 'user', text: '嗨' }], scene: 'plan' })).runId)
    const usage = await ai.usage()
    expect(usage.total).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20 })
    expect(usage.byFeature.plan).toEqual({ calls: 1, inputTokens: 100, outputTokens: 20 })
  })
})

describe('人格', () => {
  it('读出整篇和四栏；标题被改乱时 sections 是 null', async () => {
    const intact = await ai.persona()
    expect(intact.sections).not.toBeNull()
    expect(splitPersona(intact.markdown)).toEqual(intact.sections)
    await ctx().ws.writeText(PATHS.persona, '# 我自己写的\n随便写写\n')
    expect(await ai.persona()).toEqual({ markdown: '# 我自己写的\n随便写写\n', sections: null })
  })

  it('保存：写回管家人格.md，补上结尾换行，可以撤销', async () => {
    const before = (await ai.persona()).markdown
    await ai.savePersona('# 管家人格\n## 说话风格\n新的')
    expect(await readFile(join(test.root, PATHS.persona), 'utf8')).toBe('# 管家人格\n## 说话风格\n新的\n')
    expect(ctx().ws.lastChange()?.label).toBe('修改管家人格')
    await ctx().ws.undo(ctx().ws.lastChange()!.id)
    expect((await ai.persona()).markdown).toBe(before)
  })
})
