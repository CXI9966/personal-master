import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { completeFirstRun, launchButler, makeTempDir } from './helpers'

// 只测“装好的版本”：先用安装包装好，再
//   BUTLER_INSTALLED_EXE=<装好的 Butler.exe> npx playwright test tests/e2e/installed.spec.ts
// 平时跑 npm run test:e2e 时没有这个变量，整个文件跳过。
const exe = process.env.BUTLER_INSTALLED_EXE
test.skip(!exe, '设置 BUTLER_INSTALLED_EXE 才测装好的版本')

const RUN_KEY = ['HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Run'].join(String.fromCharCode(92))
const runValues = (): string => {
  try {
    return execFileSync('reg', ['query', RUN_KEY], { encoding: 'utf8' })
  } catch {
    return ''
  }
}
const ourRunLines = (): string[] => runValues().split(/\r?\n/).filter((line) => line.toLowerCase().includes('butler'))

test('装好的版本：第一次运行、打卡、重启后数据还在；开机自启能开能关', async () => {
  test.setTimeout(120_000)
  const userData = makeTempDir('butler-inst-user-')
  // BUTLER_INSTALLED_KEEP=<文件夹>：工作区建在那里、测完不删，用来验证“卸载后工作区还在”
  const keep = process.env.BUTLER_INSTALLED_KEEP
  if (keep) mkdirSync(keep, { recursive: true })
  const workspace = keep ? { dir: keep, remove: () => undefined } : makeTempDir('butler-inst-ws-')
  const root = join(workspace.dir, '我的 Butler')
  const env = { BUTLER_DEFAULT_WORKSPACE: root }
  const before = ourRunLines()
  let app = await launchButler({ executablePath: exe!, userData: userData.dir, env })
  const problems: string[] = []
  const watch = (window: typeof app.window): void => {
    window.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
    window.on('console', (message) => message.type() === 'error' && problems.push(`console: ${message.text()}`))
  }
  watch(app.window)

  try {
    let window = app.window
    const nav = () => window.getByRole('navigation', { name: '主导航' })

    await test.step('确实是装好的（打包）版本', async () => {
      expect(await app.app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true)
    })

    await test.step('第一次运行 → 起床打卡', async () => {
      await completeFirstRun(window)
      await window.getByRole('button', { name: '起床打卡' }).click()
      await expect(window.getByText(/起床 \d{2}:\d{2}（电脑）/)).toBeVisible()
      expect(readFileSync(join(root, 'data', 'checkins.jsonl'), 'utf8').trim().split('\n')).toHaveLength(1)
    })

    await test.step('重启后数据还在，直接进主界面', async () => {
      await app.cleanup()
      app = await launchButler({ executablePath: exe!, userData: userData.dir, env })
      watch(app.window)
      window = app.window
      await expect(window.getByRole('heading', { name: '今日', exact: true })).toBeVisible()
      await expect(window.getByText(/起床 \d{2}:\d{2}（电脑）/)).toBeVisible()
      expect(existsSync(join(root, '今日.md'))).toBe(true)
    })

    await test.step('开机自启：打开 → 启动项里有 Butler（带 --hidden）→ 关掉 → 没了', async () => {
      await nav().getByRole('button', { name: '设置' }).click()
      const box = window.getByRole('region', { name: '开机自启' }).getByRole('checkbox')
      await expect(box).toBeVisible()
      await box.check()
      await expect(box).toBeChecked()
      await expect.poll(() => ourRunLines().join('\n')).toMatch(/--hidden/)
      expect(ourRunLines().join('\n').toLowerCase()).toContain('butler.exe')
      await box.uncheck()
      await expect(box).not.toBeChecked()
      await expect.poll(() => ourRunLines().length).toBe(before.length)
    })

    expect(problems).toEqual([])
  } finally {
    await app.cleanup().catch(() => undefined)
    // 万一中途失败：把这次测试加上的启动项删掉，不能留在用户的电脑上
    const leftover = ourRunLines().filter((line) => !before.includes(line))
    for (const line of leftover) {
      const name = line.trim().split(/\s{2,}/)[0]
      if (name) execFileSync('reg', ['delete', RUN_KEY, '/v', name, '/f'])
    }
    workspace.remove()
    userData.remove()
  }
})
