import { logicalToday } from '../domain/day'
import { loadPlan, loadSettings } from '../domain/load'
import type { AppContext, Platform } from './context'
import { dueReminders, type ReminderLedger } from './reminders'
import type { Session } from './session'

export interface Ticker {
  /** 每隔一会儿调用一次：检查是不是新的一天、该不该提醒。出错只记警告，不抛 */
  tick(): Promise<void>
}

export interface TickerDeps {
  session: Session
  platform: Platform
  ledger: ReminderLedger
  onWarn?: (message: string) => void
}

export function createTicker(deps: TickerDeps): Ticker {
  let seen: { ctx: AppContext; day: string } | null = null
  let running = false

  return {
    async tick() {
      if (running || !deps.session.isOpen()) return
      running = true
      try {
        const ctx = deps.session.ctx()
        const now = ctx.now()
        const settings = await loadSettings(ctx.ws)
        const today = logicalToday(settings.dayStartsAt, now)
        // 刚打开工作区，或者过了换日时间：重新生成今日、本周这些视图，让界面也刷新到新的一天
        if (seen?.ctx !== ctx || seen.day !== today) ctx.changed()
        seen = { ctx, day: today }

        const state = await deps.ledger.read()
        const sent = state?.date === today ? state.sent : []
        const due = dueReminders({ settings, now, plan: await loadPlan(ctx.ws, today), sent })
        if (due.length === 0) return
        // 先记账再弹：弹失败了也不会每分钟重复弹
        await deps.ledger.write({ date: today, sent: [...sent, ...due.map((reminder) => reminder.kind)] })
        for (const reminder of due) deps.platform.showReminder({ title: reminder.title, body: reminder.body })
      } catch (error) {
        deps.onWarn?.(`定时检查失败：${String(error)}`)
      } finally {
        running = false
      }
    },
  }
}
