import { expect, test } from '@playwright/test'
import { launchButler, makeTempDir } from './helpers'

test('启动构建产物：没有工作区时显示第一次运行页，界面拿不到 Node 能力', async () => {
  const workspace = makeTempDir('butler-e2e-ws-')
  const { app, window, cleanup } = await launchButler({ env: { BUTLER_DEFAULT_WORKSPACE: workspace.dir } })
  try {
    await expect(window.getByRole('heading', { name: '欢迎使用 Butler' })).toBeVisible()
    expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(false)

    // 沙箱 + 上下文隔离：页面里没有 require / process，只有 preload 暴露的 butler
    const exposed = await window.evaluate(() => {
      const w = globalThis as unknown as { require?: unknown; process?: unknown; butler: object }
      return { require: typeof w.require, process: typeof w.process, butler: Object.keys(w.butler).sort() }
    })
    expect(exposed).toEqual({ require: 'undefined', process: 'undefined', butler: ['invoke', 'on'] })
  } finally {
    await cleanup()
    workspace.remove()
  }
})
