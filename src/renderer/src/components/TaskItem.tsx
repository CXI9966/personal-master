import { useEffect, useState, type ReactNode } from 'react'
import type { Task } from '../../../shared/schema'

interface Props {
  task: Task
  /** 返回 Promise<boolean> 时，false 表示失败，勾选框会恢复原样 */
  onToggle: (done: boolean) => void | Promise<boolean>
  disabled?: boolean
  /** 右侧的操作按钮 */
  children?: ReactNode
}

/** 一行任务：勾选框（名字就是任务标题）、截止日期、操作按钮 */
export default function TaskItem({ task, onToggle, disabled, children }: Props) {
  // 点了马上显示新状态，不等主进程往返一圈；主进程的结果回来（任务状态变了）或失败时再对齐
  const [pending, setPending] = useState<boolean | null>(null)
  useEffect(() => setPending(null), [task.status])
  const done = pending ?? task.status === 'done'

  function toggle(checked: boolean): void {
    setPending(checked)
    void Promise.resolve(onToggle(checked)).then((ok) => {
      if (ok === false) setPending(null)
    })
  }

  return (
    <li className="task">
      <label className="task-check">
        <input type="checkbox" checked={done} disabled={disabled} onChange={(e) => toggle(e.target.checked)} />
        <span className={done ? 'task-title done' : 'task-title'}>{task.title}</span>
      </label>
      {task.due && !done && <span className="due">截止 {task.due}</span>}
      {task.checkpoints.length > 0 && <span className="meta">检验点：{task.checkpoints.join('；')}</span>}
      {children && <span className="task-actions">{children}</span>}
    </li>
  )
}
