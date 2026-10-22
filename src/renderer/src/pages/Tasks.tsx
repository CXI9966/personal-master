import { useState, type FormEvent } from 'react'
import { DEFAULT_LIST, type Task } from '../../../shared/schema'
import { ErrorNote } from '../components/Notices'
import TaskForm from '../components/TaskForm'
import TaskItem from '../components/TaskItem'
import { useAction } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'

export default function Tasks() {
  const { data, error } = useSnapshot('tasks:get')
  const act = useAction()
  const [editing, setEditing] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ from: string; to: string } | null>(null)
  const [newList, setNewList] = useState('')

  if (error) return <ErrorNote message={error} />
  if (!data) return <p className="hint">加载中…</p>

  const status = (task: Task, next: Task['status']) => act.run(() => window.butler.invoke('tasks:status', { id: task.id, status: next }))
  const remove = (task: Task) => act.run(() => window.butler.invoke('tasks:delete', { id: task.id }))

  async function addList(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (await act.run(() => window.butler.invoke('lists:add', { name: newList }))) setNewList('')
  }

  async function renameList(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (renaming && (await act.run(() => window.butler.invoke('lists:rename', renaming)))) setRenaming(null)
  }

  return (
    <div>
      <h1>任务</h1>
      <ErrorNote message={act.error} />

      <section className="card" aria-labelledby="new-task-title">
        <h2 id="new-task-title">新建任务</h2>
        <TaskForm
          lists={data.lists}
          idPrefix="new"
          submitLabel="添加任务"
          busy={act.busy}
          onSubmit={(input) => act.run(() => window.butler.invoke('tasks:add', input))}
        />
      </section>

      {data.lists.map((list) => {
        const mine = data.tasks.filter((task) => task.list === list)
        const open = mine.filter((task) => task.status === 'open')
        const done = mine.filter((task) => task.status === 'done')
        const dropped = mine.filter((task) => task.status === 'dropped')
        return (
          <section key={list} className="card" aria-labelledby={`list-${list}`}>
            <header className="card-header">
              {renaming?.from === list ? (
                <form className="inline-form" onSubmit={renameList}>
                  <input type="text" aria-label="新的清单名" value={renaming.to} onChange={(e) => setRenaming({ from: list, to: e.target.value })} required />
                  <button type="submit" disabled={act.busy}>保存</button>
                  <button type="button" onClick={() => setRenaming(null)}>取消</button>
                </form>
              ) : (
                <>
                  <h2 id={`list-${list}`}>{list}</h2>
                  <span className="task-actions">
                    <button type="button" aria-label={`重命名清单：${list}`} onClick={() => setRenaming({ from: list, to: list })}>
                      重命名
                    </button>
                    {list !== DEFAULT_LIST && mine.length === 0 && (
                      <button type="button" aria-label={`删除清单：${list}`} disabled={act.busy} onClick={() => act.run(() => window.butler.invoke('lists:remove', { name: list }))}>
                        删除清单
                      </button>
                    )}
                  </span>
                </>
              )}
            </header>

            {open.length === 0 && <p className="hint">这个清单里没有进行中的任务</p>}
            <ul className="tasks">
              {open.map((task) =>
                editing === task.id ? (
                  <li key={task.id}>
                    <TaskForm
                      lists={data.lists}
                      idPrefix={`edit-${task.id}`}
                      initial={task}
                      submitLabel="保存修改"
                      busy={act.busy}
                      onCancel={() => setEditing(null)}
                      onSubmit={async (input) => {
                        const ok = await act.run(() => window.butler.invoke('tasks:update', { id: task.id, patch: input }))
                        if (ok) setEditing(null)
                        return ok
                      }}
                    />
                  </li>
                ) : (
                  <TaskItem key={task.id} task={task} disabled={act.busy} onToggle={(isDone) => status(task, isDone ? 'done' : 'open')}>
                    <button type="button" aria-label={`编辑：${task.title}`} onClick={() => setEditing(task.id)}>编辑</button>
                    <button type="button" aria-label={`放弃：${task.title}`} disabled={act.busy} onClick={() => status(task, 'dropped')}>放弃</button>
                    <button type="button" aria-label={`删除：${task.title}`} disabled={act.busy} onClick={() => remove(task)}>删除</button>
                  </TaskItem>
                ),
              )}
            </ul>

            {done.length > 0 && (
              <details>
                <summary>已完成（{done.length}）</summary>
                <ul className="tasks">
                  {done.map((task) => (
                    <TaskItem key={task.id} task={task} disabled={act.busy} onToggle={(isDone) => status(task, isDone ? 'done' : 'open')} />
                  ))}
                </ul>
              </details>
            )}
            {dropped.length > 0 && (
              <details>
                <summary>已放弃（{dropped.length}）</summary>
                <ul className="tasks">
                  {dropped.map((task) => (
                    <li key={task.id} className="task">
                      <span className="task-title">{task.title}</span>
                      <span className="task-actions">
                        <button type="button" aria-label={`重新打开：${task.title}`} disabled={act.busy} onClick={() => status(task, 'open')}>重新打开</button>
                        <button type="button" aria-label={`删除：${task.title}`} disabled={act.busy} onClick={() => remove(task)}>删除</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )
      })}

      <section className="card" aria-labelledby="new-list-title">
        <h2 id="new-list-title">新建清单</h2>
        <form className="inline-form" onSubmit={addList}>
          <input type="text" aria-label="清单名" placeholder="例如：学习、项目" value={newList} onChange={(e) => setNewList(e.target.value)} required />
          <button type="submit" disabled={act.busy}>添加清单</button>
        </form>
      </section>
    </div>
  )
}
