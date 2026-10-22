import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatISO } from 'date-fns'
import { archiveDir, isoWeekOf, shiftDate, startOfWeek } from '../../src/shared/calendar'
import { startMockServer } from '../unit/ai/mockServer'
import { completeFirstRun, launchButler, localLogicalToday, makeTempDir } from './helpers'

/** 上一周的周一，用本机日历（和应用的“今天”同一套规则） */
const lastMonday = (): string => shiftDate(startOfWeek(localLogicalToday()), -7)

/** 上周一早上 7 点的起床打卡，格式和应用自己写的一样（带本机时区偏移） */
function lastWeekWakeLine(monday: string): string {
  const [y, m, d] = monday.split('-').map(Number) as [number, number, number]
  const at = formatISO(new Date(y, m - 1, d, 7, 0, 0))
  return `${JSON.stringify({ id: randomUUID(), type: 'wake', at, source: 'phone' })}\n`
}

test('周报：上周有记录就出现；让管家点评；点评存下来、写进周报.md、重启后还在', async () => {
  test.setTimeout(150_000)
  const mock = await startMockServer()
  const userData = makeTempDir('butler-e2e-user-')
  const workspace = makeTempDir('butler-e2e-ws-')
  const root = join(workspace.dir, '我的 Butler')
  const monday = lastMonday()
  const weekKey = isoWeekOf(monday).key
  const reportFile = join(root, archiveDir(monday), '周报.md')
  let app = await launchButler({ userData: userData.dir, env: { BUTLER_DEFAULT_WORKSPACE: root } })
  const problems: string[] = []
  const watch = (window: typeof app.window): void => {
    window.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
    window.on('console', (message) => message.type() === 'error' && problems.push(`console: ${message.text()}`))
  }
  watch(app.window)

  try {
    let window = app.window
    const nav = () => window.getByRole('navigation', { name: '主导航' })
    const weekly = () => window.getByRole('region', { name: '周报' })

    await test.step('第一次运行；还没有记录，周报里说明什么时候会有', async () => {
      await completeFirstRun(window)
      await nav().getByRole('button', { name: '记录' }).click()
      await expect(weekly().getByText(/还没有周报/)).toBeVisible()
    })

    await test.step('上周的记录出现在数据里（模拟手机同步或手动补记）：周报自己冒出来', async () => {
      appendFileSync(join(root, 'data', 'checkins.jsonl'), lastWeekWakeLine(monday), 'utf8')
      await expect(weekly().getByText(new RegExp(weekKey))).toBeVisible()
      await expect(weekly().getByText(/起床打卡 1\/7 天，平均 07:00/)).toBeVisible()
      await expect(weekly().getByText(/这一周没有调用管家/)).toBeVisible()
    })

    await test.step('没配置模型就点评：给出缺什么，不崩', async () => {
      await weekly().getByRole('button', { name: '让管家点评' }).click()
      await expect(window.getByText(/缺 接口地址、模型名、API key/)).toBeVisible()
    })

    await test.step('配好模型后点评：点评显示出来，用量记上一次', async () => {
      await nav().getByRole('button', { name: '设置' }).click()
      const model = window.getByRole('region', { name: '管家的模型接口' })
      await model.getByLabel('接口地址').fill(mock.baseURL)
      await model.getByLabel('模型名').fill('test-model')
      await model.getByLabel('API key').fill('sk-e2e-weekly')
      await model.getByRole('button', { name: '保存', exact: true }).click()
      await expect(model.getByText('已经保存了一个 key。')).toBeVisible()

      mock.queue({ kind: 'text', text: '这周起得很稳，下周继续。', usage: { input: 321, output: 45 } })
      await nav().getByRole('button', { name: '记录' }).click()
      await weekly().getByRole('button', { name: '让管家点评' }).click()
      await expect(weekly().getByText('这周起得很稳，下周继续。')).toBeVisible()
      await expect(weekly().getByRole('button', { name: '重新点评' })).toBeVisible()
      // 点评发生在本周，所以上一周的周报里管家用量仍是没有；这一次调用记在本周的用量里
      await expect(weekly().getByText(/这一周没有调用管家/)).toBeVisible()
      await nav().getByRole('button', { name: '设置' }).click()
      const usage = window.getByRole('region', { name: '本周用量' })
      await expect(usage.getByText(/调用 1 次，输入 321 token，输出 45 token/)).toBeVisible()
      await expect(usage.getByRole('table', { name: '本周管家用量，按功能' }).getByText('周报点评')).toBeVisible()
    })

    await test.step('周报.md 里有点评', async () => {
      const read = (): string => (existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : '')
      await expect.poll(read, { timeout: 8000 }).toContain('这周起得很稳，下周继续。')
      expect(readFileSync(reportFile, 'utf8')).toContain(`# 周报 · ${weekKey}`)
    })

    await test.step('重启后点评还在', async () => {
      await app.cleanup()
      app = await launchButler({ userData: userData.dir })
      watch(app.window)
      window = app.window
      await nav().getByRole('button', { name: '记录' }).click()
      await expect(weekly().getByText('这周起得很稳，下周继续。')).toBeVisible()
    })

    expect(problems).toEqual([])
  } finally {
    await app.cleanup().catch(() => undefined)
    await mock.close()
    workspace.remove()
    userData.remove()
  }
})
