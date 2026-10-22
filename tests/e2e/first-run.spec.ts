import { expect, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchButler, makeTempDir } from './helpers'

test('第一次运行：选文件夹、选人格，生成工作区；重启后直接进入主界面', async () => {
  const userData = makeTempDir('butler-e2e-user-')
  const workspace = makeTempDir('butler-e2e-ws-')
  const root = join(workspace.dir, '我的 Butler') // 带中文和空格，文件夹还不存在
  const env = { BUTLER_DEFAULT_WORKSPACE: root }

  const first = await launchButler({ userData: userData.dir, env })
  try {
    const { window } = first
    await expect(window.getByRole('heading', { name: '欢迎使用 Butler' })).toBeVisible()
    await expect(window.getByRole('textbox', { name: '工作区文件夹' })).toHaveValue(root)
    await window.getByRole('button', { name: '下一步' }).click()

    await expect(window.getByText('第 2 步，共 3 步')).toBeVisible()
    await expect(window.getByRole('radio', { name: /战友教练/ })).toBeChecked()
    await window.getByRole('radio', { name: /严格教官/ }).check()
    await window.getByRole('button', { name: '下一步' }).click()
    await expect(window.getByText('第 3 步，共 3 步')).toBeVisible()
    await window.getByRole('button', { name: '跳过，以后再填' }).click()

    await expect(window.getByRole('heading', { name: '今日', exact: true })).toBeVisible()
    await window.getByRole('navigation', { name: '主导航' }).getByRole('button', { name: '设置' }).click()
    await expect(window.getByText(root, { exact: true })).toBeVisible()
  } finally {
    await first.app.close()
  }

  // 工作区已经建好：数据文件、人格、生成的视图都在
  for (const rel of ['data/settings.json', 'data/profile.json', 'data/tasks.json', '管家人格.md', '课表.md', '今日.md', '本周.md', '我的设定.md']) {
    expect(existsSync(join(root, rel)), rel).toBe(true)
  }
  expect(readFileSync(join(root, '管家人格.md'), 'utf8')).toContain('必须脱稿') // 选的是严格教官
  expect(readFileSync(join(root, '今日.md'), 'utf8').split('\n')[0]).toContain('由 Butler 客户端根据 data/ 生成')

  // 重启：应用记住了工作区，不再显示第一次运行页
  const second = await launchButler({ userData: userData.dir, env })
  try {
    await expect(second.window.getByRole('heading', { name: '今日', exact: true })).toBeVisible()
    await expect(second.window.getByRole('heading', { name: '欢迎使用 Butler' })).toHaveCount(0)
  } finally {
    await second.app.close()
    userData.remove()
    workspace.remove()
  }
})
