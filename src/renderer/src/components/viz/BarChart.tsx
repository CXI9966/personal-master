import type { CSSProperties } from 'react'

export interface Bar {
  label: string
  value: number
  /** 鼠标放上去显示的完整说明 */
  hint?: string
}

/** 柱状图：柱子依次从底部长出来。label 是读屏软件听到的话，具体数字在每根柱子下面和提示里 */
export default function BarChart({ items, label, unit = '' }: { items: Bar[]; label: string; unit?: string }) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return (
    <div className="bars" role="img" aria-label={label}>
      {items.map((item, index) => (
        <div
          className="bar"
          key={`${item.label}-${index}`}
          title={item.hint ?? `${item.label}：${item.value}${unit}`}
          style={{ '--i': index, '--h': `${(item.value / max) * 100}%` } as CSSProperties}
        >
          <div className="bar-track">
            <i />
          </div>
          <span className="bar-label">
            {item.label}
            <small>{item.value}</small>
          </span>
        </div>
      ))}
    </div>
  )
}
