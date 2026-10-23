import { useEffect, useId, useState } from 'react'
import CountUp from './CountUp'

/** 进度圆环：圆弧从 0 涨到当前比例，中间的百分比跟着滚动。label 是读屏软件听到的话 */
export default function Ring({ value, total, label }: { value: number; total: number; label: string }) {
  const gid = `ring-${useId().replace(/:/g, '')}`
  const ratio = total > 0 ? Math.min(1, value / total) : 0
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div className="ring" role="img" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--accent-2)" />
          </linearGradient>
        </defs>
        <circle className="ring-bg" cx="50" cy="50" r="42" />
        <circle
          className="ring-fg"
          cx="50"
          cy="50"
          r="42"
          pathLength={1}
          stroke={`url(#${gid})`}
          strokeDasharray={1}
          strokeDashoffset={shown ? 1 - ratio : 1}
          opacity={ratio > 0 ? 1 : 0}
        />
      </svg>
      <b aria-hidden="true">
        <CountUp to={Math.round(ratio * 100)} suffix="%" />
      </b>
    </div>
  )
}
