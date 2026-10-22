import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import Today from '../../src/renderer/src/pages/Today'
import { emptyPlan } from '../../src/shared/schema'
import type { TodaySnapshot } from '../../src/shared/views'
import { installButler } from './butlerMock'
import { task, todayFixture } from './fixtures'

const A = task(1)
const B = task(2, { status: 'done', doneAt: '2026-10-23T09:00:00+08:00' })
const C = task(3, { due: '2026-10-30' })
const D = task(4)

function setup(snapshot: TodaySnapshot) {
  const butler = installButler({
    'today:get': () => snapshot,
    'plan:tasks': undefined,
    'plan:review': undefined,
    'tasks:add': undefined,
    'tasks:status': undefined,
  })
  render(<Today />)
  return butler
}

const withPlan = (taskIds: string[], patch: Partial<TodaySnapshot> = {}): TodaySnapshot =>
  todayFixture({ plan: { ...emptyPlan('2026-10-23'), taskIds }, ...patch })

describe('今日任务', () => {
  it('勾选完成、取消勾选重新打开', async () => {
    const user = userEvent.setup()
    const butler = setup(withPlan([A.id, B.id], { planTasks: [A, B], openTasks: [A] }))
    await user.click(await screen.findByRole('checkbox', { name: '任务1' }))
    await user.click(screen.getByRole('checkbox', { name: '任务2' }))
    expect(butler.callsOf('tasks:status')).toEqual([
      { id: A.id, status: 'done' },
      { id: B.id, status: 'open' },
    ])
  })

  it('已完成的任务画成划掉的样子；有截止日期的显示出来', async () => {
    setup(withPlan([B.id, C.id], { planTasks: [B, C], openTasks: [C] }))
    expect((await screen.findByText('任务2')).className).toContain('done')
    expect(screen.getByText('截止 2026-10-30')).toBeTruthy()
  })

  it('移出今天：只发剩下的任务', async () => {
    const user = userEvent.setup()
    const butler = setup(withPlan([A.id, C.id], { planTasks: [A, C], openTasks: [A, C] }))
    await user.click(await screen.findByRole('button', { name: '从今天移除：任务1' }))
    expect(butler.callsOf('plan:tasks')).toEqual([{ taskIds: [C.id] }])
  })

  it('新建任务并加入今天', async () => {
    const user = userEvent.setup()
    const butler = setup(todayFixture())
    await user.type(await screen.findByLabelText('新任务标题'), '写周报')
    await user.click(screen.getByRole('button', { name: '新建并加入今天' }))
    expect(butler.callsOf('tasks:add')).toEqual([{ title: '写周报', addToToday: true }])
  })

  it('从任务库挑：下拉里不含已经在计划里的任务', async () => {
    const user = userEvent.setup()
    const butler = setup(withPlan([A.id], { planTasks: [A], openTasks: [A, C, D] }))
    const select = await screen.findByLabelText('从任务库挑选')
    expect([...(select as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['从任务库挑一个…', '任务3', '任务4'])
    await user.selectOptions(select, C.id)
    await user.click(screen.getByRole('button', { name: '加入今天' }))
    expect(butler.callsOf('plan:tasks')).toEqual([{ taskIds: [A.id, C.id] }])
  })

  it('任务库里没有可挑的任务时不显示下拉', async () => {
    setup(withPlan([A.id], { planTasks: [A], openTasks: [A] }))
    await screen.findByRole('checkbox', { name: '任务1' })
    expect(screen.queryByLabelText('从任务库挑选')).toBeNull()
  })

  it('昨天没做完的任务可以接到今天', async () => {
    const user = userEvent.setup()
    const butler = setup(withPlan([], { unfinished: [D], openTasks: [D] }))
    expect(await screen.findByText('昨天计划里还没做完的：')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '加入今天：任务4' }))
    expect(butler.callsOf('plan:tasks')).toEqual([{ taskIds: [D.id] }])
  })
})

describe('晚间复盘', () => {
  it('写三句话并保存', async () => {
    const user = userEvent.setup()
    const butler = setup(todayFixture())
    await user.type(await screen.findByLabelText('完成了什么'), '选完了电机')
    await user.type(screen.getByLabelText('学会了什么'), '堵转电流')
    await user.type(screen.getByLabelText('明天改什么'), '早点开始')
    await user.click(screen.getByRole('button', { name: '保存复盘' }))
    expect(butler.callsOf('plan:review')).toEqual([{ done: '选完了电机', learned: '堵转电流', change: '早点开始' }])
  })

  it('已经保存过的复盘会带出来，并显示保存时间', async () => {
    setup(todayFixture({ plan: { ...emptyPlan('2026-10-23'), review: { done: '写了周报', learned: 'x', change: 'y', at: '2026-10-23T22:40:00+08:00' } } }))
    expect(((await screen.findByLabelText('完成了什么')) as HTMLTextAreaElement).value).toBe('写了周报')
    expect(screen.getByText('已保存（22:40）')).toBeTruthy()
  })
})
