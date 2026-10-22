import { weekdayLabel } from '../../shared/calendar'
import type { ProfileFile } from '../../shared/schema'
import { mdTable, withMarker } from './common'

const UNSET = '（还没填）'
const dayNames = (days: number[]): string => (days.length === 0 ? UNSET : days.map(weekdayLabel).join('、'))

export function renderProfile(profile: ProfileFile): string {
  const { goals, schedule } = profile
  const lines = [
    '# 我的设定',
    '',
    '## 目标',
    `- 目标体重：${goals.weightTargetKg === null ? UNSET : `${goals.weightTargetKg} kg`}`,
    `- 备注：${goals.notes.trim() || UNSET}`,
    '',
    '## 作息',
    `- 起床目标：${schedule.wakeTarget ?? UNSET}`,
    `- 睡前目标：${schedule.sleepTarget ?? UNSET}`,
    `- 健身日：${dayNames(schedule.gymDays)}`,
    '',
    '## 每周固定安排',
  ]
  if (schedule.fixed.length === 0) {
    lines.push('（还没填）')
  } else {
    const sorted = [...schedule.fixed].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start))
    lines.push(mdTable(['星期', '时间', '事项'], sorted.map((f) => [dayNames([f.weekday]), `${f.start}-${f.end}`, f.title])))
  }
  return withMarker(lines.join('\n'))
}
