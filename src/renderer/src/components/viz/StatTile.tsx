import type { ReactNode } from 'react'

/** 顶部的一块数据：标签、大数字、一句说明，右边可以放圆环之类的 */
export default function StatTile({ label, note, aside, children }: { label: string; note?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="tile">
      <div>
        <div className="tile-label">{label}</div>
        <div className="tile-value">{children}</div>
        {note && <div className="tile-note">{note}</div>}
      </div>
      {aside}
    </div>
  )
}
