import { PATHS } from '../../shared/paths'
import { TasksFile, type Task } from '../../shared/schema'
import type { NewTaskInput, TaskPatch } from '../../shared/views'
import { nowISO } from '../domain/day'
import { loadTasks } from '../domain/load'
import { addTaskToPlan, removeTaskFromPlan } from '../domain/plan'
import {
  addList,
  addTask,
  completeTask,
  deleteTask,
  dropTask,
  findTask,
  removeList,
  renameList,
  reopenTask,
  updateTask,
} from '../domain/tasks'
import type { Tx } from '../store/types'
import type { AppContext } from './context'
import { mutate } from './services'
import { editTodayPlan } from './services-plan'

const saveTasks = (tx: Tx, tasks: TasksFile): Promise<void> => tx.writeJson(PATHS.tasks, tasks, TasksFile)

/** 新建任务。addToToday 时同一次改动里把它排进今天的计划，撤销时一起撤掉 */
export function createTask(ctx: AppContext, input: NewTaskInput & { addToToday?: boolean }): Promise<Task> {
  return mutate(ctx, '新建任务', async (tx) => {
    const id = ctx.newId()
    const { addToToday, ...rest } = input
    const tasks = addTask(await loadTasks(tx), rest, { id, now: nowISO(ctx.now()) })
    await saveTasks(tx, tasks)
    if (addToToday) await editTodayPlan(tx, ctx, (plan) => addTaskToPlan(plan, id))
    return findTask(tasks, id)
  })
}

export const editTask = (ctx: AppContext, id: string, patch: TaskPatch): Promise<void> =>
  mutate(ctx, '修改任务', async (tx) => saveTasks(tx, updateTask(await loadTasks(tx), id, patch)))

export function changeTaskStatus(ctx: AppContext, id: string, status: Task['status']): Promise<void> {
  const label = status === 'done' ? '完成任务' : status === 'dropped' ? '放弃任务' : '重新打开任务'
  return mutate(ctx, label, async (tx) => {
    const tasks = await loadTasks(tx)
    const next =
      status === 'done' ? completeTask(tasks, id, nowISO(ctx.now())) : status === 'dropped' ? dropTask(tasks, id) : reopenTask(tasks, id)
    await saveTasks(tx, next)
  })
}

/** 删除任务，同时从今天的计划里拿掉 */
export const removeTask = (ctx: AppContext, id: string): Promise<void> =>
  mutate(ctx, '删除任务', async (tx) => {
    await saveTasks(tx, deleteTask(await loadTasks(tx), id))
    await editTodayPlan(tx, ctx, (plan) => removeTaskFromPlan(plan, id))
  })

/** 批量改截止日期（管家用）：一次改动，可以整体撤销 */
export const rescheduleTasks = (ctx: AppContext, items: Array<{ id: string; due: string | null }>): Promise<void> =>
  mutate(ctx, '批量改截止日期', async (tx) => {
    let tasks = await loadTasks(tx)
    for (const item of items) tasks = updateTask(tasks, item.id, { due: item.due })
    await saveTasks(tx, tasks)
  })

export const createList =(ctx: AppContext, name: string): Promise<void> =>
  mutate(ctx, '新建清单', async (tx) => saveTasks(tx, addList(await loadTasks(tx), name)))

export const changeListName = (ctx: AppContext, from: string, to: string): Promise<void> =>
  mutate(ctx, '重命名清单', async (tx) => saveTasks(tx, renameList(await loadTasks(tx), from, to)))

export const deleteList = (ctx: AppContext, name: string): Promise<void> =>
  mutate(ctx, '删除清单', async (tx) => saveTasks(tx, removeList(await loadTasks(tx), name)))
