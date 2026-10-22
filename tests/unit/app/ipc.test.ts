import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSession } from '../../../src/main/app/session'
import { createHandlers } from '../../../src/main/ipc'
import { registerIpc, toIpcError, type IpcMainLike } from '../../../src/main/ipc/register'
import { DomainError } from '../../../src/main/domain/errors'
import { WorkspaceError } from '../../../src/main/store/errors'
import { CHANNELS, type IpcResult } from '../../../src/shared/ipc'
import { z } from 'zod'
import { makeTempDir } from '../store/helpers'
import { fakePlatform, NOW, newTestId, useShanghaiTimezone } from './helpers'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

class FakeIpcMain implements IpcMainLike {
  readonly listeners = new Map<string, (event: unknown, request: unknown) => unknown>()
  handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void {
    this.listeners.set(channel, listener)
  }
  call(channel: string, request?: unknown, event: unknown = {}): Promise<IpcResult<unknown>> {
    const listener = this.listeners.get(channel)
    if (!listener) throw new Error(`没有注册 ${channel}`)
    return Promise.resolve(listener(event, request)) as Promise<IpcResult<unknown>>
  }
}

function setup() {
  const platform = fakePlatform()
  const session = createSession({ platform, now: () => NOW, newId: newTestId, renderDelayMs: 20, watch: false })
  const handlers = createHandlers(session, platform)
  const ipc = new FakeIpcMain()
  registerIpc(ipc, handlers)
  return { platform, session, handlers, ipc }
}

describe('通道表', () => {
  it('每个通道都有 handler，也都注册了', () => {
    const { handlers, ipc } = setup()
    expect(Object.keys(handlers).sort()).toEqual([...CHANNELS].sort())
    expect([...ipc.listeners.keys()].sort()).toEqual([...CHANNELS].sort())
  })
})

describe('应答格式', () => {
  it('成功：{ ok: true, data }', async () => {
    const { ipc } = setup()
    expect(await ipc.call('app:state')).toEqual({ ok: true, data: { workspaceRoot: null, initialized: false, defaultRoot: 'C:\\默认\\Butler' } })
  })

  it('还没有工作区就读数据：失败，消息可以直接给用户看', async () => {
    const { ipc } = setup()
    expect(await ipc.call('today:get')).toEqual({ ok: false, error: '还没有选择工作区', code: 'invalid' })
  })

  it('参数不对：bad-request，不暴露内部细节', async () => {
    const { ipc, session } = setup()
    const tmp = await makeTempDir()
    await session.initialize(tmp.dir, 'coach')
    expect(await ipc.call('checkin:add', { type: 'nap' })).toEqual({ ok: false, error: '请求参数不对', code: 'bad-request' })
    expect(await ipc.call('workspace:init', { root: tmp.dir, persona: '随便' })).toMatchObject({ ok: false, code: 'bad-request' })
    await session.close()
    await tmp.cleanup()
  })

  it('不可信的请求来源被拒绝', async () => {
    const platform = fakePlatform()
    const session = createSession({ platform, watch: false })
    const ipc = new FakeIpcMain()
    registerIpc(ipc, createHandlers(session, platform), () => false)
    expect(await ipc.call('app:state')).toMatchObject({ ok: false, code: 'untrusted' })
  })

  it('toIpcError：业务错误、文件错误、未知错误', () => {
    expect(toIpcError(new DomainError('not-found', '找不到任务'))).toEqual({ error: '找不到任务', code: 'not-found' })
    expect(toIpcError(new WorkspaceError('busy', 'a', '文件被其他程序占用：a'))).toEqual({ error: '文件被其他程序占用：a', code: 'busy' })
    expect(toIpcError(new z.ZodError([]))).toMatchObject({ code: 'bad-request' })
    expect(toIpcError(new Error('boom'))).toEqual({ error: '出错了：boom', code: 'unknown' })
    expect(toIpcError('字符串')).toEqual({ error: '出错了：字符串', code: 'unknown' })
  })
})

