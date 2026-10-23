import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { completeFirstRun, launchButler, makeTempDir } from './helpers'

test('任务页：改名、新建清单后，新建任务进的是页面上选着的清单；管家输入框切页面不丢字', async () => {
  test.setTimeout(90_000)
  const userData = makeTempDir('butler-e2e-user-')
  const workspace = makeTempDir('butler-e2e-ws-')
  const root = join(workspace.dir, '我的 Butler')
  const app = await launchButler({ userData: userData.dir, env: { BUTLER_DEFAULT_WORKSPACE: root } })
  const problems: string[] = []
  app.window.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  app.window.on('console', (message) => message.type() === 'error' && problems.push(`console: ${message.text()}`))
  const tasksFile = (): { lists: string[]; tasks: Array<{ title: string; list: string }> } =>
    JSON.parse(readFileSync(join(root, 'data', 'tasks.json'), 'utf8'))

  try {
    const { window } = app
    const nav = window.getByRole('navigation', { name: '主导航' })
    const form = window.getByRole('region', { name: '新建任务' })
    const select = form.getByLabel('清单')

    await completeFirstRun(window)
    await nav.getByRole('button', { name: '任务' }).click()

    await test.step('先写标题，再把“收集箱”改名：表单跟着改，任务进新名字，旧名字不会冒出来', async () => {
      await form.getByLabel('任务标题').fill('读书笔记')
      await window.getByRole('button', { name: '重命名清单：收集箱' }).click()
      await window.getByLabel('新的清单名').fill('学业任务')
      await window.getByRole('button', { name: '保存', exact: true }).click()
      await expect(window.getByRole('heading', { name: '学业任务' })).toBeVisible()
      await expect(select).toHaveValue('学业任务')
      await expect(form.getByLabel('任务标题')).toHaveValue('读书笔记')
      await form.getByRole('button', { name: '添加任务' }).click()
      await expect(window.getByRole('region', { name: '学业任务' }).getByText('读书笔记')).toBeVisible()
      await expect.poll(() => tasksFile().lists).toEqual(['学业任务'])
      expect(tasksFile().tasks).toMatchObject([{ title: '读书笔记', list: '学业任务' }])
    })

    await test.step('先写标题，再新建一个清单：表单选上新清单，任务进新清单', async () => {
      await form.getByLabel('任务标题').fill('做实验报告')
      await window.getByLabel('清单名').fill('项目')
      await window.getByRole('button', { name: '添加清单' }).click()
      await expect(window.getByRole('heading', { name: '项目' })).toBeVisible()
      await expect(select).toHaveValue('项目')
      await form.getByRole('button', { name: '添加任务' }).click()
      await expect(window.getByRole('region', { name: '项目' }).getByText('做实验报告')).toBeVisible()
      await expect.poll(() => tasksFile().tasks.map((t) => `${t.list}/${t.title}`)).toEqual(['学业任务/读书笔记', '项目/做实验报告'])
      expect(tasksFile().lists).toEqual(['学业任务', '项目'])
    })

    await test.step('管家输入框：写了一半切到别的页面，回来字还在', async () => {
      await nav.getByRole('button', { name: '管家' }).click()
      await window.getByLabel('给管家发消息').fill('明天下午想去健身房')
      await nav.getByRole('button', { name: '记录' }).click()
      await expect(window.getByRole('heading', { name: '记录', exact: true })).toBeVisible()
      await nav.getByRole('button', { name: '管家' }).click()
      await expect(window.getByLabel('给管家发消息')).toHaveValue('明天下午想去健身房')
    })

    expect(problems).toEqual([])
  } finally {
    await app.cleanup().catch(() => undefined)
    workspace.remove()
    userData.remove()
  }
})
