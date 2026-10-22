import { useState } from 'react'
import { useAction } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'
import { usageLine } from '../../../shared/usageText'
import { ErrorNote } from './Notices'

const dayOf = (iso: string): string => iso.slice(0, 10)

/** 已经结束的几周的小结：做到的事、管家用量，以及管家的点评（点一下才会调用模型） */
export default function WeeklyReports() {
  const { data, error } = useSnapshot('weekly:list')
  const act = useAction()
  const [pending, setPending] = useState<string | null>(null)

  if (error) return <ErrorNote message={error} />
  if (!data) return <p className="hint">加载中…</p>
  if (data.length === 0) return <p className="hint">还没有周报：一周结束、而且这周有记录之后，这里会出现那一周的小结。</p>

  async function comment(weekStart: string): Promise<void> {
    setPending(weekStart)
    await act.run(() => window.butler.invoke('weekly:comment', { weekStart }))
    setPending(null)
  }

  return (
    <div>
      <ErrorNote message={act.error} />
      {data.map((report, index) => (
        <details className="week-report" key={report.weekStart} open={index === 0}>
          <summary>
            {report.weekKey}（{report.weekStart.slice(5)} ~ {report.weekEnd.slice(5)}）
          </summary>
          <ul>
            {report.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="hint">管家用量：{usageLine(report.usage)}</p>
          {report.comment && (
            <blockquote className="week-comment">
              <p>{report.comment.text}</p>
              <footer className="hint">管家点评于 {dayOf(report.comment.at)}</footer>
            </blockquote>
          )}
          <div className="actions">
            <button type="button" disabled={act.busy} onClick={() => void comment(report.weekStart)}>
              {pending === report.weekStart ? '管家正在写…' : report.comment ? '重新点评' : '让管家点评'}
            </button>
          </div>
        </details>
      ))}
    </div>
  )
}
