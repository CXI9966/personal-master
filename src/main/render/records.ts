import { clockOf } from '../../shared/calendar'
import { RESULT_LABELS, SOURCE_LABELS } from '../../shared/labels'
import type { Checkin, LearningCheck, WeightEntry, Workout } from '../../shared/schema'
import { checkinsByDay } from '../domain/checkin'
import { formatSeq } from '../domain/learning'
import { logicalDateOf } from '../domain/day'
import { mdTable, withMarker } from './common'

const stamp = (checkin: Checkin | null): string =>
  checkin ? `${clockOf(checkin.at)}（${SOURCE_LABELS[checkin.source]}）` : ''

/** 记录/打卡.md：每天一行，最新的在上面；同一天多次打卡只显示起床第一次、睡前最后一次 */
export function renderCheckins(events: Checkin[], dayStartsAt: string): string {
  const days = [...checkinsByDay(events, dayStartsAt)].sort(([a], [b]) => b.localeCompare(a))
  const body =
    days.length === 0
      ? '还没有打卡记录'
      : mdTable(['日期', '起床', '睡前'], days.map(([date, d]) => [date, stamp(d.wake), stamp(d.sleep)]))
  return withMarker(`# 打卡记录\n\n${body}`)
}

/** 记录/体重.md：最新的在上面，“较上次”是和前一条记录比 */
export function renderWeight(entries: WeightEntry[], targetKg: number | null, dayStartsAt: string): string {
  const asc = [...entries].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  const rows = asc.map((entry, i) => {
    const prev = asc[i - 1]
    const delta = prev ? Math.round((entry.kg - prev.kg) * 10) / 10 : null
    return [
      logicalDateOf(entry.at, dayStartsAt),
      String(entry.kg),
      delta === null ? '' : `${delta > 0 ? '+' : ''}${delta}`,
    ]
  })
  const head = `# 体重记录${targetKg === null ? '' : `（目标 ${targetKg} kg）`}`
  const body = rows.length === 0 ? '还没有体重记录' : mdTable(['日期', '体重(kg)', '较上次'], rows.reverse())
  return withMarker(`${head}\n\n${body}`)
}

export function renderWorkouts(entries: Workout[], dayStartsAt: string): string {
  const desc = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  const body =
    desc.length === 0
      ? '还没有健身记录'
      : mdTable(
          ['日期', '内容', '时长(分钟)'],
          desc.map((w) => [logicalDateOf(w.at, dayStartsAt), w.summary, w.durationMin === null ? '' : String(w.durationMin)]),
        )
  return withMarker(`# 健身记录\n\n${body}`)
}

/** 记录/学习.md：每次检验一节，最新的在上面 */
export function renderLearning(entries: LearningCheck[], dayStartsAt: string): string {
  if (entries.length === 0) return withMarker('# 学习检验\n\n还没有检验记录')
  const sections = [...entries]
    .sort((a, b) => b.seq - a.seq)
    .map((entry) => {
      const lines = [`## ${formatSeq(entry.seq)} · ${logicalDateOf(entry.at, dayStartsAt)} · ${entry.topic}`]
      for (const check of entry.checks) lines.push(`- ${check.q} → ${RESULT_LABELS[check.result]}`)
      return lines.join('\n')
    })
  return withMarker(`# 学习检验\n\n${sections.join('\n\n')}`)
}
