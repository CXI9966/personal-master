import { useState, type FormEvent } from 'react'
import { clockOf } from '../../../shared/calendar'
import type { Review } from '../../../shared/schema'

interface Props {
  review: Review | null
  busy: boolean
  onSave: (input: { done: string; learned: string; change: string }) => Promise<boolean>
}

/** 晚间复盘：三句话。保存后可以接着改 */
export default function ReviewForm({ review, busy, onSave }: Props) {
  const [done, setDone] = useState(review?.done ?? '')
  const [learned, setLearned] = useState(review?.learned ?? '')
  const [change, setChange] = useState(review?.change ?? '')

  function submit(event: FormEvent): void {
    event.preventDefault()
    void onSave({ done, learned, change })
  }

  return (
    <form className="review-form" onSubmit={submit}>
      <label htmlFor="review-done">完成了什么</label>
      <textarea id="review-done" rows={2} value={done} onChange={(e) => setDone(e.target.value)} />
      <label htmlFor="review-learned">学会了什么</label>
      <textarea id="review-learned" rows={2} value={learned} onChange={(e) => setLearned(e.target.value)} />
      <label htmlFor="review-change">明天改什么</label>
      <textarea id="review-change" rows={2} value={change} onChange={(e) => setChange(e.target.value)} />
      <div className="actions">
        {review && <span className="hint">已保存（{clockOf(review.at)}）</span>}
        <button type="submit" className="primary" disabled={busy}>
          保存复盘
        </button>
      </div>
    </form>
  )
}
