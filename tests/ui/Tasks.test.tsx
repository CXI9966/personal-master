import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import Tasks from '../../src/renderer/src/pages/Tasks'
import type { TasksFile } from '../../src/shared/schema'
import { installButler } from './butlerMock'
import { task } from './fixtures'

const FILE: TasksFile = {
  version: 1,
  lists: ['收集箱', '学习'],
  tasks: [
    task(1, { title: '写周报', due: '2026-10-30' }),
    task(2, { title: '看电机手册', list: '学习', checkpoints: ['为什么堵转电流大'] }),
    task(3, { title: '交报告', status: 'done', doneAt: '2026-10-22T10:00:00+08:00' }),
    task(4, { title: '旧想法', status: 'dropped' }),
  ],
}

function setup(file: TasksFile = FILE) {
  const butler = installButler({
    'tasks:get': () => file,
    'tasks:add': undefined,
    'tasks:update': undefined,
    'tasks:status': undefined,
    'tasks:delete': undefined,
    'lists:add': undefined,
    'lists:rename': undefined,
    'lists:remove': undefined,
  })
  render(<Tasks />)
  return butler
}

const idOf = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('任务页：显示', () => {
  it('每个清单一块；进行中的任务在外面，已完成和已放弃折叠在里面', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: '收集箱' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '学习' })).toBeTruthy()
    expect(screen.getByText('截止 2026-10-30')).toBeTruthy()
    expect(screen.getByText('检验点：为什么堵转电流大')).toBeTruthy()
    expect(screen.getByText('已完成（1）')).toBeTruthy()
    expect(screen.getByText('已放弃（1）')).toBeTruthy()
  })

  it('没有进行中的任务时有提示', async () => {
    setup({ version: 1, lists: ['收集箱'], tasks: [] })
    expect(await screen.findByText('这个清单里没有进行中的任务')).toBeTruthy()
  })
})

describe('任务页：新建', () => {
  it('填标题、清单、截止日期、检验点，一起发给主进程', async () => {
    const user = userEvent.setup()
    const butler = setup()
    const form = within(await screen.findByRole('region', { name: '新建任务' }))
    await user.type(form.getByLabelText('任务标题'), '读论文')
    await user.selectOptions(form.getByLabelText('清单'), '学习')
    fireEvent.change(form.getByLabelText('截止日期（可不填）'), { target: { value: '2026-11-01' } })
    await user.type(form.getByLabelText('检验点（可不填，用分号分开）'), '问题一；问题二')
    await user.click(form.getByRole('button', { name: '添加任务' }))
    expect(butler.callsOf('tasks:add')).toEqual([
      { title: '读论文', list: '学习', due: '2026-11-01', checkpoints: ['问题一', '问题二'], notes: '' },
    ])
    expect((form.getByLabelText('任务标题') as HTMLInputElement).value).toBe('')
  })

  it('什么都不填截止日期就是 null', async () => {
    const user = userEvent.setup()
    const butler = setup()
    const form = within(await screen.findByRole('region', { name: '新建任务' }))
    await user.type(form.getByLabelText('任务标题'), 'A')
    await user.click(form.getByRole('button', { name: '添加任务' }))
    expect(butler.callsOf('tasks:add')).toEqual([{ title: 'A', list: '收集箱', due: null, checkpoints: [], notes: '' }])
  })
})

describe('任务页：操作', () => {
  it('勾选完成；放弃；删除', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.click(await screen.findByRole('checkbox', { name: '写周报' }))
    await user.click(screen.getByRole('button', { name: '放弃：看电机手册' }))
    await user.click(screen.getByRole('button', { name: '删除：写周报' }))
    expect(butler.callsOf('tasks:status')).toEqual([
      { id: idOf(1), status: 'done' },
      { id: idOf(2), status: 'dropped' },
    ])
    expect(butler.callsOf('tasks:delete')).toEqual([{ id: idOf(1) }])
  })

  it('编辑：表单里带着原来的内容，保存后只发修改', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.click(await screen.findByRole('button', { name: '编辑：写周报' }))
    const title = screen.getByDisplayValue('写周报')
    await user.clear(title)
    await user.type(title, '写周报和总结')
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(butler.callsOf('tasks:update')).toEqual([
      { id: idOf(1), patch: { title: '写周报和总结', list: '收集箱', due: '2026-10-30', checkpoints: [], notes: '' } },
    ])
  })

  it('编辑可以取消', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByRole('button', { name: '编辑：写周报' }))
    await user.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('button', { name: '保存修改' })).toBeNull()
  })

  it('已完成的任务取消勾选就是重新打开；已放弃的可以重新打开或删除', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.click(await screen.findByText('已完成（1）'))
    await user.click(screen.getByRole('checkbox', { name: '交报告' }))
    await user.click(screen.getByText('已放弃（1）'))
    await user.click(screen.getByRole('button', { name: '重新打开：旧想法' }))
    expect(butler.callsOf('tasks:status')).toEqual([
      { id: idOf(3), status: 'open' },
      { id: idOf(4), status: 'open' },
    ])
  })
})

describe('任务页：清单', () => {
  it('新建清单', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.type(await screen.findByLabelText('清单名'), '项目')
    await user.click(screen.getByRole('button', { name: '添加清单' }))
    expect(butler.callsOf('lists:add')).toEqual([{ name: '项目' }])
  })

  it('重命名清单', async () => {
    const user = userEvent.setup()
    const butler = setup()
    await user.click(await screen.findByRole('button', { name: '重命名清单：学习' }))
    const input = screen.getByLabelText('新的清单名')
    await user.clear(input)
    await user.type(input, '课程')
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(butler.callsOf('lists:rename')).toEqual([{ from: '学习', to: '课程' }])
  })

  it('只有空的、非默认的清单能删', async () => {
    const user = userEvent.setup()
    const butler = setup({ version: 1, lists: ['收集箱', '空清单', '学习'], tasks: [task(1, { list: '学习' })] })
    await screen.findByRole('heading', { name: '空清单' })
    expect(screen.queryByRole('button', { name: '删除清单：收集箱' })).toBeNull()
    expect(screen.queryByRole('button', { name: '删除清单：学习' })).toBeNull()
    await user.click(screen.getByRole('button', { name: '删除清单：空清单' }))
    expect(butler.callsOf('lists:remove')).toEqual([{ name: '空清单' }])
  })

  it('操作失败：显示原因', async () => {
    const user = userEvent.setup()
    installButler({
      'tasks:get': FILE,
      'lists:add': () => {
        throw new Error('清单已经存在：学习')
      },
    })
    render(<Tasks />)
    await user.type(await screen.findByLabelText('清单名'), '学习')
    await user.click(screen.getByRole('button', { name: '添加清单' }))
    expect((await screen.findByRole('alert')).textContent).toBe('清单已经存在：学习')
  })
})
