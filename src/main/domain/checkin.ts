import type { Checkin } from '../../shared/schema'
import { logicalDateOf } from './day'

export interface DayCheckins {
  wake: Checkin | null
  sleep: Checkin | null
}

const timeOf = (checkin: Checkin): number => Date.parse(checkin.at)

/**
 * 同一天多次打卡都会记下，显示、统计和计分只算：起床第一次、睡前最后一次。
 * 归日用记录自己的墙上时间，凌晨 00:30 的"睡前"算前一天。
 */
export function pickCheckins(events: Checkin[], day: string, dayStartsAt: string): DayCheckins {
  let wake: Checkin | null = null
  let sleep: Checkin | null = null
  for (const event of events) {
    if (logicalDateOf(event.at, dayStartsAt) !== day) continue
    if (event.type === 'wake') {
      if (!wake || timeOf(event) < timeOf(wake)) wake = event
    } else if (!sleep || timeOf(event) > timeOf(sleep)) {
      sleep = event
    }
  }
  return { wake, sleep }
}

/** 按逻辑日期分组，每天已经做过取舍 */
export function checkinsByDay(events: Checkin[], dayStartsAt: string): Map<string, DayCheckins> {
  const groups = new Map<string, Checkin[]>()
  for (const event of events) {
    const day = logicalDateOf(event.at, dayStartsAt)
    const group = groups.get(day)
    if (group) group.push(event)
    else groups.set(day, [event])
  }
  const result = new Map<string, DayCheckins>()
  for (const [day, group] of groups) result.set(day, pickCheckins(group, day, dayStartsAt))
  return result
}
