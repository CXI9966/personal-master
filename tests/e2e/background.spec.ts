import { expect, test } from '@playwright/test'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { completeFirstRun, launchButler, localLogicalToday, makeTempDir } from './helpers'

test('提醒：到点弹一次、记账、重启后同一天不再弹；开发模式下开机自启不可设', async () => {
  test.setTimeout(120_000)
  const userData = makeTempDir('butler-e2e-user-')
  const workspace = makeTempDir('butler-e2e-ws-')
  const root = join(workspace.dir, '我的 Butler')
  const env = { BUTLER_DEFAULT_WORKSPACE: root, BUTLER_TICK_MS: '300' }
  const ledgerFile = join(userData.dir, 'reminders-sent.json')
  let app = await launchButler({ userData: userData.dir, env })

  try {
    let window = app.window
    const nav = () => window.getByRole('navigation', { name: '主导航' })

    await test.step('第一次运行；默认不开提醒，等一会儿也不会有记账', async () => {
      await completeFirstRun(window)
      await window.waitForTimeout(1200)
      expect(existsSync(ledgerFile)).toBe(false)
    })

    await test.step('设置里开提醒；一天从 04:00 算起，把排计划的时间设成 04:00，一定已经到点', async () => {
      await nav().getByRole('button', { name: '设置' }).click()
      const reminders = window.getByRole('region', { name: '提醒' })
      await reminders.getByLabel('开启提醒').check()
      await reminders.getByLabel('今天还没排计划时，提醒的时间').fill('04:00')
      await reminders.getByRole('button', { name: '保存提醒' }).click()
      await expect.poll(() => existsSync(ledgerFile), { timeout: 10_000 }).toBe(true)
      expect(JSON.parse(readFileSync(ledgerFile, 'utf8'))).toEqual({ date: localLogicalToday(), sent: ['plan'] })
    })

    await test.step('同一天不会重复提醒（记账文件之后不再被改写）', async () => {
      const before = statSync(ledgerFile).mtimeMs
      await window.waitForTimeout(1500)
      expect(statSync(ledgerFile).mtimeMs).toBe(before)
    })

    await test.step('重启应用：同一天仍然不弹；设置还在', async () => {
      await app.cleanup()
      app = await launchButler({ userData: userData.dir, env })
      window = app.window
      await window.waitForTimeout(1500)
      expect(JSON.parse(readFileSync(ledgerFile, 'utf8'))).toEqual({ date: localLogicalToday(), sent: ['plan'] })
      await nav().getByRole('button', { name: '设置' }).click()
      const reminders = window.getByRole('region', { name: '提醒' })
      await expect(reminders.getByLabel('开启提醒')).toBeChecked()
      await expect(reminders.getByLabel('今天还没排计划时，提醒的时间')).toHaveValue('04:00')
    })

    await test.step('开发模式不能设开机自启，页面上说清楚', async () => {
      const autostart = window.getByRole('region', { name: '开机自启' })
      await expect(autostart.getByText(/开发模式，不能设置开机自启/)).toBeVisible()
      await expect(autostart.getByRole('checkbox')).toHaveCount(0)
    })
  } finally {
    await app.cleanup().catch(() => undefined)
    workspace.remove()
    userData.remove()
  }
})

test('--hidden 启动（开机自启用的）不弹出窗口，只留在托盘；平时启动会弹出', async () => {
  test.setTimeout(90_000)
  const userData = makeTempDir('butler-e2e-user-')
  const visible = (app: Awaited<ReturnType<typeof launchButler>>): Promise<boolean[]> =>
    app.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.isVisible()))

  const hidden = await launchButler({ userData: userData.dir, args: ['--hidden'] })
  try {
    await hidden.window.getByRole('heading', { name: '欢迎使用 Butler' }).waitFor({ state: 'attached' })
    await hidden.window.waitForTimeout(1500) // 页面加载完才会触发 ready-to-show，给足时间
    expect(await visible(hidden)).toEqual([false])
  } finally {
    await hidden.cleanup().catch(() => undefined)
  }

  const normal = await launchButler({ userData: userData.dir })
  try {
    await expect.poll(() => visible(normal), { timeout: 10_000 }).toEqual([true])
  } finally {
    await normal.cleanup().catch(() => undefined)
    userData.remove()
  }
})
