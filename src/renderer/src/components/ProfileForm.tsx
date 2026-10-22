import { useState, type FormEvent } from 'react'
import { weekdayLabel } from '../../../shared/calendar'
import type { FixedItem, ProfileFile } from '../../../shared/schema'
import type { Action } from '../hooks/useAction'

const DAYS = [1, 2, 3, 4, 5, 6, 7]

/** 目标、作息、每周固定安排。全部由用户自己填，一个保存按钮 */
export default function ProfileForm({ profile, act }: { profile: ProfileFile; act: Action }) {
  const [target, setTarget] = useState(profile.goals.weightTargetKg === null ? '' : String(profile.goals.weightTargetKg))
  const [notes, setNotes] = useState(profile.goals.notes)
  const [wake, setWake] = useState(profile.schedule.wakeTarget ?? '')
  const [sleep, setSleep] = useState(profile.schedule.sleepTarget ?? '')
  const [gymDays, setGymDays] = useState(profile.schedule.gymDays)
  const [fixed, setFixed] = useState<FixedItem[]>(profile.schedule.fixed)
  const [draft, setDraft] = useState({ weekday: 1, start: '', end: '', title: '' })

  function addFixed(): void {
    if (!draft.start || !draft.end || !draft.title.trim()) return
    setFixed([...fixed, { ...draft, title: draft.title.trim() }])
    setDraft({ ...draft, start: '', end: '', title: '' })
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    const next: ProfileFile = {
      ...profile,
      goals: { ...profile.goals, weightTargetKg: target.trim() === '' ? null : Number(target), notes },
      schedule: { ...profile.schedule, wakeTarget: wake || null, sleepTarget: sleep || null, gymDays, fixed },
    }
    void act.run(() => window.butler.invoke('profile:update', { profile: next }))
  }

  return (
    <form className="card" aria-labelledby="profile-title" onSubmit={save}>
      <h2 id="profile-title">我的目标和作息</h2>
      <p className="hint">这些都由你自己填，管家排计划时会参考。不填也完全可以用。</p>

      <div className="field-row">
        <div className="field">
          <label htmlFor="target-kg">目标体重（kg）</label>
          <input id="target-kg" type="number" step="0.1" min="20" max="300" value={target} onChange={(e) => setTarget(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="wake-target">起床目标</label>
          <input id="wake-target" type="time" value={wake} onChange={(e) => setWake(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sleep-target">睡前目标</label>
          <input id="sleep-target" type="time" value={sleep} onChange={(e) => setSleep(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor="goal-notes">想对自己说的话 / 目标备注</label>
        <textarea id="goal-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <fieldset className="days">
        <legend>健身日</legend>
        {DAYS.map((day) => (
          <label key={day} className="day-check">
            <input
              type="checkbox"
              checked={gymDays.includes(day)}
              onChange={(e) => setGymDays(e.target.checked ? [...gymDays, day].sort() : gymDays.filter((d) => d !== day))}
            />
            {weekdayLabel(day)}
          </label>
        ))}
      </fieldset>

      <h3>每周固定安排</h3>
      {fixed.length === 0 ? (
        <p className="hint">还没有。比如每周的课程、例会。</p>
      ) : (
        <ul>
          {fixed.map((item, index) => (
            <li key={`${item.weekday}-${item.start}-${item.title}-${index}`}>
              {`${weekdayLabel(item.weekday)} ${item.start}-${item.end} ${item.title}`}{' '}
              <button type="button" aria-label={`删除固定安排：${item.title}`} onClick={() => setFixed(fixed.filter((_, i) => i !== index))}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="inline-form">
        <select aria-label="星期" value={draft.weekday} onChange={(e) => setDraft({ ...draft, weekday: Number(e.target.value) })}>
          {DAYS.map((day) => (
            <option key={day} value={day}>
              {weekdayLabel(day)}
            </option>
          ))}
        </select>
        <input type="time" aria-label="固定安排开始时间" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
        <input type="time" aria-label="固定安排结束时间" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
        <input type="text" aria-label="固定安排内容" placeholder="例如：电力电子（课）" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        <button type="button" onClick={addFixed}>添加</button>
      </div>

      <div className="actions">
        <button type="submit" className="primary" disabled={act.busy}>保存目标和作息</button>
      </div>
    </form>
  )
}
