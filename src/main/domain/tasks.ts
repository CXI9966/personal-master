import { DEFAULT_LIST, YMD, type Task, type TasksFile } from '../../shared/schema'
import type { NewTaskInput, TaskPatch } from '../../shared/views'
import { DomainError } from './errors'

export type { NewTaskInput, TaskPatch }

function cleanTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw new DomainError('invalid', '任务标题不能为空')
  return trimmed
}

function checkDue(due: string | null | undefined): void {
  if (due != null && !YMD.safeParse(due).success) {
    throw new DomainError('invalid', `截止日期格式应为 YYYY-MM-DD：${due}`)
  }
}

function withList(file: TasksFile, list: string): string[] {
  return file.lists.includes(list) ? file.lists : [...file.lists, list]
}

export function findTask(file: TasksFile, id: string): Task {
  const task = file.tasks.find((t) => t.id === id)
  if (!task) throw new DomainError('not-found', `找不到任务：${id}`)
  return task
}

function mapTask(file: TasksFile, id: string, change: (task: Task) => Task): TasksFile {
  findTask(file, id)
  return { ...file, tasks: file.tasks.map((t) => (t.id === id ? change(t) : t)) }
}

export function addTask(file: TasksFile, input: NewTaskInput, ctx: { id: string; now: string }): TasksFile {
  const title = cleanTitle(input.title)
  checkDue(input.due)
  const list = input.list?.trim() || DEFAULT_LIST
  const task: Task = {
    id: ctx.id,
    title,
    list,
    status: 'open',
    createdAt: ctx.now,
    doneAt: null,
    due: input.due ?? null,
    checkpoints: input.checkpoints ?? [],
    notes: input.notes ?? '',
  }
  return { ...file, lists: withList(file, list), tasks: [...file.tasks, task] }
}

export function updateTask(file: TasksFile, id: string, patch: TaskPatch): TasksFile {
  if (patch.title !== undefined) cleanTitle(patch.title)
  checkDue(patch.due)
  const list = patch.list?.trim()
  const updated = mapTask(file, id, (task) => ({
    ...task,
    ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    ...(list ? { list } : {}),
    ...(patch.due !== undefined ? { due: patch.due } : {}),
    ...(patch.checkpoints !== undefined ? { checkpoints: patch.checkpoints } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
  }))
  return list ? { ...updated, lists: withList(updated, list) } : updated
}

/** 重复完成不会改掉第一次的完成时间 */
export function completeTask(file: TasksFile, id: string, now: string): TasksFile {
  return mapTask(file, id, (task) => (task.status === 'done' ? task : { ...task, status: 'done', doneAt: now }))
}

export function reopenTask(file: TasksFile, id: string): TasksFile {
  return mapTask(file, id, (task) => ({ ...task, status: 'open', doneAt: null }))
}

export function dropTask(file: TasksFile, id: string): TasksFile {
  return mapTask(file, id, (task) => ({ ...task, status: 'dropped', doneAt: null }))
}

export function deleteTask(file: TasksFile, id: string): TasksFile {
  findTask(file, id)
  return { ...file, tasks: file.tasks.filter((t) => t.id !== id) }
}

export function openTasks(file: TasksFile, list?: string): Task[] {
  return file.tasks.filter((t) => t.status === 'open' && (list === undefined || t.list === list))
}

export function addList(file: TasksFile, name: string): TasksFile {
  const trimmed = name.trim()
  if (!trimmed) throw new DomainError('invalid', '清单名不能为空')
  return file.lists.includes(trimmed) ? file : { ...file, lists: [...file.lists, trimmed] }
}

export function renameList(file: TasksFile, from: string, to: string): TasksFile {
  const next = to.trim()
  if (!next) throw new DomainError('invalid', '清单名不能为空')
  if (!file.lists.includes(from)) throw new DomainError('not-found', `找不到清单：${from}`)
  if (file.lists.includes(next)) throw new DomainError('invalid', `清单已经存在：${next}`)
  return {
    ...file,
    lists: file.lists.map((l) => (l === from ? next : l)),
    tasks: file.tasks.map((t) => (t.list === from ? { ...t, list: next } : t)),
  }
}

export function removeList(file: TasksFile, name: string): TasksFile {
  if (name === DEFAULT_LIST) throw new DomainError('invalid', `默认清单“${DEFAULT_LIST}”不能删除`)
  if (!file.lists.includes(name)) throw new DomainError('not-found', `找不到清单：${name}`)
  if (file.tasks.some((t) => t.list === name)) throw new DomainError('invalid', `清单“${name}”里还有任务，先移走或删除它们`)
  return { ...file, lists: file.lists.filter((l) => l !== name) }
}
