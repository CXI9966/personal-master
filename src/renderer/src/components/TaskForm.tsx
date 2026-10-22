import { useState, type FormEvent } from 'react'
import type { NewTaskInput } from '../../../shared/views'

interface Props {
  lists: string[]
  initial?: { title: string; list: string; due: string | null; checkpoints: string[]; notes: string }
  /** 提交按钮上的字 */
  submitLabel: string
  /** 区分页面上多个表单，用在 aria-label 和 id 里 */
  idPrefix: string
  busy: boolean
  /** 成功返回 true；新建表单成功后会清空，编辑表单由调用方关掉 */
  onSubmit: (input: NewTaskInput) => Promise<boolean>
  onCancel?: () => void
}

const splitCheckpoints = (text: string): string[] =>
  text
    .split(/[；;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)

/** 新建和编辑任务共用的表单 */
export default function TaskForm({ lists, initial, submitLabel, idPrefix, busy, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [list, setList] = useState(initial?.list ?? lists[0] ?? '')
  const [due, setDue] = useState(initial?.due ?? '')
  const [checkpoints, setCheckpoints] = useState(initial?.checkpoints.join('；') ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const ok = await onSubmit({ title, list, due: due || null, checkpoints: splitCheckpoints(checkpoints), notes })
    if (ok && !initial) {
      setTitle('')
      setDue('')
      setCheckpoints('')
      setNotes('')
    }
  }

  return (
    <form className="task-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor={`${idPrefix}-title`}>任务标题</label>
        <input id={`${idPrefix}-title`} type="text" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor={`${idPrefix}-list`}>清单</label>
          <select id={`${idPrefix}-list`} value={list} onChange={(e) => setList(e.target.value)}>
            {lists.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-due`}>截止日期（可不填）</label>
          <input id={`${idPrefix}-due`} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-checkpoints`}>检验点（可不填，用分号分开）</label>
        <input id={`${idPrefix}-checkpoints`} type="text" value={checkpoints} onChange={(e) => setCheckpoints(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-notes`}>备注（可不填）</label>
        <input id={`${idPrefix}-notes`} type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            取消
          </button>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {submitLabel}
        </button>
      </div>
    </form>
  )
}
