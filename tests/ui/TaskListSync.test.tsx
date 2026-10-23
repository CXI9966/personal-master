import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import TaskForm from '../../src/renderer/src/components/TaskForm'
import Tasks from '../../src/renderer/src/pages/Tasks'
import type { TasksFile } from '../../src/shared/schema'
import { installButler, type ButlerMock } from './butlerMock'
import { task } from './fixtures'

/** 像真的主进程一样：改了清单就更新数据，再推 data:changed 让页面重新读 */
function setup(initial: TasksFile) {
  let current = structuredClone(initial)
  const changed = (): void => butler.emit('data:changed', { reason: 'local' })
  const butler: ButlerMock = installButler({
    'tasks:get': () => current,
    'tasks:add': undefined,
    'tasks:update': undefined,
    'lists:add': ({ name }: { name: string }) => {
      current = { ...current, lists: [...current.lists, name.trim()] }
      changed()
    },
    'lists:rename': ({ from, to }: { from: string; to: string }) => {
      current = {
        ...current,
        lists: current.lists.map((list) => (list === from ? to : list)),
        tasks: current.tasks.map((t) => (t.list === from ? { ...t, list: to } : t)),
      }
      changed()
    },
    'lists:remove': ({ name }: { name: string }) => {
      current = { ...current, lists: current.lists.filter((list) => list !== name) }
      changed()
    },
  })
  render(<Tasks />)
  return butler
}

const FILE: TasksFile = {
  version: 1,
  lists: ['收集箱', '学习', '临时'],
  tasks: [task(1, { title: '写周报' }), task(2, { title: '看电机手册', list: '学习' })],
}

const newTaskForm = async () => within(await screen.findByRole('region', { name: '新建任务' }))
const listSelect = async () => (await newTaskForm()).getByLabelText('清单') as HTMLSelectElement

async function renameList(user: ReturnType<typeof userEvent.setup>, from: string, to: string): Promise<void> {
  await user.click(await screen.findByRole('button', { name: `重命名清单：${from}` }))
  const input = screen.getByLabelText('新的清单名')
  await user.clear(input)
  await user.type(input, to)
  await user.click(screen.getByRole('button', { name: '保存' }))
}

describe('新建任务表单的清单要跟着清单的变化走', () => {
  it('先写了标题，再把当前清单改名：表单跟着改成新名字，标题还在，任务进新名字的清单', async () => {
    const user = userEvent.setup()
    const butler = setup(FILE)
    await user.type((await newTaskForm()).getByLabelText('任务标题'), '读书笔记')
    await renameList(user, '收集箱', '学业任务')
    await screen.findByRole('heading', { name: '学业任务' })
    await waitFor(async () => expect((await listSelect()).value).toBe('学业任务'))
    expect(((await newTaskForm()).getByLabelText('任务标题') as HTMLInputElement).value).toBe('读书笔记')

    await user.click((await newTaskForm()).getByRole('button', { name: '添加任务' }))
    expect(butler.callsOf('tasks:add')).toMatchObject([{ title: '读书笔记', list: '学业任务' }])
  })

  it('改的是别的清单：表单选着的清单不变', async () => {
    const user = userEvent.setup()
    const butler = setup(FILE)
    await user.selectOptions(await listSelect(), '学习')
    await renameList(user, '临时', '杂事')
    await screen.findByRole('heading', { name: '杂事' })
    expect((await listSelect()).value).toBe('学习')
    await user.type((await newTaskForm()).getByLabelText('任务标题'), '读论文')
    await user.click((await newTaskForm()).getByRole('button', { name: '添加任务' }))
    expect(butler.callsOf('tasks:add')).toMatchObject([{ list: '学习' }])
  })

  it('先写了标题，再新建一个清单：表单自动选上新清单，标题还在', async () => {
    const user = userEvent.setup()
    const butler = setup(FILE)
    await user.type((await newTaskForm()).getByLabelText('任务标题'), '读书笔记')
    await user.type(screen.getByLabelText('清单名'), '学业任务')
    await user.click(screen.getByRole('button', { name: '添加清单' }))
    await screen.findByRole('heading', { name: '学业任务' })
    await waitFor(async () => expect((await listSelect()).value).toBe('学业任务'))

    await user.click((await newTaskForm()).getByRole('button', { name: '添加任务' }))
    expect(butler.callsOf('tasks:add')).toMatchObject([{ title: '读书笔记', list: '学业任务' }])
  })

  it('选着的清单被删掉了：退回第一个清单，看到的就是提交的', async () => {
    const user = userEvent.setup()
    const butler = setup(FILE)
    await user.selectOptions(await listSelect(), '临时')
    await user.click(await screen.findByRole('button', { name: '删除清单：临时' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: '临时' })).toBeNull())
    expect((await listSelect()).value).toBe('收集箱')
    await user.type((await newTaskForm()).getByLabelText('任务标题'), '随手记')
    await user.click((await newTaskForm()).getByRole('button', { name: '添加任务' }))
    expect(butler.callsOf('tasks:add')).toMatchObject([{ list: '收集箱' }])
  })

  it('编辑任务时它所在的清单被改名：表单显示新名字，保存不会把任务挪走', async () => {
    const user = userEvent.setup()
    const butler = setup(FILE)
    await user.click(await screen.findByRole('button', { name: '编辑：看电机手册' }))
    const editForm = () => within(screen.getByRole('button', { name: '保存修改' }).closest('form')!) // 改名后这块会重新生成，每次现找
    expect((editForm().getByLabelText('清单') as HTMLSelectElement).value).toBe('学习')
    await renameList(user, '学习', '电机学习')
    await screen.findByRole('heading', { name: '电机学习' })
    await waitFor(() => expect((editForm().getByLabelText('清单') as HTMLSelectElement).value).toBe('电机学习'))
    await user.click(editForm().getByRole('button', { name: '保存修改' }))
    expect(butler.callsOf('tasks:update')).toMatchObject([{ patch: { list: '电机学习' } }])
  })
})

describe('TaskForm：选中的清单不在了', () => {
  const initial = { title: '看电机手册', list: '学习', due: null, checkpoints: [], notes: '' }

  it('清单列表变了、原来选的没了：显示的和提交的都是任务现在所在的清单', async () => {
    const user = userEvent.setup()
    const submitted: string[] = []
    const props = { idPrefix: 'edit', submitLabel: '保存修改', busy: false, onSubmit: async (input: { list?: string }) => (submitted.push(input.list ?? ''), true) }
    const { rerender } = render(<TaskForm {...props} lists={['收集箱', '学习']} initial={initial} />)
    rerender(<TaskForm {...props} lists={['收集箱', '电机学习']} initial={{ ...initial, list: '电机学习' }} />)
    expect((screen.getByLabelText('清单') as HTMLSelectElement).value).toBe('电机学习')
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    expect(submitted).toEqual(['电机学习'])
  })

  it('新建表单：选的清单没了又没有别的线索：退回第一个', async () => {
    const user = userEvent.setup()
    const submitted: string[] = []
    const props = { idPrefix: 'new', submitLabel: '添加任务', busy: false, onSubmit: async (input: { list?: string }) => (submitted.push(input.list ?? ''), true) }
    const { rerender } = render(<TaskForm {...props} lists={['收集箱', '学习']} />)
    await user.selectOptions(screen.getByLabelText('清单'), '学习')
    rerender(<TaskForm {...props} lists={['收集箱']} />)
    await user.type(screen.getByLabelText('任务标题'), '随手记')
    await user.click(screen.getByRole('button', { name: '添加任务' }))
    expect(submitted).toEqual(['收集箱'])
  })
})
