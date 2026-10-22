import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSession, type Session } from '../../../src/main/app/session'
import type { ReminderLedger, ReminderState } from '../../../src/main/app/reminders'
import { updateReview, updateTimeline } from '../../../src/main/app/services-plan'
import { changeSettings } from '../../../src/main/app/services-records'
import { createTicker } from '../../../src/main/app/ticker'
import { makeTempDir, waitFor } from '../store/helpers'
import { fakePlatform, newTestId, useShanghaiTimezone, type FakePlatform } from './helpers'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

const at = (time: string, date = '2026-10-23'): Date => new Date(`${date}T${time}:00+08:00`)

function memoryLedger(): ReminderLedger & { state: ReminderState | null; failWrites: boolean } {
  const ledger = {
    state: null as ReminderState | null,
    failWrites: false,
    read: async () => ledger.state,
    write: async (state: ReminderState) => {
      if (ledger.failWrites) throw new Error('写不进去')
      ledger.state = state
    },
  }
  return ledger
}

let clock: { now: Date }
let platform: FakePlatform
let session: Session
let root: string
let cleanupDir: () => Promise<void>
let ledger: ReturnType<typeof memoryLedger>
let warnings: string[]

beforeEach(async () => {
  clock = { now: at('12:00') }
  const tmp = await makeTempDir()
  root = tmp.dir
  cleanupDir = tmp.cleanup
  platform = fakePlatform()
  session = createSession({ platform, now: () => clock.now, newId: newTestId, renderDelayMs: 20, watch: false })
  ledger = memoryLedger()
  warnings = []
})
afterEach(async () => {
  await session.close() // 先关会话再删目录，免得后台渲染和删除撞上
  await cleanupDir()
})

const ticker = () => createTicker({ session, platform, ledger, onWarn: (m) => warnings.push(m) })
const open = async (): Promise<void> => {
  await session.initialize(root, 'coach')
  platform.notifications.length = 0
}
const remind = (reminders: { enabled: boolean; plan: string | null; review: string | null }): Promise<void> =>
  changeSettings(session.ctx(), { reminders })

describe('打开工作区之后第一次检查', () => {
  it('还没打开工作区：什么也不做，也不报错', async () => {
    await ticker().tick()
    expect(platform.notifications).toEqual([])
    expect(warnings).toEqual([])
  })

  it('刚打开：重新生成一次视图并通知界面；同一天再检查就不再动', async () => {
    await open()
    const t = ticker()
    await t.tick()
    expect(platform.notifications).toEqual(['local'])
    await t.tick()
    await t.tick()
    expect(platform.notifications).toEqual(['local'])
  })

  it('换了一个工作区：再来一次', async () => {
    await open()
    const t = ticker()
    await t.tick()
    const other = await makeTempDir()
    try {
      await session.initialize(other.dir, 'gentle')
      platform.notifications.length = 0
      await t.tick()
      expect(platform.notifications).toEqual(['local'])
    } finally {
      await session.close()
      await other.cleanup()
    }
  })
})

describe('跨日', () => {
  it('过了换日时间：重新生成今日、本周，并通知界面刷新到新的一天', async () => {
    await open()
    const t = ticker()
    await t.tick()
    platform.notifications.length = 0

    clock.now = at('12:00', '2026-10-24')
    await t.tick()
    expect(platform.notifications).toEqual(['local'])
    expect(await waitFor(() => readFileSync(join(root, '今日.md'), 'utf8').includes('2026-10-24 周六'), 5000)).toBe(true)
  })

  it('过了午夜但没到换日时间：还是前一天，不动', async () => {
    await open()
    const t = ticker()
    await t.tick()
    platform.notifications.length = 0
    clock.now = at('02:30', '2026-10-24')
    await t.tick()
    expect(platform.notifications).toEqual([])
    clock.now = at('04:00', '2026-10-24')
    await t.tick()
    expect(platform.notifications).toEqual(['local'])
  })
})

describe('提醒', () => {
  it('默认不开：到再晚也不弹', async () => {
    await open()
    clock.now = at('23:30')
    await ticker().tick()
    expect(platform.reminders).toEqual([])
    expect(ledger.state).toBeNull()
  })

  it('到点弹一次，之后同一天不重复；记账在 ledger 里', async () => {
    await open()
    await remind({ enabled: true, plan: '08:30', review: '22:00' })
    const t = ticker()
    clock.now = at('08:00')
    await t.tick()
    expect(platform.reminders).toEqual([])

    clock.now = at('09:00')
    await t.tick()
    await t.tick()
    expect(platform.reminders).toHaveLength(1)
    expect(platform.reminders[0]!.body).toContain('计划')
    expect(ledger.state).toEqual({ date: '2026-10-23', sent: ['plan'] })

    clock.now = at('22:10')
    await t.tick()
    expect(platform.reminders).toHaveLength(2)
    expect(platform.reminders[1]!.body).toContain('复盘')
    expect(ledger.state).toEqual({ date: '2026-10-23', sent: ['plan', 'review'] })
  })

  it('重启应用（新建 ticker）后同一天不会再弹；第二天又会弹', async () => {
    await open()
    await remind({ enabled: true, plan: '08:30', review: null })
    clock.now = at('09:00')
    await ticker().tick()
    expect(platform.reminders).toHaveLength(1)

    await ticker().tick() // 相当于应用重启了一次
    expect(platform.reminders).toHaveLength(1)

    clock.now = at('09:00', '2026-10-24')
    await ticker().tick()
    expect(platform.reminders).toHaveLength(2)
    expect(ledger.state).toEqual({ date: '2026-10-24', sent: ['plan'] })
  })

  it('已经排了计划、已经复盘了：不弹', async () => {
    await open()
    await remind({ enabled: true, plan: '08:30', review: '22:00' })
    await updateTimeline(session.ctx(), [{ start: '09:00', end: '10:00', title: '看书', taskId: null }])
    await updateReview(session.ctx(), { done: '看完了', learned: '无', change: '早睡' })
    clock.now = at('23:00')
    await ticker().tick()
    expect(platform.reminders).toEqual([])
  })

  it('同时到点的两次检查不会弹两遍', async () => {
    await open()
    await remind({ enabled: true, plan: '08:30', review: null })
    clock.now = at('09:00')
    const t = ticker()
    await Promise.all([t.tick(), t.tick()])
    expect(platform.reminders).toHaveLength(1)
  })

  it('记账失败：不弹（免得每分钟都弹），只记一条警告，下次还能继续', async () => {
    await open()
    await remind({ enabled: true, plan: '08:30', review: null })
    clock.now = at('09:00')
    const t = ticker()
    ledger.failWrites = true
    await t.tick()
    expect(platform.reminders).toEqual([])
    expect(warnings.join('\n')).toContain('定时检查失败')

    ledger.failWrites = false
    await t.tick()
    expect(platform.reminders).toHaveLength(1)
  })
})
