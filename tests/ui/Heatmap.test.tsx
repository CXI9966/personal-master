import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Heatmap from '../../src/renderer/src/components/Heatmap'
import { makeCells } from './fixtures'

// 2026-10-12（周一）起 21 格，三周；今天是 2026-10-23（第 12 格），之后是 future
const TODAY = '2026-10-23'
const cells = makeCells('2026-10-12', 21, TODAY, { '2026-10-20': 3, '2026-10-22': 9 })

const renderMap = (selected: string | null = null, onSelect = vi.fn()) => {
  render(<Heatmap cells={cells} label="最近三周的记录" selected={selected} onSelect={onSelect} />)
  return onSelect
}

describe('Heatmap', () => {
  it('每个格子都有文字说明：日期、星期、分数；没记录就说没有记录；今天之后说还没到', () => {
    renderMap()
    expect(screen.getByRole('button', { name: '2026-10-20 周二，3 分' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '2026-10-21 周三，没有记录' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '2026-10-24（还没到）' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('颜色深浅用 heat-N 类表示', () => {
    renderMap()
    expect(screen.getByRole('button', { name: /2026-10-20/ }).className).toContain('heat-2')
    expect(screen.getByRole('button', { name: /2026-10-22/ }).className).toContain('heat-4')
    expect(screen.getByRole('button', { name: /2026-10-21/ }).className).toContain('heat-0')
    expect(screen.getByRole('button', { name: /2026-10-25/ }).className).toContain('future')
  })

  it('点格子选中；点今天之后的格子没有反应；选中的格子 aria-pressed', async () => {
    const user = userEvent.setup()
    const onSelect = renderMap('2026-10-20')
    expect(screen.getByRole('button', { name: /2026-10-20/ }).getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: /2026-10-21/ }))
    expect(onSelect).toHaveBeenCalledWith('2026-10-21')
    onSelect.mockClear()
    await user.click(screen.getByRole('button', { name: '2026-10-24（还没到）' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('整个热力图在 Tab 顺序里只有一个停靠点：默认是今天，选中后换成选中的格子', () => {
    const { rerender } = render(<Heatmap cells={cells} label="x" selected={null} onSelect={vi.fn()} />)
    const stops = () => screen.getAllByRole('button').filter((b) => b.getAttribute('tabindex') === '0')
    expect(stops().map((b) => b.getAttribute('aria-label'))).toEqual(['2026-10-23 周五，没有记录'])
    rerender(<Heatmap cells={cells} label="x" selected="2026-10-14" onSelect={vi.fn()} />)
    expect(stops().map((b) => b.getAttribute('aria-label'))).toEqual(['2026-10-14 周三，没有记录'])
  })

  it('方向键移动焦点：左右跳一周，上下跳一天，到边界不动', () => {
    renderMap()
    const today = screen.getByRole('button', { name: /2026-10-23/ })
    today.focus()
    fireEvent.keyDown(today, { key: 'ArrowLeft' })
    expect(document.activeElement?.getAttribute('aria-label')).toContain('2026-10-16')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement?.getAttribute('aria-label')).toContain('2026-10-17')
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(document.activeElement?.getAttribute('aria-label')).toContain('2026-10-15')

    const first = screen.getByRole('button', { name: /2026-10-12/ })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowLeft' })
    fireEvent.keyDown(first, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
  })

  it('整个图有名字，图例对辅助技术隐藏', () => {
    renderMap()
    expect(screen.getByRole('group', { name: '最近三周的记录' })).toBeTruthy()
    expect(screen.getByText('少').parentElement?.getAttribute('aria-hidden')).toBe('true')
  })
})