describe('第一次运行到打卡的完整流程', () => {
  it('inspect → init → today:get → checkin:add → history:undo', async () => {
    const { ipc, platform, session } = setup()
    const tmp = await makeTempDir()
    platform.picked = tmp.dir
    expect(await ipc.call('workspace:pick')).toEqual({ ok: true, data: tmp.dir })
    expect(await ipc.call('workspace:inspect', { root: tmp.dir })).toEqual({ ok: true, data: { exists: true, initialized: false } })
    const init = (await ipc.call('workspace:init', { root: tmp.dir, persona: 'coach' })) as { ok: true; data: { workspaceRoot: string } }
    expect(init.data.workspaceRoot).toBe(tmp.dir)

    await ipc.call('checkin:add', { type: 'wake' })
    const today = (await ipc.call('today:get')) as { ok: true; data: { wake: unknown } }
    expect(today.data.wake).not.toBeNull()
    const last = (await ipc.call('history:last')) as { ok: true; data: { id: string; label: string } }
    expect(last.data.label).toBe('起床打卡')
    expect(await ipc.call('history:undo', { changeId: last.data.id })).toEqual({ ok: true, data: true })
    expect(((await ipc.call('today:get')) as { ok: true; data: { wake: unknown } }).data.wake).toBeNull()
    await session.close() // 先关会话（会把没渲染的渲染掉），再删目录，否则后台渲染会和删除撞上
    await tmp.cleanup()
  })

  it('任务、计划、记录、设置这些通道串起来走一遍', async () => {
    const { ipc, session } = setup()
    const tmp = await makeTempDir()
    await session.initialize(tmp.dir, 'coach')
    type Ok<T> = { ok: true; data: T }
    const data = async <T>(channel: string, request?: unknown): Promise<T> => {
      const result = await ipc.call(channel, request)
      if (!result.ok) throw new Error(`${channel} 失败：${result.error}`)
      return result.data as T
    }

    const task = await data<{ id: string; title: string }>('tasks:add', { title: '写周报', addToToday: true })
    await data('plan:energy', { energy: 'mid' })
    await data('plan:review', { done: '写完了', learned: '无', change: '早睡' })
    await data('weight:add', { kg: 76.4 })
    await data('workout:add', { summary: '跑步', durationMin: 30 })
    await data('settings:update', { weights: { review: 3 } })
    await data('tasks:status', { id: task.id, status: 'done' })

    const today = await data<{ planTasks: Array<{ status: string }>; plan: { energy: string } }>('today:get')
    expect(today.planTasks[0]?.status).toBe('done')
    expect(today.plan.energy).toBe('mid')
    expect((await data<{ tasks: unknown[] }>('tasks:get')).tasks).toHaveLength(1)
    expect((await data<{ weights: unknown[] }>('records:get')).weights).toHaveLength(1)
    expect((await data<{ settings: { heatmap: { weights: { review: number } } } }>('settings:get')).settings.heatmap.weights.review).toBe(3)
    expect(await data<unknown[]>('data:health')).toEqual([])
    expect((await data<{ score: number }>('day:get', { date: '2026-10-23' })).score).toBeGreaterThan(0)
    await session.close()
    await tmp.cleanup()
  })

  it('新通道的参数不对时一律 bad-request', async () => {
    const { ipc, session } = setup()
    const tmp = await makeTempDir()
    await session.initialize(tmp.dir, 'coach')
    for (const [channel, request] of [
      ['plan:energy', { energy: '超级满电' }],
      ['plan:timeline', { items: [{ start: '9:00' }] }],
      ['tasks:add', { title: 123 }],
      ['tasks:status', { id: 'x', status: '完成' }],
      ['weight:add', { kg: -5 }],
      ['workout:add', { summary: '', durationMin: null }],
      ['settings:update', { dayStartsAt: '5点' }],
      ['day:get', { date: '昨天' }],
    ] as const) {
      expect(await ipc.call(channel, request), channel).toMatchObject({ ok: false, code: 'bad-request' })
    }
    await session.close()
    await tmp.cleanup()
  })
})
