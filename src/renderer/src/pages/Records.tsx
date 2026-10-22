import { useState, type FormEvent } from 'react'
import DayDetail from '../components/DayDetail'
import Heatmap from '../components/Heatmap'
import { ErrorNote, Warnings } from '../components/Notices'
import { CheckinTable, LearningList, WeightTable, WorkoutTable } from '../components/RecordTables'
import WeeklyReports from '../components/WeeklyReports'
import { useAction } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'

export default function Records() {
  const { data, error } = useSnapshot('records:get')
  const act = useAction()
  const [selected, setSelected] = useState<string | null>(null)
  const [kg, setKg] = useState('')
  const [summary, setSummary] = useState('')
  const [minutes, setMinutes] = useState('')

  if (error) return <ErrorNote message={error} />
  if (!data) return <p className="hint">加载中…</p>

  async function addWeight(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (await act.run(() => window.butler.invoke('weight:add', { kg: Number(kg) }))) setKg('')
  }

  async function addWorkout(event: FormEvent): Promise<void> {
    event.preventDefault()
    const durationMin = minutes.trim() === '' ? null : Number(minutes)
    if (await act.run(() => window.butler.invoke('workout:add', { summary, durationMin }))) {
      setSummary('')
      setMinutes('')
    }
  }

  return (
    <div>
      <h1>记录</h1>
      <ErrorNote message={act.error} />
      <Warnings warnings={data.warnings} />

      <section className="card" aria-labelledby="year-title">
        <h2 id="year-title">全年日历</h2>
        <Heatmap cells={data.heatmap} label="最近一年的记录" selected={selected} onSelect={(d) => setSelected(d === selected ? null : d)} />
        {selected && <DayDetail date={selected} onClose={() => setSelected(null)} />}
      </section>

      <section className="card" aria-labelledby="weekly-title">
        <h2 id="weekly-title">周报</h2>
        <WeeklyReports />
      </section>

      <section className="card" aria-labelledby="checkins-title">
        <h2 id="checkins-title">打卡</h2>
        <CheckinTable rows={data.checkins} />
      </section>

      <section className="card" aria-labelledby="weight-title">
        <h2 id="weight-title">体重</h2>
        <form className="inline-form" onSubmit={addWeight}>
          <input type="number" step="0.1" min="20" max="300" inputMode="decimal" aria-label="体重（公斤）" value={kg} onChange={(e) => setKg(e.target.value)} required />
          <span aria-hidden="true">kg</span>
          <button type="submit" disabled={act.busy}>
            记体重
          </button>
        </form>
        <WeightTable weights={data.weights} targetKg={data.weightTargetKg} />
      </section>

      <section className="card" aria-labelledby="workout-title">
        <h2 id="workout-title">健身</h2>
        <form className="inline-form" onSubmit={addWorkout}>
          <input type="text" aria-label="健身内容" placeholder="例如：有氧 30 分钟 + 推" value={summary} onChange={(e) => setSummary(e.target.value)} required />
          <input type="number" min="0" aria-label="时长（分钟）" placeholder="分钟" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          <button type="submit" disabled={act.busy}>
            记健身
          </button>
        </form>
        <WorkoutTable workouts={data.workouts} />
      </section>

      <section className="card" aria-labelledby="learning-title">
        <h2 id="learning-title">学习检验</h2>
        <LearningList entries={data.learning} />
      </section>
    </div>
  )
}
