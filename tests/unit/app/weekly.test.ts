import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildWeeklyReports, saveWeeklyComment } from '../../../src/main/app/weekly'
import { PATHS } from '../../../src/shared/paths'
import { Checkin } from '../../../src/shared/schema'
import { newTestId, openTestSession, useShanghaiTimezone } from './helpers'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

let test: Awaited<ReturnType<typeof openTestSession>>
beforeEach(async () => {
  test = await openTestSession()
})
afterEach(async () => {
  await test.cleanup()
})
const ctx = () => test.session.ctx()

const wake = (at: string): Promise<void> => ctx().ws.appendLine(PATHS.checkins, { id: newTestId(), type: 'wake', at, source: 'phone' }, Checkin)

describe('buildWeeklyReports', () => {
  it('刚开始用：没有周报', async () => {
    expect(await buildWeeklyReports(ctx())).toEqual([])
  })

  it('上周有记录就有周报，本周的不算', async () => {
    await wake('2026-10-13T07:00:00+08:00')
    await wake('2026-10-21T07:00:00+08:00')
    const reports = await buildWeeklyReports(ctx())
    expect(reports.map((r) => r.weekKey)).toEqual(['2026-W42'])
  })
})

describe('saveWeeklyComment', () => {
  it('点评存进数据里，作为一次可撤销的改动，并通知界面刷新', async () => {
    await wake('2026-10-13T07:00:00+08:00')
    test.platform.notifications.length = 0
    await saveWeeklyComment(ctx(), '2026-10-12', '  这周很稳。  ')
    expect((await buildWeeklyReports(ctx()))[0]!.comment?.text).toBe('这周很稳。')
    expect(test.platform.notifications).toContain('local')
    expect(ctx().ws.lastChange()?.label).toBe('保存周报点评')

    expect(await ctx().ws.undo(ctx().ws.lastChange()!.id)).toBe(true)
    expect((await buildWeeklyReports(ctx()))[0]!.comment).toBeNull()
  })

  it('同一周再点评：新的盖过旧的', async () => {
    await wake('2026-10-13T07:00:00+08:00')
    await saveWeeklyComment(ctx(), '2026-10-12', '第一次')
    await saveWeeklyComment(ctx(), '2026-10-12', '第二次')
    expect((await buildWeeklyReports(ctx()))[0]!.comment?.text).toBe('第二次')
  })
})
