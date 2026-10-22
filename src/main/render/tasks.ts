import { clockOf } from '../../shared/calendar'
import type { Task } from '../../shared/schema'
import { withMarker } from './common'
import { taskLine } from './today'

function details(task: Task): string[] {
  const lines: string[] = []
  if (task.checkpoints.length > 0) lines.push(`  - 检验点：${task.checkpoints.join('；')}`)
  if (task.notes.trim()) lines.push(`  - 备注：${task.notes.trim().replace(/\r?\n/g, ' ')}`)
  return lines
}

/** 一个清单一份文件：进行中、已完成、已放弃 */
export function renderTaskList(list: string, tasks: Task[]): string {
  const mine = tasks.filter((t) => t.list === list)
  const open = mine.filter((t) => t.status === 'open')
  const done = mine.filter((t) => t.status === 'done')
  const dropped = mine.filter((t) => t.status === 'dropped')
  const lines = [`# 任务库 · ${list}`, '', '## 进行中']
  if (open.length === 0) lines.push('- 没有进行中的任务')
  for (const task of open) lines.push(taskLine(task), ...details(task))

  lines.push('', '## 已完成')
  if (done.length === 0) lines.push('- 还没有完成的任务')
  for (const task of done) {
    const when = task.doneAt ? `（${task.doneAt.slice(0, 10)} ${clockOf(task.doneAt)} 完成）` : ''
    lines.push(`- [x] ${task.title}${when}`, ...details(task))
  }

  if (dropped.length > 0) {
    lines.push('', '## 已放弃')
    for (const task of dropped) lines.push(`- ${task.title}`)
  }
  return withMarker(lines.join('\n'))
}
