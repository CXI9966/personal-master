import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TaskItem from '../../src/renderer/src/components/TaskItem'
import { task } from './fixtures'

describe('TaskItem 的勾选框', () => {
  it('点了马上显示新状态，不等主进程', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn(() => new Promise<boolean>(() => undefined)) // 主进程一直没回应
    render(<ul><TaskItem task={task(1)} onToggle={onToggle} /></ul>)
    const box = screen.getByRole('checkbox', { name: '任务1' }) as HTMLInputElement
    await user.click(box)
    expect(box.checked).toBe(true)
    expect(onToggle).toHaveBeenCalledWith(true)
  })

  it('操作失败（返回 false）：恢复成原来的样子', async () => {
    const user = userEvent.setup()
    render(<ul><TaskItem task={task(1)} onToggle={async () => false} /></ul>)
    const box = screen.getByRole('checkbox', { name: '任务1' }) as HTMLInputElement
    await user.click(box)
    await waitFor(() => expect(box.checked).toBe(false))
  })

  it('任务状态变了（主进程的结果回来）就以它为准', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<ul><TaskItem task={task(1)} onToggle={async () => true} /></ul>)
    await user.click(screen.getByRole('checkbox', { name: '任务1' }))
    rerender(<ul><TaskItem task={task(1, { status: 'done', doneAt: '2026-10-23T10:00:00+08:00' })} onToggle={async () => true} /></ul>)
    expect((screen.getByRole('checkbox', { name: '任务1' }) as HTMLInputElement).checked).toBe(true)
    rerender(<ul><TaskItem task={task(1)} onToggle={async () => true} /></ul>)
    expect((screen.getByRole('checkbox', { name: '任务1' }) as HTMLInputElement).checked).toBe(false)
  })
})
