import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import Settings from '../../src/renderer/src/pages/Settings'
import { defaultSettings, emptyProfile, type ProfileFile } from '../../src/shared/schema'
import type { SettingsSnapshot } from '../../src/shared/views'
import { installButler } from './butlerMock'

function setup(profile: ProfileFile = emptyProfile()) {
  const snapshot: SettingsSnapshot = { workspaceRoot: 'D:\\我的工作区', settings: defaultSettings(), profile }
  const butler = installButler({ 'settings:get': () => snapshot, 'settings:update': undefined, 'profile:update': undefined })
  render(<Settings />)
  return butler
}

describe('设置页：通用', () => {
  it('显示工作区路径', async () => {
    setup()
    expect(await screen.findByText('D:\\我的工作区')).toBeTruthy()
  })

  it('改一天开始的时间', async () => {
    const user = userEvent.setup()
    const butler = setup()
    const input = await screen.findByLabelText('一天开始的时间')
    expect((input as HTMLInputElement).value).toBe('04:00')
    fireEvent.change(input, { target: { value: '05:30' } })
    await user.click(screen.getAllByRole('button', { name: '保存' })[0]!)
    expect(butler.callsOf('settings:update')).toEqual([{ dayStartsAt: '05:30' }])
  })

  it('改计分权重：整组数字一起发', async () => {
    const user = userEvent.setup()
    const butler = setup()
    const review = await screen.findByLabelText('完成复盘')
    expect((review as HTMLInputElement).value).toBe('2')
    await user.clear(review)
    await user.type(review, '5')
    await user.click(screen.getByRole('button', { name: '保存计分' }))
    const [{ weights }] = butler.callsOf('settings:update') as Array<{ weights: Record<string, number> }>
    expect(weights).toEqual({ ...defaultSettings().heatmap.weights, review: 5 })
  })

  it('恢复默认：发默认权重，输入框也变回默认值', async () => {
    const user = userEvent.setup()
    const butler = setup()
    const review = await screen.findByLabelText('完成复盘')
    await user.clear(review)
    await user.type(review, '9')
    await user.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(butler.callsOf('settings:update')).toEqual([{ weights: defaultSettings().heatmap.weights }])
    await waitFor(() => expect((review as HTMLInputElement).value).toBe('2'))
  })
})

describe('设置页：目标和作息', () => {
  it('目标全空：栏目齐全但什么都没预填', async () => {
    setup()
    expect(((await screen.findByLabelText('目标体重（kg）')) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('起床目标') as HTMLInputElement).value).toBe('')
    expect(screen.getAllByRole('checkbox').every((box) => !(box as HTMLInputElement).checked)).toBe(true)
    expect(screen.getByText('还没有。比如每周的课程、例会。')).toBeTruthy()
  })

  it('填目标、作息、健身日、固定安排，一次保存', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.type(await screen.findByLabelText('目标体重（kg）'), '70')
    fireEvent.change(screen.getByLabelText('起床目标'), { target: { value: '07:00' } })
    fireEvent.change(screen.getByLabelText('睡前目标'), { target: { value: '23:40' } })
    await user.type(screen.getByLabelText('想对自己说的话 / 目标备注'), '先稳住作息')
    await user.click(screen.getByRole('checkbox', { name: '周一' }))
    await user.click(screen.getByRole('checkbox', { name: '周三' }))
    await user.selectOptions(screen.getByLabelText('星期'), '3')
    fireEvent.change(screen.getByLabelText('固定安排开始时间'), { target: { value: '08:00' } })
    fireEvent.change(screen.getByLabelText('固定安排结束时间'), { target: { value: '09:40' } })
    await user.type(screen.getByLabelText('固定安排内容'), '电力电子')
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.getByText('周三 08:00-09:40 电力电子')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '保存目标和作息' }))

    expect(butler.callsOf('profile:update')).toEqual([
      {
        profile: {
          version: 1,
          goals: { weightTargetKg: 70, notes: '先稳住作息' },
          schedule: {
            wakeTarget: '07:00',
            sleepTarget: '23:40',
            gymDays: [1, 3],
            fixed: [{ weekday: 3, start: '08:00', end: '09:40', title: '电力电子' }],
          },
        },
      },
    ])
  })

  it('已有的内容会带出来；删除固定安排；清空目标体重变回 null', async () => {
    const user = userEvent.setup()
    const profile: ProfileFile = {
      ...emptyProfile(),
      goals: { weightTargetKg: 70, notes: '' },
      schedule: { wakeTarget: '07:00', sleepTarget: null, gymDays: [5], fixed: [{ weekday: 1, start: '10:00', end: '11:40', title: '信号与系统' }] },
    }
    const butler = setup(profile)
    expect(((await screen.findByLabelText('目标体重（kg）')) as HTMLInputElement).value).toBe('70')
    expect((screen.getByRole('checkbox', { name: '周五' }) as HTMLInputElement).checked).toBe(true)
    await user.click(screen.getByRole('button', { name: '删除固定安排：信号与系统' }))
    await user.clear(screen.getByLabelText('目标体重（kg）'))
    await user.click(screen.getByRole('button', { name: '保存目标和作息' }))
    const [{ profile: saved }] = butler.callsOf('profile:update') as Array<{ profile: ProfileFile }>
    expect(saved.goals.weightTargetKg).toBeNull()
    expect(saved.schedule.fixed).toEqual([])
    expect(saved.schedule.gymDays).toEqual([5])
  })

  it('固定安排没填完整时，添加按钮不起作用', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(await screen.findByLabelText('固定安排内容'), '只有标题')
    await user.click(screen.getByRole('button', { name: '添加' }))
    expect(screen.queryByText(/只有标题/, { selector: 'li' })).toBeNull()
  })
})
