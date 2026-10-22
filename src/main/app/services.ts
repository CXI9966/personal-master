// 对数据的改动都从这里走：界面的 IPC、托盘菜单、以后的管家动作共用同一套服务，
// 保证同样的操作不管从哪来，规则、历史记录和刷新通知都一样。

import { PATHS } from '../../shared/paths'
import { Checkin, TasksFile } from '../../shared/schema'
import { nowISO } from '../domain/day'
import { completeTask } from '../domain/tasks'
import { loadTasks } from '../domain/load'
import type { Tx } from '../store/types'
import type { AppContext } from './context'

/** 一次改动：打包成一条可以整体撤销的记录，写完后通知刷新。出错时不通知 */
export async function mutate<T>(ctx: AppContext, label: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await ctx.ws.batch(label, fn)
  ctx.changed()
  return result
}

/** 起床/睡前打卡。同一天点多次都会记下，显示和计分时再取舍 */
export function addCheckin(ctx: AppContext, type: Checkin['type']): Promise<void> {
  return mutate(ctx, type === 'wake' ? '起床打卡' : '睡前打卡', (tx) =>
    tx.appendLine(PATHS.checkins, { id: ctx.newId(), type, at: nowISO(ctx.now()), source: 'desktop' }, Checkin),
  )
}

export function completeTaskById(ctx: AppContext, taskId: string): Promise<void> {
  return mutate(ctx, '完成任务', async (tx) => {
    const tasks = completeTask(await loadTasks(tx), taskId, nowISO(ctx.now()))
    await tx.writeJson(PATHS.tasks, tasks, TasksFile)
  })
}

/** 撤销最近一次改动；它已经不是最近一次时返回 false */
export async function undoChange(ctx: AppContext, changeId: string): Promise<boolean> {
  const undone = await ctx.ws.undo(changeId)
  if (undone) ctx.changed()
  return undone
}

/** 数据文件整个坏了时，恢复成最近一份历史备份 */
export async function restoreFile(ctx: AppContext, rel: string): Promise<boolean> {
  const restored = await ctx.ws.restoreFromHistory(rel)
  if (restored) ctx.changed()
  return restored
}
