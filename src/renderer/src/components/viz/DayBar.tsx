import { minutesOfDay } from '../../../../shared/calendar'
import type { TimelineItem } from '../../../../shared/schema'

const pct = (minutes: number): string => `${(minutes / 1440) * 100}%`

/** 一天 24 小时的横条：时间安排是一块块色块，红线是现在 */
export default function DayBar({ items, nowMinutes }: { items: TimelineItem[]; nowMinutes: number }) {
  const label = items.length === 0 ? '今天还没有时间安排' : `今天有 ${items.length} 段时间安排`
  return (
    <div className="daybar">
      <div className="daybar-track" role="img" aria-label={label}>
        {items.map((item, index) => {
          const start = minutesOfDay(item.start)
          const end = minutesOfDay(item.end)
          return (
            <div
              key={`${item.start}-${index}`}
              className="daybar-block"
              title={`${item.start}–${item.end} ${item.title}`}
              style={{ left: pct(start), width: pct(Math.max(end - start, 30)), animationDelay: `${index * 90}ms` }}
            >
              <span>{item.title}</span>
            </div>
          )
        })}
        <div className="daybar-now" style={{ left: pct(nowMinutes) }} />
      </div>
      <div className="daybar-ticks" aria-hidden="true">
        {[0, 6, 12, 18, 24].map((hour) => (
          <span key={hour}>{hour}</span>
        ))}
      </div>
    </div>
  )
}
