import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { minutesOfDay } from '../../shared/calendar'
import type { PlanFile, SettingsFile } from '../../shared/schema'
import { nowISO, wallMinutesOf } from '../domain/day'
import { writeFileAtomic } from '../store/atomic'

export type ReminderKind = 'plan' | 'review'

export interface Reminder {
  kind: ReminderKind
  title: string
  body: string
}

const TEXT: Record<ReminderKind, Reminder> = {
  plan: { kind: 'plan', title: '管家', body: '今天还没排计划，花两分钟安排一下？' },
  review: { kind: 'review', title: '管家', body: '今天还没复盘，写几句就好。' },
}

/** 离“一天开始”过了多少分钟，用来比时间先后：换日时间是 04:00 时，01:00 比 23:00 晚 */
const sinceDayStart = (minutes: number, dayStartsAt: string): number => (minutes - minutesOfDay(dayStartsAt) + 1440) % 1440

export interface DueInput {
  settings: SettingsFile
  now: Date
  /** 今天的计划 */
  plan: PlanFile
  /** 今天已经提醒过的 */
  sent: readonly ReminderKind[]
}

/** 现在该提醒什么：开了提醒、过了设定的时间、这件事今天还没做、今天还没提醒过 */
export function dueReminders({ settings, now, plan, sent }: DueInput): Reminder[] {
  const { enabled, plan: planAt, review: reviewAt } = settings.reminders
  if (!enabled) return []
  const nowOffset = sinceDayStart(wallMinutesOf(nowISO(now)), settings.dayStartsAt)
  const reached = (at: string | null): boolean => at !== null && nowOffset >= sinceDayStart(minutesOfDay(at), settings.dayStartsAt)

  const due: Reminder[] = []
  if (reached(planAt) && plan.timeline.length === 0 && plan.taskIds.length === 0 && !sent.includes('plan')) due.push(TEXT.plan)
  if (reached(reviewAt) && plan.review === null && !sent.includes('review')) due.push(TEXT.review)
  return due
}

/** 哪天提醒过什么。只记当天的；换了一天，旧的记录自然作废 */
export interface ReminderState {
  date: string
  sent: ReminderKind[]
}

export interface ReminderLedger {
  read(): Promise<ReminderState | null>
  write(state: ReminderState): Promise<void>
}

/** 记在应用数据目录里（不进工作区），重启应用后同一天不会再提醒一遍 */
export function createFileLedger(dir: string): ReminderLedger {
  const file = join(dir, 'reminders-sent.json')
  return {
    async read() {
      try {
        const data = JSON.parse(await readFile(file, 'utf8')) as Partial<ReminderState>
        if (typeof data.date !== 'string' || !Array.isArray(data.sent)) return null
        return { date: data.date, sent: data.sent.filter((kind): kind is ReminderKind => kind === 'plan' || kind === 'review') }
      } catch {
        return null // 没有或者损坏，都当作还没提醒过
      }
    },
    async write(state) {
      await mkdir(dir, { recursive: true })
      await writeFileAtomic(file, `${JSON.stringify(state, null, 2)}\n`)
    },
  }
}
