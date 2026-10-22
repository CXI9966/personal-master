import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import Shell from '../../src/renderer/src/Shell'
import { defaultSettings, emptyProfile, emptyTasks } from '../../src/shared/schema'
import { installButler } from './butlerMock'
import { makeCells, todayFixture } from './fixtures'

const baseHandlers = {
  'ai:status': { provider: { kind: 'openai-compatible', baseURL: 'http://x/v1', model: 'm' }, contextStrategy: 'scene', actionMode: 'tools', hasKey: true, encryptionAvailable: true, configured: true },
  'persona:get': { markdown: '', sections: null },
  'persona:presets': [],
  'ai:usage': { weekKey: '2026-W43', weekStart: '2026-10-19', weekEnd: '2026-10-25', total: { calls: 0, inputTokens: 0, outputTokens: 0 }, byFeature: {}, byDay: [], callsWithoutTokens: 0 },
  'today:get': todayFixture(),
  'tasks:get': emptyTasks(),
  'records:get': { today: '2026-10-23', heatmap: makeCells('2026-01-05', 53 * 7, '2026-10-23'), checkins: [], weights: [], weightTargetKg: null, workouts: [], learning: [], warnings: [] },
  'settings:get': { workspaceRoot: 'D:\\我的工作区', settings: defaultSettings(), profile: emptyProfile(), autostart: { supported: false, enabled: false } },
  'weekly:list': [],
  'history:last': null,
  'data:health': [],
}

describe('Shell：导航', () => {
  it('左边五个入口，点哪个显示哪一页，当前页标 aria-current', async () => {
    const user = userEvent.setup()
    installButler(baseHandlers)
    render(<Shell />)
    const nav = screen.getByRole('navigation', { name: '主导航' })
    expect(within(nav).getByRole('button', { name: '今日' }).getAttribute('aria-current')).toBe('page')
    expect(await screen.findByRole('heading', { name: '今日' })).toBeTruthy()

    await user.click(within(nav).getByRole('button', { name: '管家' }))
    expect(await screen.findByRole('heading', { name: '管家' })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: '管家' }).getAttribute('aria-current')).toBe('page')

    await user.click(within(nav).getByRole('button', { name: '任务' }))
    expect(await screen.findByRole('heading', { name: '任务' })).toBeTruthy()
    expect(within(nav).getByRole('button', { name: '任务' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('button', { name: '今日' }).getAttribute('aria-current')).toBeNull()

    await user.click(within(nav).getByRole('button', { name: '记录' }))
    expect(await screen.findByRole('heading', { name: '记录' })).toBeTruthy()
    await user.click(within(nav).getByRole('button', { name: '设置' }))
    expect(await screen.findByRole('heading', { name: '设置' })).toBeTruthy()
    expect(screen.getByText('D:\\我的工作区')).toBeTruthy()
  })
})

describe('今日页的管家入口', () => {
  it('“让管家排”“复盘并检验”会切到管家页，并用对应场景发出消息', async () => {
    const user = userEvent.setup()
    const butler = installButler({ ...baseHandlers, 'ai:send': { runId: 'r1' } })
    render(<Shell />)
    await user.click(await screen.findByRole('button', { name: '让管家排' }))
    expect(await screen.findByRole('heading', { name: '管家' })).toBeTruthy()
    expect(butler.callsOf('ai:send')).toHaveLength(1)
    expect(butler.callsOf('ai:send')[0]).toMatchObject({ scene: 'plan' })
  })

  it('对话在切换页面后还在', async () => {
    const user = userEvent.setup()
    installButler({ ...baseHandlers, 'ai:send': { runId: 'r1' } })
    render(<Shell />)
    const nav = screen.getByRole('navigation', { name: '主导航' })
    await user.click(within(nav).getByRole('button', { name: '管家' }))
    await user.type(await screen.findByLabelText('给管家发消息'), '记住我说过的话')
    await user.keyboard('{Enter}')
    await user.click(within(nav).getByRole('button', { name: '任务' }))
    await user.click(within(nav).getByRole('button', { name: '管家' }))
    expect(await within(screen.getByRole('log', { name: '对话' })).findByText('记住我说过的话')).toBeTruthy()
  })
})

describe('撤销条', () => {
  it('显示最近一次改动，点撤销发出带 id 的请求', async () => {
    const user = userEvent.setup()
    const butler = installButler({ ...baseHandlers, 'history:last': { id: 'c1', label: '起床打卡' }, 'history:undo': true })
    render(<Shell />)
    expect(await screen.findByText('最近一次改动：起床打卡')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '撤销' }))
    expect(butler.callsOf('history:undo')).toEqual([{ changeId: 'c1' }])
  })

  it('没有可撤销的改动时不显示', async () => {
    installButler(baseHandlers)
    render(<Shell />)
    await screen.findByRole('heading', { name: '今日' })
    expect(screen.queryByRole('button', { name: '撤销' })).toBeNull()
  })

  it('改动记录随 data:changed 更新', async () => {
    let last: { id: string; label: string } | null = null
    const butler = installButler({ ...baseHandlers, 'history:last': () => last })
    render(<Shell />)
    await screen.findByRole('heading', { name: '今日' })
    last = { id: 'c2', label: '记体重' }
    act(() => butler.emit('data:changed', { reason: 'local' }))
    expect(await screen.findByText('最近一次改动：记体重')).toBeTruthy()
  })
})

describe('数据健康提示', () => {
  it('核心文件读不出来：说清楚是哪个，给“恢复上一个版本”', async () => {
    const user = userEvent.setup()
    const butler = installButler({
      ...baseHandlers,
      'data:health': [{ rel: 'data/tasks.json', message: 'data/tasks.json 不是合法的 JSON：Unexpected token' }],
      'history:restore': true,
    })
    render(<Shell />)
    const alert = await screen.findByRole('alert', { name: '数据文件有问题' })
    expect(within(alert).getByText(/data\/tasks.json 不是合法的 JSON/)).toBeTruthy()
    await user.click(within(alert).getByRole('button', { name: '恢复上一个版本' }))
    expect(butler.callsOf('history:restore')).toEqual([{ rel: 'data/tasks.json' }])
  })

  it('一切正常时没有提示', async () => {
    installButler(baseHandlers)
    render(<Shell />)
    await screen.findByRole('heading', { name: '今日' })
    expect(screen.queryByRole('alert', { name: '数据文件有问题' })).toBeNull()
  })
})
