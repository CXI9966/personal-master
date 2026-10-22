import { expect, test } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { startMockServer } from '../unit/ai/mockServer'
import { completeFirstRun, launchButler, makeTempDir } from './helpers'

const SECRET = 'sk-e2e-secret-9f8e7d'

/** 工作区里所有文件的路径（含 data/.history） */
function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? allFiles(full) : [full]
  })
}

test('管家：配置模型接口、对话、动作卡片（执行/撤销/确认）、人格、用量；key 不进工作区', async () => {
  test.setTimeout(150_000)
  const mock = await startMockServer()
  const userData = makeTempDir('butler-e2e-user-')
  const workspace = makeTempDir('butler-e2e-ws-')
  const root = join(workspace.dir, '我的 Butler')
  const app = await launchButler({ userData: userData.dir, env: { BUTLER_DEFAULT_WORKSPACE: root } })
  const problems: string[] = []
  app.window.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`))
  app.window.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`)
  })

  try {
    const { window } = app
    const nav = window.getByRole('navigation', { name: '主导航' })
    const modelSection = window.getByRole('region', { name: '管家的模型接口' })

    await test.step('第一次运行（跳过模型接口）', () => completeFirstRun(window))

    await test.step('没配置时管家页提示去设置', async () => {
      await nav.getByRole('button', { name: '管家' }).click()
      await expect(window.getByRole('region', { name: '还没有配置模型接口' })).toBeVisible()
      await window.getByRole('button', { name: '去设置' }).click()
      await expect(window.getByRole('heading', { name: '设置', exact: true })).toBeVisible()
    })

    await test.step('填模型接口 → 测试连接 → 保存', async () => {
      await modelSection.getByLabel('接口地址').fill(mock.baseURL)
      await modelSection.getByLabel('模型名').fill('test-model')
      await modelSection.getByLabel('API key').fill(SECRET)
      await modelSection.getByRole('button', { name: '测试连接' }).click()
      await expect(modelSection.getByRole('status')).toHaveText('连接成功，模型回复：好')
      expect(mock.requests[0]?.headers.authorization).toBe(`Bearer ${SECRET}`)
      await modelSection.getByRole('button', { name: '保存', exact: true }).click()
      await expect(modelSection.getByText('已经保存了一个 key。')).toBeVisible()
    })

    await test.step('小改动：管家加任务，卡片显示已执行，今日页里有这个任务', async () => {
      mock.queue({ kind: 'tools', text: '好的，我来加。', calls: [{ name: 'add_task', args: { title: '写周报', addToToday: true } }] })
      await nav.getByRole('button', { name: '管家' }).click()
      await expect(window.getByRole('region', { name: '还没有配置模型接口' })).toHaveCount(0)
      await window.getByLabel('给管家发消息').fill('加个任务：写周报')
      await window.getByRole('button', { name: '发送' }).click()
      const cards = window.getByRole('list', { name: '管家提出的动作' })
      await expect(window.getByText('好的，我来加。')).toBeVisible()
      await expect(cards.getByText('新建任务「写周报」，加入今天')).toBeVisible()
      await expect(cards.getByText('已执行')).toBeVisible()
      // 请求里有 12 个改数据的动作，没有查询工具
      const tools = mock.requests.at(-1)?.body.tools as unknown[]
      expect(tools).toHaveLength(12)

      await nav.getByRole('button', { name: '今日' }).click()
      await expect(window.getByRole('checkbox', { name: '写周报' })).toBeVisible()
    })

    await test.step('撤销：卡片变成已撤销，任务消失', async () => {
      await nav.getByRole('button', { name: '管家' }).click()
      await window.getByRole('button', { name: '撤销：新建任务「写周报」，加入今天' }).click()
      await expect(window.getByRole('list', { name: '管家提出的动作' }).getByText('已撤销')).toBeVisible()
      await nav.getByRole('button', { name: '今日' }).click()
      await expect(window.getByRole('checkbox', { name: '写周报' })).toHaveCount(0)
    })

    await test.step('大改动：先待确认，数据没变；点确认后才生效', async () => {
      const profilePath = join(root, 'data', 'profile.json')
      mock.queue({ kind: 'tools', text: '要把目标改成这样吗？', calls: [{ name: 'update_profile', args: { weightTargetKg: 70, gymDays: [1, 3, 5] } }] })
      await nav.getByRole('button', { name: '管家' }).click()
      await window.getByLabel('给管家发消息').fill('把我的目标体重设成 70，周一三五健身')
      await window.getByRole('button', { name: '发送' }).click()
      await expect(window.getByText('需要你确认')).toBeVisible()
      expect(JSON.parse(readFileSync(profilePath, 'utf8')).goals.weightTargetKg).toBeNull()

      await window.getByRole('button', { name: /^确认：/ }).click()
      await expect(window.getByRole('list', { name: '管家提出的动作' }).getByText('已执行').last()).toBeVisible()
      await expect.poll(() => JSON.parse(readFileSync(profilePath, 'utf8')).goals.weightTargetKg).toBe(70)
      expect(JSON.parse(readFileSync(profilePath, 'utf8')).schedule.gymDays).toEqual([1, 3, 5])
    })

    await test.step('改人格 → 保存 → 下一次对话的系统提示词里有它', async () => {
      await nav.getByRole('button', { name: '设置' }).click()
      const personaSection = window.getByRole('region', { name: '管家的人格' })
      await personaSection.getByLabel('说话风格').fill('叫我船长，说话简短。')
      await personaSection.getByRole('button', { name: '保存人格' }).click()
      await expect.poll(() => readFileSync(join(root, '管家人格.md'), 'utf8')).toContain('叫我船长')

      await nav.getByRole('button', { name: '管家' }).click()
      await window.getByLabel('给管家发消息').fill('你好')
      await window.getByRole('button', { name: '发送' }).click()
      await expect(window.getByRole('button', { name: '发送' })).toBeVisible() // 回复完了
      const system = JSON.stringify((mock.requests.at(-1)?.body.messages as unknown[])[0])
      expect(system).toContain('叫我船长')
    })

    await test.step('本周用量', async () => {
      await nav.getByRole('button', { name: '设置' }).click()
      const usage = window.getByRole('region', { name: '本周用量' })
      await expect(usage.getByText(/调用 \d+ 次/)).toBeVisible()
    })

    expect(problems).toEqual([])
  } finally {
    await app.app.close()
    await mock.close()
  }

  // API key 不在工作区的任何文件里，在应用数据目录里也不是明文
  for (const file of allFiles(root)) expect(readFileSync(file, 'utf8'), file).not.toContain(SECRET)
  const keyFile = join(userData.dir, 'secrets', 'model-key.secret')
  expect(existsSync(keyFile)).toBe(true)
  expect(readFileSync(keyFile, 'utf8')).not.toContain(SECRET)
  userData.remove()
  workspace.remove()
})
