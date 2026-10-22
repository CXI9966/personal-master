import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import Records from '../../src/renderer/src/pages/Records'
import type { RecordsSnapshot } from '../../src/shared/views'
import { installButler } from './butlerMock'
import { makeCells } from './fixtures'

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const SNAPSHOT: RecordsSnapshot = {
  today: '2026-10-23',
  heatmap: makeCells('2026-01-05', 53 * 7, '2026-10-23'),
  checkins: [
    { date: '2026-10-23', wake: { id: id(1), type: 'wake', at: '2026-10-23T07:02:00+08:00', source: 'phone' }, sleep: null },
    { date: '2026-10-22', wake: null, sleep: { id: id(2), type: 'sleep', at: '2026-10-22T23:41:00+08:00', source: 'desktop' } },
  ],
  weights: [
    { id: id(3), at: '2026-10-19T07:00:00+08:00', kg: 77 },
    { id: id(4), at: '2026-10-23T07:10:00+08:00', kg: 76.4 },
  ],
  weightTargetKg: 70,
  workouts: [{ id: id(5), at: '2026-10-21T21:30:00+08:00', summary: '有氧 30 分钟 + 推', durationMin: 65 }],
  learning: [
    { id: id(6), seq: 1, at: '2026-10-23T22:50:00+08:00', taskId: null, topic: 'Buck 电路', checks: [{ q: '电感饱和会怎样？', result: 'mastered' }, { q: '占空比公式', result: 'partial' }] },
  ],
  warnings: [],
}

function setup(snapshot: RecordsSnapshot = SNAPSHOT) {
  const butler = installButler({ 'records:get': () => snapshot, 'weekly:list': [], 'weight:add': undefined, 'workout:add': undefined })
  render(<Records />)
  return butler
}

describe('记录页：显示', () => {
  it('全年日历是 53 周', async () => {
    setup()
    const map = await screen.findByRole('group', { name: '最近一年的记录' })
    expect(within(map).getAllByRole('button')).toHaveLength(53 * 7)
  })

  it('打卡表：最新的在上，来源写清楚', async () => {
    setup()
    const table = within(await screen.findByRole('table', { name: '最近的打卡记录' }))
    const rows = table.getAllByRole('row').slice(1)
    expect(rows[0]?.textContent).toContain('2026-10-23 周五')
    expect(rows[0]?.textContent).toContain('07:02（手机）')
    expect(rows[1]?.textContent).toContain('23:41（电脑）')
  })

  it('体重表：目标、最新的在上、较上次的变化', async () => {
    setup()
    const table = within(await screen.findByRole('table', { name: '体重记录' }))
    const rows = table.getAllByRole('row').slice(1)
    expect(rows.map((r) => r.textContent)).toEqual(['2026-10-2376.4-0.6', '2026-10-1977'])
    expect(screen.getByText('目标 70 kg')).toBeTruthy()
  })

  it('健身表和学习检验', async () => {
    setup()
    expect(await screen.findByText('有氧 30 分钟 + 推')).toBeTruthy()
    expect(screen.getByText('L-0001 · 2026-10-23 · Buck 电路')).toBeTruthy()
    expect(screen.getByText('电感饱和会怎样？ → 掌握')).toBeTruthy()
    expect(screen.getByText('占空比公式 → 部分掌握')).toBeTruthy()
  })

  it('什么记录都没有时给温和的提示', async () => {
    setup({ ...SNAPSHOT, checkins: [], weights: [], workouts: [], learning: [], weightTargetKg: null })
    expect(await screen.findByText('还没有打卡记录')).toBeTruthy()
    expect(screen.getByText('还没有体重记录')).toBeTruthy()
    expect(screen.getByText('还没有健身记录')).toBeTruthy()
  })
})

describe('记录页：录入', () => {
  it('记体重', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.type(await screen.findByLabelText('体重（公斤）'), '76.1')
    await user.click(screen.getByRole('button', { name: '记体重' }))
    expect(butler.callsOf('weight:add')).toEqual([{ kg: 76.1 }])
  })

  it('记健身：时长可以不填', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.type(await screen.findByLabelText('健身内容'), '跑步')
    await user.click(screen.getByRole('button', { name: '记健身' }))
    await user.type(screen.getByLabelText('健身内容'), '力量')
    await user.type(screen.getByLabelText('时长（分钟）'), '45')
    await user.click(screen.getByRole('button', { name: '记健身' }))
    expect(butler.callsOf('workout:add')).toEqual([
      { summary: '跑步', durationMin: null },
      { summary: '力量', durationMin: 45 },
    ])
  })

  it('点日历格子看那一天', async () => {
    const user = userEvent.setup()
    installButler({
      'records:get': SNAPSHOT,
      'weekly:list': [],
      'day:get': { date: '2026-10-22', weekday: '周四', score: 0, plan: { version: 1, date: '2026-10-22', energy: null, timeline: [], taskIds: [], review: null }, planTasks: [], doneTasks: [], wake: null, sleep: null, weights: [], workouts: [], learning: [] },
    })
    render(<Records />)
    await user.click(await screen.findByRole('button', { name: '2026-10-22 周四，没有记录' }))
    expect(await screen.findByRole('region', { name: '2026-10-22 的记录' })).toBeTruthy()
    expect(screen.getByText('这一天没有记录，没关系，从今天开始就好。')).toBeTruthy()
  })
})
