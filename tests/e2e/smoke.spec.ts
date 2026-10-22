import { expect, test } from '@playwright/test'
import { launchButler } from './helpers'

test('启动构建产物并显示主界面', async () => {
  const { app, window, cleanup } = await launchButler()
  try {
    await expect(window.getByRole('heading', { name: 'Butler' })).toBeVisible()
    const isPackaged = await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)
    expect(isPackaged).toBe(false)
  } finally {
    await cleanup()
  }
})
