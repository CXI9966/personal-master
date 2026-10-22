import { expect, test } from '@playwright/test'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { completeFirstRun, launchButler, localLogicalToday, makeTempDir } from './helpers'

test('一天的使用：打卡、任务、复盘、撤销，视图文件跟上，外部改文件能刷新，重启后数据还在', async () => {
  test.setTimeout(120_000)
  const userData = makeTempDir('butler-e2e-user-')
  const workspace = makeTempDir('butler-e2e-ws-')
  const root = join(workspace.dir, '我的 Butler')
  const env = { BUTLER_DEFAULT_WORKSPACE: root }
  const today = localLogicalToday()
  const readView = (rel: string): string => readFileSync(join(root, rel), 'utf8')

  const first = await launchButler({ userData: userData.dir, env })
  const problems: string[] = []
  first.window.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  first.window.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })
  try {
    const { window } = first
    const nav = window.getByRole('navigation', { name: '主导航' })

    await test.step('第一次运行', async () => {
      await completeFirstRun(window)
      await expect(window.getByText(`${today}`, { exact: false }).first()).toBeVisible()
      await expect(window.getByText('今天还没有打卡')).toBeVisible()
    })

    await test.step('打卡 → 显示时间', async () => {
      await window.getByRole('button', { name: '起床打卡' }).click()
      await expect(window.getByText(/起床 \d{2}:\d{2}（电脑）/)).toBeVisible()
    })

    await test.step('新建任务并加入今天，勾选完成', async () => {
      await window.getByLabel('新任务标题').fill('写周报')
      await window.getByRole('button', { name: '新建并加入今天' }).click()
      const box = window.getByRole('checkbox', { name: '写周报' })
      await expect(box).toBeVisible()
      await box.check()
      await expect(box).toBeChecked()
    })

    await test.step('热力图：今天的格子有了分数（打卡 1 + 完成任务 1）', async () => {
      await expect(window.getByRole('button', { name: new RegExp(`^${today} 周.，2 分$`) })).toBeVisible()
    })

    await test.step('复盘', async () => {
      await window.getByLabel('完成了什么').fill('写完了周报')
      await window.getByLabel('学会了什么').fill('堵转电流')
      await window.getByLabel('明天改什么').fill('早点开始')
      await window.getByRole('button', { name: '保存复盘' }).click()
      await expect(window.getByText(/已保存（\d{2}:\d{2}）/)).toBeVisible()
    })

    await test.step('记体重，在记录页看到；撤销后消失', async () => {
      await nav.getByRole('button', { name: '记录' }).click()
      await window.getByLabel('体重（公斤）').fill('76.4')
      await window.getByRole('button', { name: '记体重' }).click()
      const table = window.getByRole('table', { name: '体重记录' })
      await expect(table.getByRole('cell', { name: '76.4' })).toBeVisible()
      await expect(window.getByText('最近一次改动：记体重')).toBeVisible()
      await window.getByRole('button', { name: '撤销' }).click()
      await expect(window.getByText('还没有体重记录')).toBeVisible()
    })

    await test.step('视图文件：过一会儿自动生成，内容对得上', async () => {
      await expect
        .poll(() => readView('今日.md'), { timeout: 10_000 })
        .toMatch(new RegExp(`# 今日 · ${today}[\\s\\S]*起床：\\d{2}:\\d{2}（电脑）[\\s\\S]*- \\[x\\] 写周报[\\s\\S]*完成了什么：写完了周报`))
      expect(readView('记录/打卡.md')).toContain(`| ${today} |`)
      expect(readView('任务库/收集箱.md')).toContain('- [x] 写周报')
      expect(readView('今日.md')).not.toMatch(/缺勤|断网/)
    })

    await test.step('外部程序在 data/ 里追加一条体重，界面自动刷新', async () => {
      await window.waitForTimeout(1500) // 过了应用自己写文件的忽略窗口
      const line = JSON.stringify({ id: '11111111-1111-4111-8111-111111111111', at: `${today}T07:30:00+08:00`, kg: 75.5 })
      appendFileSync(join(root, 'data', 'weight.jsonl'), `${line}\n`, 'utf8')
      await expect(window.getByRole('table', { name: '体重记录' }).getByRole('cell', { name: '75.5' })).toBeVisible({ timeout: 8000 })
    })

    expect(problems).toEqual([])
  } finally {
    await first.app.close()
  }

  const second = await launchButler({ userData: userData.dir, env })
  try {
    const { window } = second
    await expect(window.getByRole('heading', { name: '今日', exact: true })).toBeVisible()
    await expect(window.getByText(/起床 \d{2}:\d{2}（电脑）/)).toBeVisible()
    await expect(window.getByRole('checkbox', { name: '写周报' })).toBeChecked()
    await expect(window.getByLabel('完成了什么')).toHaveValue('写完了周报')
  } finally {
    await second.app.close()
    userData.remove()
    workspace.remove()
  }
})
