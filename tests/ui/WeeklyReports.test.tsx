import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import WeeklyReports from '../../src/renderer/src/components/WeeklyReports'
import type { UsageSummary } from '../../src/shared/ai'
import type { WeeklyReportView } from '../../src/shared/views'
import { installButler } from './butlerMock'

const usage = (calls = 0): UsageSummary => ({
  weekKey: '2026-W42',
  weekStart: '2026-10-12',
  weekEnd: '2026-10-18',
  total: { calls, inputTokens: calls * 100, outputTokens: calls * 10 },
  byFeature: calls ? { chat: { calls, inputTokens: calls * 100, outputTokens: calls * 10 } } : {},
  byDay: [],
  callsWithoutTokens: 0,
})

const report = (weekKey: string, weekStart: string, weekEnd: string, patch: Partial<WeeklyReportView> = {}): WeeklyReportView => ({
  weekKey,
  weekStart,
  weekEnd,
  lines: ['起床打卡 5/7 天，平均 07:10', '完成任务 4 个'],
  rows: [],
  usage: usage(),
  comment: null,
  ...patch,
})

describe('周报', () => {
  it('还没有周报：说明什么时候会有', async () => {
    installButler({ 'weekly:list': [] })
    render(<WeeklyReports />)
    expect(await screen.findByText(/还没有周报/)).toBeTruthy()
  })

  it('列出每一周：范围、做到的事、管家用量；第一周默认展开', async () => {
    installButler({
      'weekly:list': [report('2026-W42', '2026-10-12', '2026-10-18', { usage: usage(2) }), report('2026-W41', '2026-10-05', '2026-10-11')],
    })
    const { container } = render(<WeeklyReports />)
    expect(await screen.findByText('2026-W42（10-12 ~ 10-18）')).toBeTruthy()
    expect(screen.getByText('2026-W41（10-05 ~ 10-11）')).toBeTruthy()
    expect(screen.getAllByText('起床打卡 5/7 天，平均 07:10')).toHaveLength(2)
    expect(screen.getByText(/调用 2 次，输入 200 token，输出 20 token（聊天 2 次）/)).toBeTruthy()
    expect(screen.getByText(/这一周没有调用管家/)).toBeTruthy()
    expect([...container.querySelectorAll('details')].map((d) => d.open)).toEqual([true, false])
  })

  it('没点评过：点“让管家点评”才调用；等的时候按钮说明在写；点评出来后显示在下面', async () => {
    const user = userEvent.setup()
    let release: (value: { text: string }) => void = () => undefined
    let commented = false
    const withComment = { comment: { text: '这周起得很稳。', at: '2026-10-23T12:00:00+08:00' } }
    const butler = installButler({
      'weekly:list': () => [report('2026-W42', '2026-10-12', '2026-10-18', commented ? withComment : {})],
      'weekly:comment': () => new Promise((resolve) => (release = resolve)),
    })
    render(<WeeklyReports />)
    await user.click(await screen.findByRole('button', { name: '让管家点评' }))
    expect(butler.callsOf('weekly:comment')).toEqual([{ weekStart: '2026-10-12' }])
    expect((await screen.findByRole('button', { name: '管家正在写…' })).hasAttribute('disabled')).toBe(true)

    commented = true
    release({ text: '这周起得很稳。' })
    butler.emit('data:changed', { reason: 'local' }) // 主进程存好点评后会通知刷新
    expect(await screen.findByText('这周起得很稳。')).toBeTruthy()
    expect(screen.getByText(/管家点评于 2026-10-23/)).toBeTruthy()
    expect(await screen.findByRole('button', { name: '重新点评' })).toBeTruthy()
  })

  it('点评失败：把原因直接显示出来，按钮恢复可点', async () => {
    const user = userEvent.setup()
    installButler({
      'weekly:list': [report('2026-W42', '2026-10-12', '2026-10-18')],
      'weekly:comment': () => {
        throw new Error('还没配置好模型：缺 接口地址、模型名、API key')
      },
    })
    render(<WeeklyReports />)
    await user.click(await screen.findByRole('button', { name: '让管家点评' }))
    expect(await screen.findByText(/缺 接口地址、模型名、API key/)).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: '让管家点评' }).hasAttribute('disabled')).toBe(false))
  })
})
