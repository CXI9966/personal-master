import { useId, useState } from 'react'
import type { Point } from './stats'

const W = 320
const H = 130
const PAD = 14

interface Props {
  points: Point[]
  /** 读屏软件听到的一句话概括 */
  label: string
  format?: (value: number) => string
  /** 目标线（比如目标体重）；没有就不画 */
  target?: number | null
}

/** 折线图：线和点依次画出来，鼠标放在点上显示数值，可以带一条目标虚线 */
export default function LineChart({ points, label, format = String, target = null }: Props) {
  const gid = `fill-${useId().replace(/:/g, '')}`
  const [active, setActive] = useState<number | null>(null)
  if (points.length === 0) return <p className="hint">还没有数据。</p>

  const values = points.map((p) => p.value)
  if (target !== null) values.push(target)
  const low = Math.min(...values)
  const high = Math.max(...values)
  const margin = (high - low || 1) * 0.15
  const top = high + margin
  const bottom = low - margin
  const x = (i: number): number => (points.length === 1 ? W / 2 : PAD + (i * (W - PAD * 2)) / (points.length - 1))
  const y = (value: number): number => PAD + ((top - value) / (top - bottom)) * (H - PAD * 2)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`
  const tip = active === null ? null : points[active]

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} onMouseLeave={() => setActive(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {target !== null && <line className="chart-target" x1={PAD} x2={W - PAD} y1={y(target)} y2={y(target)} />}
        <path className="chart-area" d={area} fill={`url(#${gid})`} />
        <path className="chart-line" d={line} pathLength={1} />
        {points.map((p, i) => (
          <g key={`${p.label}-${i}`} onMouseEnter={() => setActive(i)}>
            <circle
              className={active === i ? 'chart-dot on' : 'chart-dot'}
              cx={x(i)}
              cy={y(p.value)}
              r={active === i ? 5 : 3.2}
              style={{ animationDelay: `${600 + i * 50}ms` }}
            />
            {/* 感应区放在圆点上面，不然鼠标碰到的是圆点，感应不到 */}
            <circle className="chart-hit" cx={x(i)} cy={y(p.value)} r="12" />
          </g>
        ))}
      </svg>
      {tip && (
        <div className="chart-tip">
          {tip.label} · {format(tip.value)}
        </div>
      )}
      {target !== null && <p className="chart-note">虚线是目标 {format(target)}</p>}
    </div>
  )
}
