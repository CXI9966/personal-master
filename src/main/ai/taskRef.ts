import type { Task } from '../../shared/schema'
import { DomainError } from '../domain/errors'

/** 给模型看的任务编号：UUID 的前 8 位，省 token，也不容易抄错 */
export const shortId = (id: string): string => id.slice(0, 8)

/**
 * 模型传来的任务编号 → 真正的任务。接受完整编号或唯一的前缀（至少 6 位）。
 * 找不到时的报错会列出现有编号，方便模型重试时改对。
 */
export function resolveTaskRef(tasks: Task[], ref: string): Task {
  const key = ref.trim().toLowerCase()
  const exact = tasks.find((task) => task.id.toLowerCase() === key)
  if (exact) return exact
  if (key.length >= 6) {
    const matches = tasks.filter((task) => task.id.toLowerCase().startsWith(key))
    if (matches.length === 1) return matches[0] as Task
    if (matches.length > 1) throw new DomainError('invalid', `任务编号 ${ref} 对应不止一个任务，请用更长的编号`)
  }
  const known = tasks.slice(0, 30).map((task) => shortId(task.id))
  throw new DomainError('not-found', `找不到任务 ${ref}。现有任务编号：${known.length > 0 ? known.join('、') : '（还没有任务）'}`)
}
