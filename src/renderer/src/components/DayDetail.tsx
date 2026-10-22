import { clockOf } from '../../../shared/calendar'
import { RESULT_LABELS, SOURCE_LABELS } from '../../../shared/labels'
import { useSnapshot } from '../hooks/useSnapshot'
import { ErrorNote } from './Notices'

/** 点热力图格子后看到的：那一天都做了什么 */
export default function DayDetail({ date, onClose }: { date: string; onClose: () => void }) {
  const { data, error } = useSnapshot('day:get', { date })
  if (error) return <ErrorNote message={error} />
  if (!data) return <p className="hint">加载中…</p>

  const empty =
    data.score === 0 &&
    !data.plan.review &&
    data.plan.timeline.length === 0 &&
    data.planTasks.length === 0 &&
    data.doneTasks.length === 0
  const checkin = (label: string, c: typeof data.wake) => (c ? <li>{`${label}：${clockOf(c.at)}（${SOURCE_LABELS[c.source]}）`}</li> : null)

  return (
    <section className="card day-detail" aria-label={`${date} 的记录`}>
      <header className="card-header">
        <h3>
          {data.date} {data.weekday} · {data.score > 0 ? `${data.score} 分` : '没有记录'}
        </h3>
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </header>
      {empty && <p className="hint">这一天没有记录，没关系，从今天开始就好。</p>}
      <ul>
        {checkin('起床', data.wake)}
        {checkin('睡前', data.sleep)}
        {data.plan.timeline.map((item) => (
          <li key={`${item.start}-${item.title}`}>{`${item.start}-${item.end} ${item.title}`}</li>
        ))}
        {data.planTasks.map((task) => (
          <li key={task.id}>{`计划任务：${task.title}${task.status === 'done' ? '（已完成）' : ''}`}</li>
        ))}
        {data.doneTasks.map((task) => (
          <li key={`done-${task.id}`}>{`完成：${task.title}`}</li>
        ))}
        {data.weights.map((w) => (
          <li key={w.id}>{`体重：${w.kg} kg`}</li>
        ))}
        {data.workouts.map((w) => (
          <li key={w.id}>{`健身：${w.summary}${w.durationMin ? `（${w.durationMin} 分钟）` : ''}`}</li>
        ))}
        {data.learning.flatMap((entry) =>
          entry.checks.map((check) => <li key={`${entry.id}-${check.q}`}>{`检验（${entry.topic}）：${check.q} → ${RESULT_LABELS[check.result]}`}</li>),
        )}
        {data.plan.review && (
          <li>
            复盘：完成了 {data.plan.review.done || '—'}；学会了 {data.plan.review.learned || '—'}；明天改 {data.plan.review.change || '—'}
          </li>
        )}
      </ul>
    </section>
  )
}
