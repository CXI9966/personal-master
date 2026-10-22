import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createAiService, type AiService } from '../../../src/main/ai/service'
import { weeklyReportContext } from '../../../src/main/ai/weeklyComment'
import { buildWeeklyReports } from '../../../src/main/app/weekly'
import type { ModelConfig } from '../../../src/shared/ai'
import { PATHS } from '../../../src/shared/paths'
import { Checkin, UsageEntry } from '../../../src/shared/schema'
import type { WeeklyReportView } from '../../../src/shared/views'
import { memorySecrets, newTestId, openTestSession, useShanghaiTimezone } from '../app/helpers'
import { startMockServer, type MockServer } from './mockServer'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

let server: MockServer
beforeAll(async () => {
  server = await startMockServer()
})
afterAll(async () => {
  await server.close()
})

let test: Awaited<ReturnType<typeof openTestSession>>
let ai: AiService
const provider = (): ModelConfig => ({ kind: 'openai-compatible', baseURL: server.baseURL, model: 'test-model' })

beforeEach(async () => {
  server.reset()
  test = await openTestSession()
  ai = createAiService({ session: test.session, secrets: memorySecrets(), platform: test.platform, encryptionAvailable: () => true, newId: newTestId })
})
afterEach(async () => {
  await test.cleanup()
})
const ctx = () => test.session.ctx()
const configure = (): Promise<void> => ai.saveConfig({ provider: provider(), contextStrategy: 'scene', actionMode: 'tools', apiKey: 'sk-test' })
const lastWeekHasRecords = (): Promise<void> =>
  ctx().ws.appendLine(PATHS.checkins, { id: newTestId(), type: 'wake', at: '2026-10-13T07:00:00+08:00', source: 'phone' }, Checkin)
const commentOfLastWeek = async (): Promise<string | undefined> => (await buildWeeklyReports(ctx()))[0]?.comment?.text

describe('weeklyReportContext', () => {
  it('只有这一周：周的范围、做到的事、每天一行（没记录的写“无记录”）', () => {
    const view: WeeklyReportView = {
      weekKey: '2026-W42',
      weekStart: '2026-10-12',
      weekEnd: '2026-10-18',
      lines: ['起床打卡 1/7 天，平均 07:00'],
      rows: [
        { date: '2026-10-12', wake: '07:00', sleep: null, tasksDone: 2, score: 3 },
        { date: '2026-10-13', wake: null, sleep: null, tasksDone: 0, score: 0 },
      ],
      usage: { weekKey: '2026-W42', weekStart: '2026-10-12', weekEnd: '2026-10-18', total: { calls: 0, inputTokens: 0, outputTokens: 0 }, byFeature: {}, byDay: [], callsWithoutTokens: 0 },
      comment: null,
    }
    const text = weeklyReportContext(view)
    expect(text).toContain('2026-W42（2026-10-12 ~ 2026-10-18）')
    expect(text).toContain('- 起床打卡 1/7 天，平均 07:00')
    expect(text).toContain('- 10-12 周一：起床 07:00，睡前 无记录，完成任务 2 个，得分 3')
    expect(text).toContain('- 10-13 周二：起床 无记录，睡前 无记录，完成任务 0 个，得分 0')
  })
})

describe('commentWeek：让管家点评一周', () => {
  it('点评存下来；用已保存的人格；不带工具；用量记在“周报点评”名下', async () => {
    await configure()
    await lastWeekHasRecords()
    await ctx().ws.writeText(PATHS.persona, '# 管家人格\n## 说话风格\n叫我船长\n')
    server.queue({ kind: 'text', text: '  这周起得很稳，下周继续。  ', usage: { input: 321, output: 45 } })

    expect(await ai.commentWeek('2026-10-12')).toEqual({ text: '这周起得很稳，下周继续。' })
    expect(await commentOfLastWeek()).toBe('这周起得很稳，下周继续。')

    expect(server.requests).toHaveLength(1)
    const request = server.requests[0]!
    expect(request.body.tools).toBeUndefined()
    const prompt = JSON.stringify(request.body.messages)
    expect(prompt).toContain('叫我船长')
    expect(prompt).toContain('2026-W42（2026-10-12 ~ 2026-10-18）')
    expect(prompt).toContain('100 到 200 字')
    expect(request.headers.authorization).toBe('Bearer sk-test')

    const usage = (await ctx().ws.readLines(PATHS.usage, UsageEntry)).items
    expect(usage).toMatchObject([{ feature: 'weekly', model: 'test-model', inputTokens: 321, outputTokens: 45 }])
  })

  it('同一周再点评一次：新的盖过旧的', async () => {
    await configure()
    await lastWeekHasRecords()
    server.queue({ kind: 'text', text: '第一次' }, { kind: 'text', text: '第二次' })
    await ai.commentWeek('2026-10-12')
    await ai.commentWeek('2026-10-12')
    expect(await commentOfLastWeek()).toBe('第二次')
  })

  it('这一周还没结束或者没有记录：直接说明，不发请求', async () => {
    await configure()
    await lastWeekHasRecords()
    await expect(ai.commentWeek('2026-10-19')).rejects.toThrow(/还没有可以点评的周报/)
    await expect(ai.commentWeek('2026-09-28')).rejects.toThrow(/还没有可以点评的周报/)
    expect(server.requests).toHaveLength(0)
  })

  it('模型没配置好：说缺什么，不发请求', async () => {
    await lastWeekHasRecords()
    await expect(ai.commentWeek('2026-10-12')).rejects.toThrow(/缺 接口地址、模型名、API key/)
    expect(server.requests).toHaveLength(0)
  })

  it('接口报错：给能看懂的原因，什么也不保存，也不记用量', async () => {
    await configure()
    await lastWeekHasRecords()
    server.queue({ kind: 'error', status: 401 })
    await expect(ai.commentWeek('2026-10-12')).rejects.toThrow(/接口拒绝了密钥（401）/)
    expect(await commentOfLastWeek()).toBeUndefined()
    expect((await ctx().ws.readLines(PATHS.usage, UsageEntry)).items).toHaveLength(0)
  })

  it('模型回了空白：提示再试一次，不保存空点评', async () => {
    await configure()
    await lastWeekHasRecords()
    server.queue({ kind: 'text', text: '   ' })
    await expect(ai.commentWeek('2026-10-12')).rejects.toThrow(/没有回复内容/)
    expect(await commentOfLastWeek()).toBeUndefined()
  })
})
