import { useState, type FormEvent } from 'react'
import { defaultSettings, type HeatmapWeights, type SettingsFile } from '../../../shared/schema'
import type { Action } from '../hooks/useAction'

const WEIGHT_LABELS: Array<[keyof HeatmapWeights, string]> = [
  ['checkin', '打卡（起床、睡前各算一次）'],
  ['taskDone', '完成一个任务'],
  ['weight', '记体重（每天最多算一次）'],
  ['workout', '健身一次'],
  ['review', '完成复盘'],
  ['learnMastered', '检验：每道题掌握'],
  ['learnPartial', '检验：每道题部分掌握'],
  ['learnMissed', '检验：每道题没掌握'],
]

/** 一天从几点开始算，以及日历每一项记多少分 */
export default function SettingsGeneral({ settings, act }: { settings: SettingsFile; act: Action }) {
  const [dayStartsAt, setDayStartsAt] = useState(settings.dayStartsAt)
  const [weights, setWeights] = useState<Record<string, string>>(
    Object.fromEntries(WEIGHT_LABELS.map(([key]) => [key, String(settings.heatmap.weights[key])])),
  )

  const saveDay = (event: FormEvent): Promise<boolean> => {
    event.preventDefault()
    return act.run(() => window.butler.invoke('settings:update', { dayStartsAt }))
  }

  const saveWeights = (event: FormEvent): Promise<boolean> => {
    event.preventDefault()
    const parsed = Object.fromEntries(WEIGHT_LABELS.map(([key]) => [key, Number(weights[key])])) as unknown as HeatmapWeights
    return act.run(() => window.butler.invoke('settings:update', { weights: parsed }))
  }

  async function resetWeights(): Promise<void> {
    const defaults = defaultSettings().heatmap.weights
    if (await act.run(() => window.butler.invoke('settings:update', { weights: defaults }))) {
      setWeights(Object.fromEntries(WEIGHT_LABELS.map(([key]) => [key, String(defaults[key])])))
    }
  }

  return (
    <>
      <section className="card" aria-labelledby="day-title">
        <h2 id="day-title">一天从几点开始算</h2>
        <p className="hint">这个时间之前的记录算前一天。比如设成 04:00，凌晨 00:30 的“睡前打卡”算前一天。</p>
        <form className="inline-form" onSubmit={saveDay}>
          <input type="time" aria-label="一天开始的时间" value={dayStartsAt} onChange={(e) => setDayStartsAt(e.target.value)} required />
          <button type="submit" disabled={act.busy}>保存</button>
        </form>
      </section>

      <section className="card" aria-labelledby="weights-title">
        <h2 id="weights-title">日历计分</h2>
        <p className="hint">日历格子的深浅按每天的总分算，颜色是跟你自己的过去比出来的。</p>
        <form onSubmit={saveWeights}>
          <div className="weights">
            {WEIGHT_LABELS.map(([key, label]) => (
              <div className="field" key={key}>
                <label htmlFor={`weight-${key}`}>{label}</label>
                <input
                  id={`weight-${key}`}
                  type="number"
                  min="0"
                  step="0.5"
                  value={weights[key]}
                  onChange={(e) => setWeights({ ...weights, [key]: e.target.value })}
                  required
                />
              </div>
            ))}
          </div>
          <div className="actions">
            <button type="button" disabled={act.busy} onClick={resetWeights}>恢复默认</button>
            <button type="submit" className="primary" disabled={act.busy}>保存计分</button>
          </div>
        </form>
      </section>
    </>
  )
}
