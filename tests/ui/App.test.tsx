import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '../../src/renderer/src/App'
import { installButler } from './butlerMock'
import { todayFixture } from './fixtures'

describe('App', () => {
  it('还没有工作区：显示第一次运行页', async () => {
    installButler({ 'app:state': { workspaceRoot: null, initialized: false, defaultRoot: 'C:\\文档\\Butler' } })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '欢迎使用 Butler' })).toBeTruthy()
  })

  it('已经有工作区：进入主界面，默认是今日页', async () => {
    installButler({
      'app:state': { workspaceRoot: 'D:\\我的工作区', initialized: true, defaultRoot: '' },
      'today:get': todayFixture(),
      'history:last': null,
      'data:health': [],
    })
    render(<App />)
    expect(await screen.findByRole('heading', { name: '今日' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeTruthy()
  })

  it('读取状态失败：显示错误', async () => {
    installButler({
      'app:state': () => {
        throw new Error('主进程没有响应')
      },
    })
    render(<App />)
    expect((await screen.findByRole('alert')).textContent).toBe('主进程没有响应')
  })

  it('加载期间显示“加载中…”', () => {
    installButler({ 'app:state': () => new Promise(() => undefined) })
    render(<App />)
    expect(screen.getByText('加载中…')).toBeTruthy()
  })
})
