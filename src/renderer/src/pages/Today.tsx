import { useState, type FormEvent } from 'react'
import { clockOf, isoWeekOf, weekdayName } from '../../../shared/calendar'
import { ENERGY_LABELS, SOURCE_LABELS } from '../../../shared/labels'
import type { Energy } from '../../../shared/schema'
import DayDetail from '../components/DayDetail'
import Heatmap from '../components/Heatmap'
import { ErrorNote, Warnings } from '../components/Notices'
import ReviewForm from '../components/ReviewForm'
import TimelineEditor from '../components/TimelineEditor'
import TodayTasks from '../components/TodayTasks'
import { useAction } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'

const ENERGIES: Energy[] = ['high', 'mid', 'low']

export default function Today() {
  const { data, error } = useSnapshot('today:get')
  const act = useAction()
  const [selected, setSelected] = useState<string | null>(null)
  const [weight, setWeight] = useState('')

  if (error) return <ErrorNote message={error} />
  if (!data) return <p className="hint">加载中…</p>

  const checkin = (type: 'wake' | 'sleep') => act.run(() => window.butler.invoke('checkin:add', { type }))

  async function addWeight(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (await act.run(() => window.butler.invoke('weight:add', { kg: Number(weight) }))) setWeight('')
  }

  const stamps = [
    data.wake && `起床 ${clockOf(data.wake.at)}（${SOURCE_LABELS[data.wake.source]}）`,
    data.sleep && `睡前 ${clockOf(data.sleep.at)}（${SOURCE_LABELS[data.sleep.source]}）`,
  ].filter(Boolean)

  return (
    <div>
      <h1>今日</h1>
      <p className="hint">
        {data.date} {weekdayName(data.date)} · 第 {isoWeekOf(data.date).week} 周
      </p>
      <ErrorNote message={act.error} />
      <Warnings warnings={data.warnings} />
      {data.welcomeBack && (
        <section className="banner" aria-label="欢迎回来">
          <strong>欢迎回来</strong>
          <p>隔了几天没关系，从今天最想做的一件事开始就好。</p>
        </section>
      )}

      <section className="card" aria-labelledby="checkin-title">
        <h2 id="checkin-title">打卡</h2>
        <div className="row">
          <button type="button" className="primary" disabled={act.busy} onClick={() => checkin('wake')}>
            起床打卡
          </button>
          <button type="button" disabled={act.busy} onClick={() => checkin('sleep')}>
            睡前打卡
          </button>
        </div>
        <p className="hint">{stamps.length > 0 ? stamps.join('；') : '今天还没有打卡'}</p>
      </section>

      <section className="card" aria-labelledby="energy-title">
        <h2 id="energy-title">今天的精力</h2>
        <div className="row">
          {ENERGIES.map((energy) => (
            <button
              key={energy}
              type="button"
              aria-pressed={data.plan.energy === energy}
              disabled={act.busy}
              onClick={() => act.run(() => window.butler.invoke('plan:energy', { energy: data.plan.energy === energy ? null : energy }))}
            >
              {ENERGY_LABELS[energy]}
            </button>
          ))}
        </div>
        <form className="inline-form" onSubmit={addWeight}>
          <input type="number" step="0.1" min="20" max="300" inputMode="decimal" aria-label="体重（公斤）" placeholder="今天的体重" value={weight} onChange={(e) => setWeight(e.target.value)} required />
          <span aria-hidden="true">kg</span>
          <button type="submit" disabled={act.busy}>
            记体重
          </button>
        </form>
      </section>

      <section className="card" aria-labelledby="heat-title">
        <h2 id="heat-title">最近 12 周</h2>
        <Heatmap cells={data.heatmap} label="最近 12 周的记录" selected={selected} onSelect={(d) => setSelected(d === selected ? null : d)} />
        {selected && <DayDetail date={selected} onClose={() => setSelected(null)} />}
      </section>

      <section className="card" aria-labelledby="timeline-title">
        <h2 id="timeline-title">时间安排</h2>
        <TimelineEditor
          items={data.plan.timeline}
          fixed={data.fixedToday}
          busy={act.busy}
          onChange={(items) => act.run(() => window.butler.invoke('plan:timeline', { items }))}
        />
      </section>

      <TodayTasks data={data} act={act} />

      <section className="card" aria-labelledby="review-title">
        <h2 id="review-title">晚间复盘</h2>
        <ReviewForm
          key={data.plan.review?.at ?? 'new'}
          review={data.plan.review}
          busy={act.busy}
          onSave={(input) => act.run(() => window.butler.invoke('plan:review', input))}
        />
      </section>
    </div>
  )
}
