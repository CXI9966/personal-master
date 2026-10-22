import { useState, type FormEvent } from 'react'
import type { TodaySnapshot } from '../../../shared/views'
import type { Action } from '../hooks/useAction'
import TaskItem from './TaskItem'

/** 今天的任务：勾选、移出、新建、从任务库挑、把昨天没做完的接过来 */
export default function TodayTasks({ data, act }: { data: TodaySnapshot; act: Action }) {
  const [title, setTitle] = useState('')
  const [pick, setPick] = useState('')
  const planIds = data.plan.taskIds
  const candidates = data.openTasks.filter((task) => !planIds.includes(task.id))

  const setPlanTasks = (taskIds: string[]): Promise<boolean> =>
    act.run(() => window.butler.invoke('plan:tasks', { taskIds }))

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (await act.run(() => window.butler.invoke('tasks:add', { title, addToToday: true }))) setTitle('')
  }

  async function addPicked(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (pick && (await setPlanTasks([...planIds, pick]))) setPick('')
  }

  return (
    <section className="card" aria-labelledby="tasks-title">
      <h2 id="tasks-title">今日任务</h2>
      {data.planTasks.length === 0 ? (
        <p className="hint">还没有排任务。可以新建一个，或者从任务库里挑。</p>
      ) : (
        <ul className="tasks">
          {data.planTasks.map((task) => (
            <TaskItem
              key={task.id}
              task={task}
              disabled={act.busy}
              onToggle={(done) => act.run(() => window.butler.invoke('tasks:status', { id: task.id, status: done ? 'done' : 'open' }))}
            >
              <button type="button" disabled={act.busy} aria-label={`从今天移除：${task.title}`} onClick={() => setPlanTasks(planIds.filter((id) => id !== task.id))}>
                移出今天
              </button>
            </TaskItem>
          ))}
        </ul>
      )}

      <form className="inline-form" onSubmit={create}>
        <input type="text" aria-label="新任务标题" placeholder="新任务，直接加入今天" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <button type="submit" disabled={act.busy}>
          新建并加入今天
        </button>
      </form>

      {candidates.length > 0 && (
        <form className="inline-form" onSubmit={addPicked}>
          <select aria-label="从任务库挑选" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">从任务库挑一个…</option>
            {candidates.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
          <button type="submit" disabled={act.busy || !pick}>
            加入今天
          </button>
        </form>
      )}

      {data.unfinished.length > 0 && (
        <div className="unfinished">
          <p className="hint">昨天计划里还没做完的：</p>
          <ul>
            {data.unfinished.map((task) => (
              <li key={task.id}>
                {task.title}{' '}
                <button type="button" disabled={act.busy} aria-label={`加入今天：${task.title}`} onClick={() => setPlanTasks([...planIds, task.id])}>
                  加入今天
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
