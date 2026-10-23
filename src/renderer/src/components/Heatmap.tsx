import { useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { weekdayName } from '../../../shared/calendar'
import type { HeatCell } from '../../../shared/views'

interface Props {
  cells: HeatCell[]
  /** 辅助技术读到的名字，例如“最近 12 周的记录” */
  label: string
  selected: string | null
  onSelect: (date: string) => void
}

export function cellLabel(cell: HeatCell): string {
  if (cell.future) return `${cell.date}（还没到）`
  const state = cell.score > 0 ? `${cell.score} 分` : '没有记录'
  return `${cell.date} ${weekdayName(cell.date)}，${state}`
}

/**
 * GitHub 式的日历热力图：每列一周（周一在上），颜色越深当天做的越多。
 * 只有一个格子在 Tab 顺序里（选中的或今天），方向键在格子间移动：左右跳一周，上下跳一天。
 */
export default function Heatmap({ cells, label, selected, onSelect }: Props) {
  const grid = useRef<HTMLDivElement>(null)
  const todayIndex = cells.findLastIndex((cell) => !cell.future)
  const selectedIndex = selected ? cells.findIndex((cell) => cell.date === selected) : -1
  const tabStop = selectedIndex >= 0 ? selectedIndex : todayIndex

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = { ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 }[event.key]
    if (step === undefined) return
    const current = Number((event.target as HTMLElement).dataset.index)
    const next = current + step
    if (!Number.isInteger(current) || next < 0 || next >= cells.length) return
    event.preventDefault()
    grid.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus()
  }

  return (
    <div>
      <div className="heatmap-scroll">
        <div ref={grid} className="heatmap" role="group" aria-label={label} onKeyDown={onKeyDown}>
          {cells.map((cell, index) => (
            <button
              key={cell.date}
              type="button"
              data-index={index}
              className={`heat heat-${cell.level}${cell.future ? ' future' : ''}`}
              aria-label={cellLabel(cell)}
              aria-pressed={selected === cell.date}
              aria-disabled={cell.future || undefined}
              style={{ '--c': Math.floor(index / 7) } as CSSProperties}
              tabIndex={index === tabStop ? 0 : -1}
              title={cellLabel(cell)}
              onClick={() => !cell.future && onSelect(cell.date)}
            />
          ))}
        </div>
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>少</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className={`heat heat-${level}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  )
}
