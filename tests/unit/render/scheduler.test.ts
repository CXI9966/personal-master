import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { initWorkspace } from '../../../src/main/init/firstRun'
import { createRenderScheduler } from '../../../src/main/render/scheduler'
import { openWorkspace, type Workspace } from '../../../src/main/store/workspace'
import { PATHS } from '../../../src/shared/paths'
import { Checkin } from '../../../src/shared/schema'
import { makeTempDir, sleep, waitFor } from '../store/helpers'

const NOW = new Date('2026-10-23T12:00:00+08:00')
let ctx: Awaited<ReturnType<typeof makeTempDir>>
let ws: Workspace
let tz: string | undefined
beforeEach(async () => {
  tz = process.env.TZ
  process.env.TZ = 'Asia/Shanghai'
  ctx = await makeTempDir()
  ws = await openWorkspace(ctx.dir, { watch: false })
  await initWorkspace(ws, { persona: 'coach', now: NOW })
})
afterEach(async () => {
  await ws.close()
  await ctx.cleanup()
  if (tz === undefined) delete process.env.TZ
  else process.env.TZ = tz
})

const addWake = (n: number): Promise<void> =>
  ws.appendLine(PATHS.checkins, { id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, type: 'wake', at: '2026-10-23T07:02:00+08:00', source: 'desktop' }, Checkin)

describe('createRenderScheduler', () => {
  it('短时间内多次 schedule 只渲染一次，且在最后一次之后才渲染', async () => {
    let renders = 0
    const scheduler = createRenderScheduler(ws, { delayMs: 60, now: () => NOW, onWarnings: () => renders++ })
    await addWake(1)
    scheduler.schedule()
    await sleep(30)
    scheduler.schedule()
    await sleep(30)
    expect(renders).toBe(0) // 距离最后一次 schedule 还不到 60ms
    expect(await waitFor(() => renders === 1, 5000)).toBe(true)
    await sleep(150) // 再等一会儿，确认没有第二次渲染
    expect(renders).toBe(1)
    expect(await readFile(join(ctx.dir, '今日.md'), 'utf8')).toContain('起床：07:02')
    scheduler.dispose()
  })

  it('flush 立刻渲染', async () => {
    const scheduler = createRenderScheduler(ws, { delayMs: 10_000, now: () => NOW })
    await addWake(1)
    scheduler.schedule()
    await scheduler.flush()
    expect(await readFile(join(ctx.dir, '今日.md'), 'utf8')).toContain('起床：07:02')
    scheduler.dispose()
  })

  it('没有待渲染的内容时 flush 什么也不做', async () => {
    let renders = 0
    const scheduler = createRenderScheduler(ws, { now: () => NOW, onWarnings: () => renders++ })
    await scheduler.flush()
    expect(renders).toBe(0)
    scheduler.dispose()
  })

  it('渲染出错交给 onError，不会抛出来；dispose 之后不再渲染', async () => {
    const errors: unknown[] = []
    const scheduler = createRenderScheduler(ws, { delayMs: 10, now: () => NOW, onError: (e) => errors.push(e) })
    await ws.writeText(PATHS.settings, '{损坏')
    scheduler.schedule()
    await scheduler.flush()
    expect(errors).toHaveLength(1)

    scheduler.dispose()
    scheduler.schedule()
    await sleep(50)
    expect(errors).toHaveLength(1)
  })
})
