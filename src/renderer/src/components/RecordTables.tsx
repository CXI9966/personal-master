import { clockOf, weekdayName } from '../../../shared/calendar'
import { RESULT_LABELS, SOURCE_LABELS } from '../../../shared/labels'
import type { Checkin, LearningCheck, WeightEntry, Workout } from '../../../shared/schema'
import type { CheckinRow } from '../../../shared/views'

const stamp = (c: Checkin | null): string => (c ? `${clockOf(c.at)}（${SOURCE_LABELS[c.source]}）` : '')
const dateOf = (at: string): string => at.slice(0, 10)

export function CheckinTable({ rows }: { rows: CheckinRow[] }) {
  if (rows.length === 0) return <p className="hint">还没有打卡记录</p>
  return (
    <table>
      <caption className="sr-only">最近的打卡记录</caption>
      <thead>
        <tr>
          <th scope="col">日期</th>
          <th scope="col">起床</th>
          <th scope="col">睡前</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.date}>
            <td>{`${row.date} ${weekdayName(row.date)}`}</td>
            <td>{stamp(row.wake)}</td>
            <td>{stamp(row.sleep)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function WeightTable({ weights, targetKg }: { weights: WeightEntry[]; targetKg: number | null }) {
  if (weights.length === 0) return <p className="hint">还没有体重记录{targetKg !== null && `（目标 ${targetKg} kg）`}</p>
  const rows = weights.map((entry, i) => {
    const prev = weights[i - 1]
    return { entry, delta: prev ? Math.round((entry.kg - prev.kg) * 10) / 10 : null }
  })
  return (
    <>
      {targetKg !== null && <p className="hint">目标 {targetKg} kg</p>}
      <table>
        <caption className="sr-only">体重记录</caption>
        <thead>
          <tr>
            <th scope="col">日期</th>
            <th scope="col">体重（kg）</th>
            <th scope="col">较上次</th>
          </tr>
        </thead>
        <tbody>
          {rows.reverse().map(({ entry, delta }) => (
            <tr key={entry.id}>
              <td>{dateOf(entry.at)}</td>
              <td>{entry.kg}</td>
              <td>{delta === null ? '' : `${delta > 0 ? '+' : ''}${delta}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

export function WorkoutTable({ workouts }: { workouts: Workout[] }) {
  if (workouts.length === 0) return <p className="hint">还没有健身记录</p>
  return (
    <table>
      <caption className="sr-only">健身记录</caption>
      <thead>
        <tr>
          <th scope="col">日期</th>
          <th scope="col">内容</th>
          <th scope="col">时长（分钟）</th>
        </tr>
      </thead>
      <tbody>
        {workouts.map((w) => (
          <tr key={w.id}>
            <td>{dateOf(w.at)}</td>
            <td>{w.summary}</td>
            <td>{w.durationMin ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function LearningList({ entries }: { entries: LearningCheck[] }) {
  if (entries.length === 0) return <p className="hint">还没有检验记录。管家出现后，复盘时会在这里留下检验结果。</p>
  return (
    <ul className="learning">
      {entries.map((entry) => (
        <li key={entry.id}>
          <strong>{`L-${String(entry.seq).padStart(4, '0')} · ${dateOf(entry.at)} · ${entry.topic}`}</strong>
          <ul>
            {entry.checks.map((check) => (
              <li key={check.q}>{`${check.q} → ${RESULT_LABELS[check.result]}`}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}
