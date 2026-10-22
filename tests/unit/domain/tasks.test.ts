import { describe, expect, it } from 'vitest'
import { DomainError } from '../../../src/main/domain/errors'
import {
  addList,
  addTask,
  completeTask,
  deleteTask,
  dropTask,
  findTask,
  openTasks,
  removeList,
  renameList,
  reopenTask,
  updateTask,
} from '../../../src/main/domain/tasks'
import { emptyTasks, TasksFile, type TasksFile as TasksFileType } from '../../../src/shared/schema'

const NOW = '2026-10-23T08:00:00+08:00'
const LATER = '2026-10-23T20:00:00+08:00'
const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function withTasks(...titles: string[]): TasksFileType {
  return titles.reduce((file, title, i) => addTask(file, { title }, { id: id(i + 1), now: NOW }), emptyTasks())
}

describe('addTask', () => {
  it('加到默认清单，状态是 open，其余字段是空值', () => {
    const file = addTask(emptyTasks(), { title: '  写周报  ' }, { id: id(1), now: NOW })
    expect(file.tasks).toEqual([
      {
        id: id(1),
        title: '写周报',
        list: '收集箱',
        status: 'open',
        createdAt: NOW,
        doneAt: null,
        due: null,
        checkpoints: [],
        notes: '',
      },
    ])
  })

  it('指定的清单不存在就自动创建', () => {
    const file = addTask(emptyTasks(), { title: 'a', list: '学习' }, { id: id(1), now: NOW })
    expect(file.lists).toEqual(['收集箱', '学习'])
  })

  it('空标题、错误的截止日期报 invalid', () => {
    expect(() => addTask(emptyTasks(), { title: '   ' }, { id: id(1), now: NOW })).toThrowError(DomainError)
    expect(() => addTask(emptyTasks(), { title: 'a', due: '明天' }, { id: id(1), now: NOW })).toThrow(/YYYY-MM-DD/)
  })

  it('不修改传入的对象，结果通过 schema 校验，用户手加的字段保留', () => {
    const before = { ...emptyTasks(), 手写: 1 } as TasksFileType
    const snapshot = JSON.stringify(before)
    const after = addTask(before, { title: 'a' }, { id: id(1), now: NOW })
    expect(JSON.stringify(before)).toBe(snapshot)
    expect(TasksFile.safeParse(after).success).toBe(true)
    expect(after).toMatchObject({ 手写: 1 })
  })
})

describe('更新、完成、放弃、删除', () => {
  it('updateTask 只改给出的字段', () => {
    const file = updateTask(withTasks('a'), id(1), { title: 'b', due: '2026-10-30', notes: '备注' })
    expect(findTask(file, id(1))).toMatchObject({ title: 'b', due: '2026-10-30', notes: '备注', list: '收集箱' })
  })

  it('updateTask 换到不存在的清单会创建它；可以把截止日期清成 null', () => {
    let file = updateTask(withTasks('a'), id(1), { list: 'RM', due: '2026-10-30' })
    expect(file.lists).toContain('RM')
    file = updateTask(file, id(1), { due: null })
    expect(findTask(file, id(1)).due).toBeNull()
  })

  it('completeTask 记下完成时间；重复完成不改第一次的时间', () => {
    let file = completeTask(withTasks('a'), id(1), NOW)
    expect(findTask(file, id(1))).toMatchObject({ status: 'done', doneAt: NOW })
    file = completeTask(file, id(1), LATER)
    expect(findTask(file, id(1)).doneAt).toBe(NOW)
  })

  it('reopenTask 回到 open 并清掉完成时间；dropTask 标记放弃', () => {
    let file = reopenTask(completeTask(withTasks('a', 'b'), id(1), NOW), id(1))
    expect(findTask(file, id(1))).toMatchObject({ status: 'open', doneAt: null })
    file = dropTask(file, id(2))
    expect(findTask(file, id(2)).status).toBe('dropped')
  })

  it('deleteTask 真正删掉', () => {
    const file = deleteTask(withTasks('a', 'b'), id(1))
    expect(file.tasks.map((t) => t.title)).toEqual(['b'])
  })

  it('找不到任务时报 not-found', () => {
    expect(() => completeTask(withTasks('a'), id(9), NOW)).toThrowError(expect.objectContaining({ code: 'not-found' }))
    expect(() => findTask(withTasks('a'), id(9))).toThrowError(DomainError)
  })

  it('openTasks 只返回未完成的，可以按清单过滤', () => {
    let file = withTasks('a', 'b', 'c')
    file = updateTask(file, id(2), { list: 'RM' })
    file = completeTask(file, id(3), NOW)
    expect(openTasks(file).map((t) => t.title)).toEqual(['a', 'b'])
    expect(openTasks(file, 'RM').map((t) => t.title)).toEqual(['b'])
  })
})

describe('清单', () => {
  it('addList 去重、去空白，空名字报错', () => {
    expect(addList(emptyTasks(), ' 学习 ').lists).toEqual(['收集箱', '学习'])
    expect(addList(emptyTasks(), '收集箱').lists).toEqual(['收集箱'])
    expect(() => addList(emptyTasks(), ' ')).toThrowError(DomainError)
  })

  it('renameList 同时改任务；目标已存在或源不存在报错', () => {
    let file = addTask(emptyTasks(), { title: 'a', list: '学习' }, { id: id(1), now: NOW })
    file = renameList(file, '学习', '课程')
    expect(file.lists).toEqual(['收集箱', '课程'])
    expect(findTask(file, id(1)).list).toBe('课程')
    expect(() => renameList(file, '课程', '收集箱')).toThrowError(DomainError)
    expect(() => renameList(file, '不存在', 'x')).toThrowError(DomainError)
  })

  it('removeList 只能删空的、非默认的清单', () => {
    let file = addTask(emptyTasks(), { title: 'a', list: '学习' }, { id: id(1), now: NOW })
    expect(() => removeList(file, '学习')).toThrow(/还有任务/)
    expect(() => removeList(file, '收集箱')).toThrow(/默认/)
    file = deleteTask(file, id(1))
    expect(removeList(file, '学习').lists).toEqual(['收集箱'])
  })
})
