import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import PersonaEditor from '../../src/renderer/src/components/PersonaEditor'
import UsagePanel from '../../src/renderer/src/components/UsagePanel'
import { joinPersona, type PersonaSections } from '../../src/shared/persona'
import type { UsageSummary } from '../../src/shared/ai'
import { installButler } from './butlerMock'

const SECTIONS: PersonaSections = { 说话风格: '轻声细语', 督促方式: '先问原因', 检验规则: '不放水', 不许做的事: '不翻旧账' }
const PRESETS = [
  { id: 'coach', name: '战友教练', summary: '', markdown: joinPersona({ 说话风格: '预设的风格', 督促方式: 'a', 检验规则: 'b', 不许做的事: 'c' }) },
  { id: 'strict', name: '严格教官', summary: '', markdown: joinPersona({ 说话风格: '严厉', 督促方式: 'a', 检验规则: 'b', 不许做的事: 'c' }) },
]

describe('PersonaEditor', () => {
  it('四栏分别编辑，保存时拼回完整的人格文件', async () => {
    const user = userEvent.setup()
    const butler = installButler({ 'persona:get': { markdown: joinPersona(SECTIONS), sections: SECTIONS }, 'persona:presets': PRESETS, 'persona:save': undefined })
    render(<PersonaEditor />)
    const style = (await screen.findByLabelText('说话风格')) as HTMLTextAreaElement
    expect(style.value).toBe('轻声细语')
    await user.clear(style)
    await user.type(style, '叫我船长')
    await user.click(screen.getByRole('button', { name: '保存人格' }))
    expect(butler.callsOf('persona:save')).toEqual([{ markdown: joinPersona({ ...SECTIONS, 说话风格: '叫我船长' }) }])
  })

  it('套用预设：先填进编辑框，保存才算数', async () => {
    const user = userEvent.setup()
    const butler = installButler({ 'persona:get': { markdown: joinPersona(SECTIONS), sections: SECTIONS }, 'persona:presets': PRESETS, 'persona:save': undefined })
    render(<PersonaEditor />)
    await user.selectOptions(await screen.findByLabelText('套用预设'), 'strict')
    await user.click(screen.getByRole('button', { name: '填入编辑框' }))
    expect((screen.getByLabelText('说话风格') as HTMLTextAreaElement).value).toBe('严厉')
    expect(butler.callsOf('persona:save')).toEqual([])
    await user.click(screen.getByRole('button', { name: '保存人格' }))
    expect(butler.callsOf('persona:save')).toHaveLength(1)
  })

  it('标题被改乱了：按整篇编辑，原样保存', async () => {
    const user = userEvent.setup()
    const markdown = '# 我自己写的\n你是个管家。\n'
    const butler = installButler({ 'persona:get': { markdown, sections: null }, 'persona:presets': PRESETS, 'persona:save': undefined })
    render(<PersonaEditor />)
    const raw = (await screen.findByLabelText('整篇人格')) as HTMLTextAreaElement
    expect(raw.value).toBe(markdown)
    expect(screen.getByText(/标题被改动过/)).toBeTruthy()
    await user.type(raw, '更温柔。')
    await user.click(screen.getByRole('button', { name: '保存人格' }))
    expect(butler.callsOf('persona:save')).toEqual([{ markdown: `${markdown}更温柔。` }])
  })

  it('保存失败：显示原因', async () => {
    const user = userEvent.setup()
    installButler({ 'persona:get': { markdown: joinPersona(SECTIONS), sections: SECTIONS }, 'persona:presets': PRESETS, 'persona:save': () => { throw new Error('文件被其他程序占用：管家人格.md') } })
    render(<PersonaEditor />)
    await user.click(await screen.findByRole('button', { name: '保存人格' }))
    expect((await screen.findByRole('alert')).textContent).toBe('文件被其他程序占用：管家人格.md')
  })
})

const USAGE: UsageSummary = {
  weekKey: '2026-W43',
  weekStart: '2026-10-19',
  weekEnd: '2026-10-25',
  total: { calls: 4, inputTokens: 12345, outputTokens: 678 },
  byFeature: { chat: { calls: 3, inputTokens: 345, outputTokens: 78 }, plan: { calls: 1, inputTokens: 12000, outputTokens: 600 } },
  byDay: [
    { date: '2026-10-19', calls: 2, inputTokens: 12100, outputTokens: 610 },
    { date: '2026-10-20', calls: 0, inputTokens: 0, outputTokens: 0 },
  ],
  callsWithoutTokens: 1,
}

describe('UsagePanel', () => {
  it('总数、按功能、按天；没调用的天留空；没返回 token 数的调用有说明', async () => {
    installButler({ 'ai:usage': USAGE })
    render(<UsagePanel />)
    expect(await screen.findByText(/调用 4 次，输入 12,345 token，输出 678 token/)).toBeTruthy()
    expect(screen.getByText('有 1 次调用接口没有返回 token 数，只算了次数。')).toBeTruthy()
    const byFeature = within(screen.getByRole('table', { name: '本周管家用量，按功能' }))
    expect(byFeature.getByRole('row', { name: /聊天 3 345 78/ })).toBeTruthy()
    expect(byFeature.getByRole('row', { name: /排计划 1 12,000 600/ })).toBeTruthy()
    expect(byFeature.queryByText('复盘检验')).toBeNull()
    const byDay = within(screen.getByRole('table', { name: '本周管家用量，按天' }))
    const rows = byDay.getAllByRole('row').slice(1)
    expect(rows[0]?.textContent).toContain('10-19 周一')
    expect(rows[1]?.textContent).toBe('10-20 周二')
  })

  it('这周还没用过：一句话说明，不显示空表格', async () => {
    installButler({ 'ai:usage': { ...USAGE, total: { calls: 0, inputTokens: 0, outputTokens: 0 }, byFeature: {}, callsWithoutTokens: 0 } })
    render(<UsagePanel />)
    expect(await screen.findByText(/还没有调用过管家/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
