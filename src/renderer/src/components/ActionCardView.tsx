import type { ActionCard, CardStatus } from '../../../shared/ai'
import { useAction } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'

const STATUS_TEXT: Record<CardStatus, string> = {
  applied: '已执行',
  pending: '需要你确认',
  cancelled: '已取消',
  failed: '没成功',
  undone: '已撤销',
}

interface Props {
  card: ActionCard
  /** 确认、取消、撤销之后换上最新的卡片 */
  onChange: (card: ActionCard) => void
}

/** 管家提出的一个动作：小改动已经执行（可以撤销），大改动等你确认 */
export default function ActionCardView({ card, onChange }: Props) {
  const { data: last } = useSnapshot('history:last')
  const act = useAction()
  // 只有它还是最近一次改动时才能撤销，之后又有新改动就撤销不了了
  const canUndo = card.status === 'applied' && card.changeId !== undefined && last?.id === card.changeId

  const answer = (accept: boolean) =>
    act.run(async () => onChange(await window.butler.invoke('ai:confirm', { cardId: card.id, accept })))

  const undo = () =>
    act.run(async () => {
      if (await window.butler.invoke('history:undo', { changeId: card.changeId as string })) onChange({ ...card, status: 'undone' })
    })

  return (
    <li className={`action-card status-${card.status}`}>
      <span className="badge">{STATUS_TEXT[card.status]}</span>
      <span className="action-summary">{card.summary}</span>
      {card.status === 'pending' && (
        <span className="task-actions">
          <button type="button" className="primary" disabled={act.busy} aria-label={`确认：${card.summary}`} onClick={() => answer(true)}>
            确认
          </button>
          <button type="button" disabled={act.busy} aria-label={`取消：${card.summary}`} onClick={() => answer(false)}>
            取消
          </button>
        </span>
      )}
      {canUndo && (
        <button type="button" disabled={act.busy} aria-label={`撤销：${card.summary}`} onClick={undo}>
          撤销
        </button>
      )}
      {card.status === 'failed' && card.error && <span className="error">{card.error}</span>}
      {act.error && <span className="error">{act.error}</span>}
    </li>
  )
}
