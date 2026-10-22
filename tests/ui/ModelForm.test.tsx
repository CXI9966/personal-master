import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ModelForm from '../../src/renderer/src/components/ModelForm'
import type { AiStatus } from '../../src/shared/ai'
import { installButler } from './butlerMock'

const EMPTY: AiStatus = {
  provider: { kind: 'openai-compatible', baseURL: '', model: '' },
  contextStrategy: 'scene',
  actionMode: 'tools',
  hasKey: false,
  encryptionAvailable: true,
  configured: false,
}
const SAVED: AiStatus = {
  provider: { kind: 'anthropic', baseURL: 'https://proxy.example.com/v1', model: 'claude-x' },
  contextStrategy: 'full',
  actionMode: 'json',
  hasKey: true,
  encryptionAvailable: true,
  configured: true,
}

describe('ModelForm', () => {
  it('已保存的配置会带出来；key 不会（只提示已保存）', async () => {
    installButler({ 'ai:status': SAVED })
    render(<ModelForm />)
    expect(((await screen.findByLabelText('接口类型')) as HTMLSelectElement).value).toBe('anthropic')
    expect((screen.getByLabelText('接口地址') as HTMLInputElement).value).toBe('https://proxy.example.com/v1')
    expect((screen.getByLabelText('模型名') as HTMLInputElement).value).toBe('claude-x')
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('API key') as HTMLInputElement).placeholder).toBe('已保存，不改就留空')
    expect((screen.getByLabelText('每次给管家看哪些内容') as HTMLSelectElement).value).toBe('full')
    expect((screen.getByLabelText('动作模式') as HTMLSelectElement).value).toBe('json')
  })

  it('key 输入框是密码框，提示 key 加密保存在本机', async () => {
    installButler({ 'ai:status': EMPTY })
    render(<ModelForm />)
    expect(((await screen.findByLabelText('API key')) as HTMLInputElement).type).toBe('password')
    expect(screen.getByText(/加密保存在这台电脑上，不会放进工作区/)).toBeTruthy()
  })

  it('保存：地址、模型、选项、key 一起发；key 不改就不带；保存后清空 key 输入框并回调', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    const butler = installButler({ 'ai:status': EMPTY, 'ai:save': undefined })
    render(<ModelForm onSaved={onSaved} />)
    await user.type(await screen.findByLabelText('接口地址'), 'https://api.example.com/v1')
    await user.type(screen.getByLabelText('模型名'), 'm1')
    await user.type(screen.getByLabelText('API key'), 'sk-abc')
    await user.selectOptions(screen.getByLabelText('动作模式'), 'json')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(butler.callsOf('ai:save')).toEqual([
      { provider: { kind: 'openai-compatible', baseURL: 'https://api.example.com/v1', model: 'm1' }, contextStrategy: 'scene', actionMode: 'json', apiKey: 'sk-abc' },
    ])
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('')
  })

  it('已经有 key、这次不改：不带 apiKey', async () => {
    const user = userEvent.setup()
    const butler = installButler({ 'ai:status': SAVED, 'ai:save': undefined })
    render(<ModelForm />)
    await user.click(await screen.findByRole('button', { name: '保存' }))
    expect((butler.callsOf('ai:save')[0] as { apiKey?: string }).apiKey).toBeUndefined()
  })

  it('测试连接：用表单里现在的内容（包括还没保存的 key），成功和失败都显示', async () => {
    const user = userEvent.setup()
    const butler = installButler({ 'ai:status': EMPTY, 'ai:test': { ok: true, reply: '好', inputTokens: 9, outputTokens: 1 } })
    render(<ModelForm />)
    await user.type(await screen.findByLabelText('接口地址'), 'http://x/v1')
    await user.type(screen.getByLabelText('模型名'), 'm')
    await user.type(screen.getByLabelText('API key'), 'sk-draft')
    await user.click(screen.getByRole('button', { name: '测试连接' }))
    expect((await screen.findByRole('status')).textContent).toBe('连接成功，模型回复：好')
    expect(butler.callsOf('ai:test')).toEqual([{ provider: { kind: 'openai-compatible', baseURL: 'http://x/v1', model: 'm' }, apiKey: 'sk-draft' }])
  })

  it('测试失败：显示能照着检查的原因', async () => {
    const user = userEvent.setup()
    installButler({ 'ai:status': EMPTY, 'ai:test': { ok: false, message: '接口拒绝了密钥（401）：请检查 API key 是否正确、有没有过期。' } })
    render(<ModelForm />)
    await user.click(await screen.findByRole('button', { name: '测试连接' }))
    expect((await screen.findByRole('status')).textContent).toContain('401')
  })

  it('保存失败（比如不能加密）：显示原因，不回调', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    installButler({ 'ai:status': EMPTY, 'ai:save': () => { throw new Error('这台电脑上无法加密保存密钥，所以没有保存') } })
    render(<ModelForm onSaved={onSaved} />)
    await user.type(await screen.findByLabelText('API key'), 'k')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect((await screen.findByRole('alert')).textContent).toBe('这台电脑上无法加密保存密钥，所以没有保存')
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('这台电脑不能加密时给出提醒', async () => {
    installButler({ 'ai:status': { ...EMPTY, encryptionAvailable: false } })
    render(<ModelForm />)
    expect(await screen.findByText(/无法加密保存 key/)).toBeTruthy()
  })

  it('清除已保存的 key；有“跳过”按钮才显示跳过', async () => {
    const user = userEvent.setup()
    const onSkip = vi.fn()
    const butler = installButler({ 'ai:status': SAVED, 'ai:save': undefined })
    render(<ModelForm onSkip={onSkip} />)
    await user.click(await screen.findByRole('button', { name: '清除已保存的 key' }))
    expect(butler.callsOf('ai:save')[0]).toMatchObject({ clearKey: true })
    await user.click(screen.getByRole('button', { name: '跳过，以后再填' }))
    expect(onSkip).toHaveBeenCalled()
  })
})
