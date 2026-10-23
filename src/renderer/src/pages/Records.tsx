import { useState, type FormEvent } from 'react'
import DayDetail from '../components/DayDetail'
import Heatmap from '../components/Heatmap'
import { ErrorNote, Warnings } from '../components/Notices'
import { CheckinTable, LearningList, WeightTable, WorkoutTable } from '../components/RecordTables'
import WeeklyReports from '../components/WeeklyReports'
import BarChart from '../components/viz/BarChart'
import LineChart from '../components/viz/LineChart'
import { hourText, lastSevenDays, weightPoints, wakePoints } from '../components/viz/stats'
import { weekdayName } from '../../../shared/calendar'
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

      <section className="card" aria-labelledby="week-title">
        <h2 id="week-title">最近 7 天的得分</h2>
        <BarChart
          label="最近 7 天每天的得分"
          unit=" 分"
          items={lastSevenDays(data.heatmap).map((day) => ({ label: weekdayName(day.date), value: day.score, hint: `${day.date} ${weekdayName(day.date)}：${day.score} 分` }))}
        />
      </section>

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
        {wakePoints(data.checkins).length >= 2 && (
          <>
            <p className="hint">最近几天的起床时间（越低越早）</p>
            <LineChart points={wakePoints(data.checkins)} label="最近几天的起床时间曲线" format={hourText} />
          </>
        )}
        <details className="fold">
          <summary>查看打卡明细</summary>
          <CheckinTable rows={data.checkins} />
        </details>
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
        <LineChart points={weightPoints(data.weights)} label="体重变化曲线" format={(kg) => `${kg} kg`} target={data.weightTargetKg} />
        <details className="fold">
          <summary>查看体重明细</summary>
          <WeightTable weights={data.weights} targetKg={data.weightTargetKg} />
        </details>
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
