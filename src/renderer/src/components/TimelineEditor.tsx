import { useState, type FormEvent } from 'react'
import type { FixedItem, TimelineItem } from '../../../shared/schema'

interface Props {
  items: TimelineItem[]
  /** 今天对应的每周固定安排，可以一键加进时间安排 */
  fixed: FixedItem[]
  busy: boolean
  /** 整个替换时间安排；成功返回 true */
  onChange: (items: TimelineItem[]) => Promise<boolean>
}

const same = (a: TimelineItem, b: FixedItem): boolean => a.start === b.start && a.end === b.end && a.title === b.title

export default function TimelineEditor({ items, fixed, busy, onChange }: Props) {
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [title, setTitle] = useState('')

  async function add(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (await onChange([...items, { start, end, title, taskId: null }])) {
      setStart('')
      setEnd('')
      setTitle('')
    }
  }

  const pendingFixed = fixed.filter((f) => !items.some((item) => same(item, f)))

  return (
    <div>
      {pendingFixed.length > 0 && (
        <div className="fixed-hints">
          <p className="hint">今天的固定安排：</p>
          <ul>
            {pendingFixed.map((f) => (
              <li key={`${f.start}-${f.title}`}>
                {`${f.start}-${f.end} ${f.title}`}{' '}
                <button type="button" disabled={busy} onClick={() => onChange([...items, { start: f.start, end: f.end, title: f.title, taskId: null }])}>
                  加入时间安排
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {items.length === 0 ? (
        <p className="hint">还没有安排，可以在下面加。</p>
      ) : (
        <ul className="timeline">
          {items.map((item, index) => (
            <li key={`${item.start}-${item.title}-${index}`}>
              <span className="time">{`${item.start}-${item.end}`}</span> {item.title}{' '}
              <button type="button" disabled={busy} aria-label={`删除：${item.start}-${item.end} ${item.title}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="inline-form" onSubmit={add}>
        <input type="time" aria-label="开始时间" value={start} onChange={(e) => setStart(e.target.value)} required />
        <span aria-hidden="true">至</span>
        <input type="time" aria-label="结束时间" value={end} onChange={(e) => setEnd(e.target.value)} required />
        <input type="text" aria-label="安排内容" placeholder="做什么" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <button type="submit" disabled={busy}>
          添加安排
        </button>
      </form>
    </div>
  )
}
