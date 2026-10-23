import { useEffect, useRef, useState } from 'react'

const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** 数字从旧值滚到新值。系统开了“减少动画”就直接显示结果 */
export default function CountUp({ to, suffix = '', ms = 900 }: { to: number; suffix?: string; ms?: number }) {
  const [shown, setShown] = useState(() => (reduced() ? to : 0))
  const from = useRef(shown)

  useEffect(() => {
    if (reduced()) {
      from.current = to
      setShown(to)
      return
    }
    const begin = from.current
    const start = performance.now()
    let id = 0
    const tick = (now: number): void => {
      const k = Math.min(1, (now - start) / ms)
      const value = Math.round(begin + (to - begin) * (1 - (1 - k) ** 3))
      from.current = value
      setShown(value)
      if (k < 1) id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [to, ms])

  return (
    <>
      {shown}
      {suffix}
    </>
  )
}
