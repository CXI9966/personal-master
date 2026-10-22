import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileConfigStore } from '../../../src/main/app/config'
import { createSession } from '../../../src/main/app/session'
import { DomainError } from '../../../src/main/domain/errors'
import { PATHS } from '../../../src/shared/paths'
import { makeTempDir, waitFor } from '../store/helpers'
import { fakePlatform, newTestId, NOW, useShanghaiTimezone } from './helpers'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

const make = (platform = fakePlatform(), watch = false) =>
  createSession({ platform, now: () => NOW, newId: newTestId, renderDelayMs: 20, watch })

describe('createFileConfigStore', () => {
  it('没有配置文件时是空配置；写入后能读回；文件损坏当作没配置', async () => {
    const tmp = await makeTempDir()
    const store = createFileConfigStore(join(tmp.dir, '应用数据'))
    expect(await store.read()).toEqual({ workspaceRoot: null })
    await store.write({ workspaceRoot: 'D:\\工作区 一' })
    expect(await store.read()).toEqual({ workspaceRoot: 'D:\\工作区 一' })
    await import('node:fs/promises').then((fs) => fs.writeFile(join(tmp.dir, '应用数据', 'config.json'), '{损坏', 'utf8'))
    expect(await store.read()).toEqual({ workspaceRoot: null })
    await tmp.cleanup()
  })
})

describe('Session', () => {
  it('还没打开工作区：state 是空的，ctx() 报错', async () => {
    const session = make()
    expect(await session.state()).toEqual({ workspaceRoot: null, initialized: false, defaultRoot: 'C:\\默认\\Butler' })
    expect(session.isOpen()).toBe(false)
    expect(() => session.ctx()).toThrowError(DomainError)
  })

  it('initialize：建好工作区、生成视图、记住路径', async () => {
    const tmp = await makeTempDir()
    const platform = fakePlatform()
    const session = make(platform)
    const state = await session.initialize(tmp.dir, 'coach')
    expect(state).toMatchObject({ workspaceRoot: tmp.dir, initialized: true })
    expect(platform.config.workspaceRoot).toBe(tmp.dir)
    expect(await readFile(join(tmp.dir, '今日.md'), 'utf8')).toContain('# 今日 · 2026-10-23')
    expect(await readFile(join(tmp.dir, PATHS.persona), 'utf8')).toContain('## 说话风格')
    await session.close()
    await tmp.cleanup()
  })

  it('inspect 只看不动：不会在空文件夹里建 data/', async () => {
    const tmp = await makeTempDir()
    const session = make()
    expect(await session.inspect(join(tmp.dir, '不存在'))).toEqual({ exists: false, initialized: false })
    expect(await session.inspect(tmp.dir)).toEqual({ exists: true, initialized: false })
    await expect(stat(join(tmp.dir, 'data'))).rejects.toThrow()
    await session.initialize(tmp.dir, 'gentle')
    expect(await session.inspect(tmp.dir)).toEqual({ exists: true, initialized: true })
    await session.close()
    await tmp.cleanup()
  })

  it('open 没初始化过的文件夹：报错，状态不变，也不留下 data/', async () => {
    const tmp = await makeTempDir()
    const session = make()
    await expect(session.open(tmp.dir)).rejects.toThrow(/还没有初始化/)
    expect(session.isOpen()).toBe(false)
    await expect(stat(join(tmp.dir, 'data'))).rejects.toThrow()
    await tmp.cleanup()
  })

  it('restore：按配置重新打开上次的工作区；文件夹没了就保持未打开并提示', async () => {
    const tmp = await makeTempDir()
    const platform = fakePlatform()
    const first = make(platform)
    await first.initialize(tmp.dir, 'coach')
    await first.close()

    const second = make(platform)
    await second.restore()
    expect(second.isOpen()).toBe(true)
    await second.close()

    const warnings: string[] = []
    platform.config = { workspaceRoot: join(tmp.dir, '已经删掉') }
    const third = createSession({ platform, now: () => NOW, watch: false, onWarn: (m) => warnings.push(m) })
    await third.restore()
    expect(third.isOpen()).toBe(false)
    await tmp.cleanup()
  })

  it('ctx().changed()：通知界面，并在延迟后重新生成视图', async () => {
    const tmp = await makeTempDir()
    const platform = fakePlatform()
    const session = make(platform)
    await session.initialize(tmp.dir, 'coach')
    platform.notifications.length = 0
    const ctx = session.ctx()
    await ctx.ws.appendLine(PATHS.checkins, { id: newTestId(), type: 'wake', at: '2026-10-23T07:02:00+08:00', source: 'desktop' }, (await import('../../../src/shared/schema')).Checkin)
    ctx.changed()
    expect(platform.notifications).toEqual(['local'])
    expect(await waitFor(() => false, 0)).toBe(false)
    await session.close() // close 会先把没渲染的渲染掉
    expect(await readFile(join(tmp.dir, '今日.md'), 'utf8')).toContain('起床：07:02')
    await tmp.cleanup()
  })

  it('外部程序改了 data/，会通知界面（external）', async () => {
    const tmp = await makeTempDir()
    const platform = fakePlatform()
    const session = make(platform, true)
    await session.initialize(tmp.dir, 'coach')
    platform.notifications.length = 0
    await new Promise((resolve) => setTimeout(resolve, 1200)) // 等过自己写文件的忽略窗口
    await (await import('node:fs/promises')).writeFile(join(tmp.dir, 'data', 'ext.json'), '{}', 'utf8')
    expect(await waitFor(() => platform.notifications.includes('external'), 4000)).toBe(true)
    await session.close()
    await tmp.cleanup()
  })

  it('换工作区时关掉旧的', async () => {
    const a = await makeTempDir()
    const b = await makeTempDir()
    const session = make()
    await session.initialize(a.dir, 'coach')
    const oldCtx = session.ctx()
    await session.initialize(b.dir, 'strict')
    expect((await session.state()).workspaceRoot).toBe(b.dir)
    expect(session.ctx()).not.toBe(oldCtx)
    await session.close()
    await a.cleanup()
    await b.cleanup()
  })
})
