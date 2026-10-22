import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileLedger, dueReminders, type ReminderKind } from '../../../src/main/app/reminders'
import { defaultSettings, emptyPlan, type PlanFile, type SettingsFile } from '../../../src/shared/schema'
import { useShanghaiTimezone } from './helpers'

const tz = useShanghaiTimezone()
beforeEach(tz.enter)
afterEach(tz.leave)

const at = (time: string, date = '2026-10-23'): Date => new Date(`${date}T${time}:00+08:00`)
const settings = (reminders: Partial<SettingsFile['reminders']> = {}, dayStartsAt = '04:00'): SettingsFile => ({
  ...defaultSettings(),
  dayStartsAt,
  reminders: { enabled: true, plan: '08:30', review: '22:00', ...reminders },
})
const kinds = (input: { settings: SettingsFile; now: Date; plan?: PlanFile; sent?: ReminderKind[] }): ReminderKind[] =>
  dueReminders({ plan: emptyPlan('2026-10-23'), sent: [], ...input }).map((r) => r.kind)

describe('dueReminders', () => {
  it('没开提醒，或者没设时间：什么都不提醒', () => {
    expect(kinds({ settings: settings({ enabled: false }), now: at('23:00') })).toEqual([])
    expect(kinds({ settings: settings({ plan: null, review: null }), now: at('23:00') })).toEqual([])
  })

  it('没到时间不提醒；到了（含正好那一分钟）才提醒', () => {
    expect(kinds({ settings: settings(), now: at('08:29') })).toEqual([])
    expect(kinds({ settings: settings(), now: at('08:30') })).toEqual(['plan'])
    expect(kinds({ settings: settings(), now: at('21:59') })).toEqual(['plan'])
    expect(kinds({ settings: settings(), now: at('22:00') })).toEqual(['plan', 'review'])
  })

  it('今天已经排了计划（有时间安排或任务）就不再提醒排计划', () => {
    const withTimeline = { ...emptyPlan('2026-10-23'), timeline: [{ start: '09:00', end: '10:00', title: '看书', taskId: null }] }
    const withTask = { ...emptyPlan('2026-10-23'), taskIds: ['00000000-0000-4000-8000-000000000001'] }
    expect(kinds({ settings: settings(), now: at('12:00'), plan: withTimeline })).toEqual([])
    expect(kinds({ settings: settings(), now: at('12:00'), plan: withTask })).toEqual([])
  })

  it('已经复盘了就不再提醒复盘', () => {
    const reviewed = { ...emptyPlan('2026-10-23'), review: { done: 'a', learned: 'b', change: 'c', at: '2026-10-23T21:00:00+08:00' } }
    expect(kinds({ settings: settings(), now: at('23:00'), plan: reviewed })).toEqual(['plan'])
  })

  it('今天提醒过的不再提醒', () => {
    expect(kinds({ settings: settings(), now: at('23:00'), sent: ['plan'] })).toEqual(['review'])
    expect(kinds({ settings: settings(), now: at('23:00'), sent: ['plan', 'review'] })).toEqual([])
  })

  it('只开一个：另一个不提醒', () => {
    expect(kinds({ settings: settings({ review: null }), now: at('23:00') })).toEqual(['plan'])
    expect(kinds({ settings: settings({ plan: null }), now: at('23:00') })).toEqual(['review'])
  })

  it('过了午夜、还没到换日时间：仍然算前一天，晚上的提醒到点了', () => {
    // 换日 04:00：10-24 凌晨 01:00 还属于 10-23，复盘（22:00）早就到点了
    expect(kinds({ settings: settings(), now: at('01:00', '2026-10-24') })).toEqual(['plan', 'review'])
    expect(kinds({ settings: settings(), now: at('03:59', '2026-10-24') })).toEqual(['plan', 'review'])
    // 04:00 起是新的一天，早上的计划提醒还没到
    expect(kinds({ settings: settings(), now: at('04:00', '2026-10-24') })).toEqual([])
    expect(kinds({ settings: settings(), now: at('08:30', '2026-10-24') })).toEqual(['plan'])
  })

  it('提醒内容是平和的口吻，不批评', () => {
    const texts = dueReminders({ settings: settings(), now: at('23:00'), plan: emptyPlan('2026-10-23'), sent: [] }).map((r) => r.body)
    expect(texts).toHaveLength(2)
    for (const text of texts) expect(text).not.toMatch(/缺勤|断网|又没|为什么/)
  })
})

describe('createFileLedger', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'butler-ledger-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('没有文件：当作还没提醒过', async () => {
    expect(await createFileLedger(dir).read()).toBeNull()
  })

  it('写了再读，重启后（新建一个）也读得到；目录不存在会自动建', async () => {
    await createFileLedger(join(dir, '深一层')).write({ date: '2026-10-23', sent: ['plan'] })
    expect(await createFileLedger(join(dir, '深一层')).read()).toEqual({ date: '2026-10-23', sent: ['plan'] })
  })

  it('文件坏了或者格式不对：当作没有；不认识的类型会被丢掉', async () => {
    const ledger = createFileLedger(dir)
    const file = join(dir, 'reminders-sent.json')
    await writeFile(file, '{损坏', 'utf8')
    expect(await ledger.read()).toBeNull()
    await writeFile(file, JSON.stringify({ date: 5, sent: 'x' }), 'utf8')
    expect(await ledger.read()).toBeNull()
    await writeFile(file, JSON.stringify({ date: '2026-10-23', sent: ['plan', '别的', 'review'] }), 'utf8')
    expect(await ledger.read()).toEqual({ date: '2026-10-23', sent: ['plan', 'review'] })
    expect(await readFile(file, 'utf8')).toContain('别的') // 只是读的时候过滤，不改文件
  })
})
