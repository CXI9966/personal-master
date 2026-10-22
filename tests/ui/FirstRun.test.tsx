import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import FirstRun from '../../src/renderer/src/pages/FirstRun'
import type { AiStatus } from '../../src/shared/ai'
import type { AppState } from '../../src/shared/views'
import { installButler } from './butlerMock'

const INITIAL: AppState = { workspaceRoot: null, initialized: false, defaultRoot: 'C:\\文档\\Butler' }
const OPENED: AppState = { workspaceRoot: 'D:\\我的工作区', initialized: true, defaultRoot: INITIAL.defaultRoot }
const NO_MODEL: AiStatus = {
  provider: { kind: 'openai-compatible', baseURL: '', model: '' },
  contextStrategy: 'scene',
  actionMode: 'tools',
  hasKey: false,
  encryptionAvailable: true,
  configured: false,
}

describe('FirstRun', () => {
  it('第 1 步：默认文件夹已经填好', () => {
    installButler()
    render(<FirstRun initial={INITIAL} onDone={vi.fn()} />)
    expect(screen.getByRole('heading', { name: '欢迎使用 Butler' })).toBeTruthy()
    expect(screen.getByText('第 1 步，共 3 步')).toBeTruthy()
    expect((screen.getByLabelText('工作区文件夹') as HTMLInputElement).value).toBe('C:\\文档\\Butler')
  })

  it('点“选择文件夹…”：选了就换成新路径，取消就保持原样', async () => {
    const user = userEvent.setup()
    let picked: string | null = 'D:\\我的工作区'
    installButler({ 'workspace:pick': () => picked })
    render(<FirstRun initial={INITIAL} onDone={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '选择文件夹…' }))
    await waitFor(() => expect((screen.getByLabelText('工作区文件夹') as HTMLInputElement).value).toBe('D:\\我的工作区'))
    picked = null
    await user.click(screen.getByRole('button', { name: '选择文件夹…' }))
    expect((screen.getByLabelText('工作区文件夹') as HTMLInputElement).value).toBe('D:\\我的工作区')
  })

  it('新文件夹：选人格（默认战友教练）→ 初始化 → 第 3 步可以跳过模型接口，然后才进主界面', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    const butler = installButler({
      'workspace:inspect': { exists: false, initialized: false },
      'workspace:init': OPENED,
      'ai:status': NO_MODEL,
    })
    render(<FirstRun initial={INITIAL} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: '下一步' }))

    expect(await screen.findByText('第 2 步，共 3 步')).toBeTruthy()
    expect((screen.getByRole('radio', { name: /战友教练/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    await user.click(screen.getByRole('radio', { name: /温和陪伴/ }))
    await user.click(screen.getByRole('button', { name: '下一步' }))

    expect(await screen.findByText('第 3 步，共 3 步')).toBeTruthy()
    expect(butler.callsOf('workspace:init')).toEqual([{ root: 'C:\\文档\\Butler', persona: 'gentle' }])
    expect(onDone).not.toHaveBeenCalled() // 还在第 3 步，没进主界面
    await user.click(await screen.findByRole('button', { name: '跳过，以后再填' }))
    expect(onDone).toHaveBeenCalledWith(OPENED)
  })

  it('第 3 步填了模型接口：保存之后进入主界面', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    const butler = installButler({
      'workspace:inspect': { exists: false, initialized: false },
      'workspace:init': OPENED,
      'ai:status': NO_MODEL,
      'ai:save': undefined,
    })
    render(<FirstRun initial={INITIAL} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(await screen.findByRole('button', { name: '下一步' }))
    await user.type(await screen.findByLabelText('接口地址'), 'https://api.example.com/v1')
    await user.type(screen.getByLabelText('模型名'), 'my-model')
    await user.type(screen.getByLabelText('API key'), 'sk-abc')
    await user.click(screen.getByRole('button', { name: '保存并开始用' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(OPENED))
    expect(butler.callsOf('ai:save')).toEqual([
      {
        provider: { kind: 'openai-compatible', baseURL: 'https://api.example.com/v1', model: 'my-model' },
        contextStrategy: 'scene',
        actionMode: 'tools',
        apiKey: 'sk-abc',
      },
    ])
  })

  it('已经初始化过的文件夹：直接打开，不用再选人格和填模型', async () => {
    const user = userEvent.setup()
    const onDone = vi.fn()
    const butler = installButler({
      'workspace:inspect': { exists: true, initialized: true },
      'workspace:open': OPENED,
    })
    render(<FirstRun initial={INITIAL} onDone={onDone} />)
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(OPENED))
    expect(screen.queryByText('第 2 步，共 3 步')).toBeNull()
    expect(butler.callsOf('workspace:open')).toEqual([{ root: 'C:\\文档\\Butler' }])
    expect(butler.callsOf('workspace:init')).toEqual([])
  })

  it('可以从第 2 步退回第 1 步', async () => {
    const user = userEvent.setup()
    installButler({ 'workspace:inspect': { exists: false, initialized: false } })
    render(<FirstRun initial={INITIAL} onDone={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '下一步' }))
    await user.click(await screen.findByRole('button', { name: '上一步' }))
    expect(screen.getByText('第 1 步，共 3 步')).toBeTruthy()
  })

  it('文件夹为空：提示一下，不调用主进程', async () => {
    const user = userEvent.setup()
    const butler = installButler()
    render(<FirstRun initial={INITIAL} onDone={vi.fn()} />)
    await user.clear(screen.getByLabelText('工作区文件夹'))
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect((await screen.findByRole('alert')).textContent).toBe('请先选一个文件夹')
    expect(butler.invoke).not.toHaveBeenCalled()
  })

  it('主进程报错：显示错误原因，停在当前这一步', async () => {
    const user = userEvent.setup()
    installButler({
      'workspace:inspect': () => {
        throw new Error('没有权限访问这个文件夹')
      },
    })
    render(<FirstRun initial={INITIAL} onDone={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: '下一步' }))
    expect((await screen.findByRole('alert')).textContent).toBe('没有权限访问这个文件夹')
    expect(screen.getByText('第 1 步，共 3 步')).toBeTruthy()
  })
})
