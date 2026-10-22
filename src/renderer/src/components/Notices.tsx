import { useAction } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'

/** 最近一次改动，随时可以撤销 */
export function UndoBar() {
  const { data: last } = useSnapshot('history:last')
  const undo = useAction()
  if (!last) return null
  return (
    <div className="undo-bar" role="status">
      <span>最近一次改动：{last.label}</span>
      <button type="button" disabled={undo.busy} onClick={() => undo.run(() => window.butler.invoke('history:undo', { changeId: last.id }))}>
        撤销
      </button>
      {undo.error && <span className="error">{undo.error}</span>}
    </div>
  )
}

/** 核心数据文件读不出来时的提示：说清楚是哪个文件，并给“恢复上一个版本” */
export function HealthBanner() {
  const { data: problems } = useSnapshot('data:health')
  const restore = useAction()
  if (!problems || problems.length === 0) return null
  return (
    <section className="banner danger" role="alert" aria-label="数据文件有问题">
      <strong>有数据文件读不出来</strong>
      <ul>
        {problems.map((problem) => (
          <li key={problem.rel}>
            <span>{problem.message}</span>{' '}
            <button type="button" disabled={restore.busy} onClick={() => restore.run(() => window.butler.invoke('history:restore', { rel: problem.rel }))}>
              恢复上一个版本
            </button>
          </li>
        ))}
      </ul>
      <p className="hint">恢复会用最近一份历史备份覆盖这个文件（这次恢复本身也能撤销）。也可以自己用文本编辑器打开修好。</p>
      {restore.error && <p className="error">{restore.error}</p>}
    </section>
  )
}

/** 被跳过的坏行等警告，默认折叠 */
export function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null
  return (
    <details className="banner">
      <summary>有 {warnings.length} 条数据被跳过了</summary>
      <ul>
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </details>
  )
}

export function ErrorNote({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="error">
      {message}
    </p>
  ) : null
}
