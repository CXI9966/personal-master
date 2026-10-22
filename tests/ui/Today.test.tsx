import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import Today from '../../src/renderer/src/pages/Today'
import { emptyPlan, type Checkin } from '../../src/shared/schema'
import type { DaySnapshot, TodaySnapshot } from '../../src/shared/views'
import { installButler } from './butlerMock'
import { task, todayFixture } from './fixtures'

const wake: Checkin = { id: '00000000-0000-4000-8000-0000000000aa', type: 'wake', at: '2026-10-23T07:02:00+08:00', source: 'phone' }

function setup(snapshot: TodaySnapshot = todayFixture(), extra: Record<string, unknown> = {}) {
  const butler = installButler({
    'today:get': () => snapshot,
    'checkin:add': undefined,
    'plan:energy': undefined,
    'plan:timeline': undefined,
    'plan:tasks': undefined,
    'plan:review': undefined,
    'tasks:add': undefined,
    'tasks:status': undefined,
    'weight:add': undefined,
    ...extra,
  })
  render(<Today />)
  return butler
}

describe('今日页：显示', () => {
  it('标题、日期、第几周，没打卡时的提示', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: '今日' })).toBeTruthy()
    expect(screen.getByText('2026-10-23 周五 · 第 43 周')).toBeTruthy()
    expect(screen.getByText('今天还没有打卡')).toBeTruthy()
    expect(screen.getByText('还没有排任务。可以新建一个，或者从任务库里挑。')).toBeTruthy()
  })

  it('已打卡：显示时间和来源', async () => {
    setup(todayFixture({ wake }))
    expect(await screen.findByText('起床 07:02（手机）')).toBeTruthy()
  })

  it('隔了几天回来：显示“欢迎回来”', async () => {
    setup(todayFixture({ welcomeBack: true }))
    expect(await screen.findByRole('region', { name: '欢迎回来' })).toBeTruthy()
  })

  it('有被跳过的数据时给出可展开的警告', async () => {
    setup(todayFixture({ warnings: ['data/weight.jsonl 第 1 行被跳过：不是合法的 JSON'] }))
    expect(await screen.findByText('有 1 条数据被跳过了')).toBeTruthy()
  })

  it('读取失败：显示原因', async () => {
    installButler({ 'today:get': () => { throw new Error('还没有选择工作区') } })
    render(<Today />)
    expect((await screen.findByRole('alert')).textContent).toBe('还没有选择工作区')
  })

  it('主进程推 data:changed 后重新读取', async () => {
    let snapshot = todayFixture()
    const butler = installButler({ 'today:get': () => snapshot })
    render(<Today />)
    expect(await screen.findByText('今天还没有打卡')).toBeTruthy()
    snapshot = todayFixture({ wake })
    act(() => butler.emit('data:changed', { reason: 'local' }))
    expect(await screen.findByText('起床 07:02（手机）')).toBeTruthy()
  })
})

describe('今日页：打卡、精力、体重', () => {
  it('点“起床打卡”“睡前打卡”', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.click(await screen.findByRole('button', { name: '起床打卡' }))
    await user.click(screen.getByRole('button', { name: '睡前打卡' }))
    expect(butler.callsOf('checkin:add')).toEqual([{ type: 'wake' }, { type: 'sleep' }])
  })

  it('精力：点一下选中，再点同一个取消', async () => {
    const user = userEvent.setup()
    const butler = setup(todayFixture({ plan: { ...emptyPlan('2026-10-23'), energy: 'mid' } }))
    const mid = await screen.findByRole('button', { name: '😐 一般' })
    expect(mid.getAttribute('aria-pressed')).toBe('true')
    await user.click(mid)
    await user.click(screen.getByRole('button', { name: '😫 疲惫' }))
    expect(butler.callsOf('plan:energy')).toEqual([{ energy: null }, { energy: 'low' }])
  })

  it('记体重：发出去之后输入框清空', async () => {
    const user = userEvent.setup()
    const butler = setup()
    const input = await screen.findByLabelText('体重（公斤）')
    await user.type(input, '76.4')
    await user.click(screen.getByRole('button', { name: '记体重' }))
    expect(butler.callsOf('weight:add')).toEqual([{ kg: 76.4 }])
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''))
  })

  it('操作失败：显示原因，输入框里的字保留', async () => {
    const user = userEvent.setup()
    setup(todayFixture(), { 'weight:add': () => { throw new Error('文件被其他程序占用：data/weight.jsonl') } })
    const input = await screen.findByLabelText('体重（公斤）')
    await user.type(input, '76.4')
    await user.click(screen.getByRole('button', { name: '记体重' }))
    expect((await screen.findByRole('alert')).textContent).toBe('文件被其他程序占用：data/weight.jsonl')
    expect((input as HTMLInputElement).value).toBe('76.4')
  })
})

describe('今日页：热力图', () => {
  it('点格子看那天的记录，可以关闭', async () => {
    const user = userEvent.setup()
    const day: DaySnapshot = {
      date: '2026-10-22', weekday: '周四', score: 5, plan: emptyPlan('2026-10-22'), planTasks: [], doneTasks: [task(1, { status: 'done' })],
      wake: null, sleep: null, weights: [], workouts: [], learning: [],
    }
    const butler = setup(todayFixture(), { 'day:get': day })
    await user.click(await screen.findByRole('button', { name: '2026-10-22 周四，没有记录' }))
    const detail = await screen.findByRole('region', { name: '2026-10-22 的记录' })
    expect(within(detail).getByText('2026-10-22 周四 · 5 分')).toBeTruthy()
    expect(within(detail).getByText('完成：任务1')).toBeTruthy()
    expect(butler.callsOf('day:get')).toEqual([{ date: '2026-10-22' }])
    await user.click(within(detail).getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('region', { name: '2026-10-22 的记录' })).toBeNull()
  })
})

describe('今日页：时间安排', () => {
  it('添加一条安排', async () => {
    const user = userEvent.setup()
    const butler = setup()
    fireEvent.change(await screen.findByLabelText('开始时间'), { target: { value: '09:00' } })
    fireEvent.change(screen.getByLabelText('结束时间'), { target: { value: '10:30' } })
    await user.type(screen.getByLabelText('安排内容'), '电机选型')
    await user.click(screen.getByRole('button', { name: '添加安排' }))
    expect(butler.callsOf('plan:timeline')).toEqual([{ items: [{ start: '09:00', end: '10:30', title: '电机选型', taskId: null }] }])
  })

  it('删除一条安排', async () => {
    const user = userEvent.setup()
    const items = [{ start: '09:00', end: '10:00', title: 'a', taskId: null }, { start: '14:00', end: '15:00', title: 'b', taskId: null }]
    const butler = setup(todayFixture({ plan: { ...emptyPlan('2026-10-23'), timeline: items } }))
    await user.click(await screen.findByRole('button', { name: '删除：09:00-10:00 a' }))
    expect(butler.callsOf('plan:timeline')).toEqual([{ items: [items[1]] }])
  })

  it('今天的固定安排可以一键加进时间安排', async () => {
    const user = userEvent.setup()
    const butler = setup(todayFixture({ fixedToday: [{ weekday: 5, start: '08:00', end: '09:40', title: '电力电子' }] }))
    expect(await screen.findByText('08:00-09:40 电力电子')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '加入时间安排' }))
    expect(butler.callsOf('plan:timeline')).toEqual([{ items: [{ start: '08:00', end: '09:40', title: '电力电子', taskId: null }] }])
  })
})
