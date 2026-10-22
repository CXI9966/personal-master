import { isoWeekOf, shiftDate, weekdayName, weekdayOf } from '../../shared/calendar'
import type { AiScene } from '../../shared/ai'
import { PATHS } from '../../shared/paths'
import type { ContextStrategy } from '../../shared/schema'
import type { AppContext } from '../app/context'
import { pickCheckins } from '../domain/checkin'
import { clockOf, logicalToday, nowISO } from '../domain/day'
// ContextStrategy 来自 shared/schema（设置里三选一）
import { loadPlan, loadProfile, loadSettings, loadSources, loadTasks } from '../domain/load'
import { unfinishedFromPlan } from '../domain/plan'
import { openTasks } from '../domain/tasks'
import { fixedLines, learningText, planText, profileText, recentDaysText, taskLines } from './format'

export interface ContextRequest {
  scene: AiScene
  strategy: ContextStrategy
}

const SCHEDULE_PLACEHOLDER = '（在这里写你的课程安排'

type SectionKey =
  | 'now' | 'checkin' | 'todayPlan' | 'fixed' | 'schedule' | 'unfinished'
  | 'open' | 'recent' | 'profile' | 'checkpoints' | 'learning' | 'body'

/** 每个场景/策略要带哪些内容，顺序就是出现的顺序 */
function sectionsFor({ scene, strategy }: ContextRequest): SectionKey[] {
  if (strategy === 'full') return ['now', 'checkin', 'todayPlan', 'fixed', 'schedule', 'unfinished', 'open', 'recent', 'profile', 'learning', 'body']
  if (strategy === 'tools') return ['now', 'checkin', 'todayPlan']
  if (scene === 'plan') return ['now', 'checkin', 'todayPlan', 'fixed', 'schedule', 'unfinished', 'open', 'recent']
  if (scene === 'review') return ['now', 'checkin', 'todayPlan', 'checkpoints', 'learning']
  if (scene === 'weekly') return ['now', 'recent']
  return ['now', 'checkin', 'todayPlan']
}

const TITLES: Record<SectionKey, string> = {
  now: '现在', checkin: '今天的打卡', todayPlan: '今天的计划', fixed: '今天的固定安排', schedule: '课表',
  unfinished: '昨天没做完的任务', open: '任务库里进行中的任务', recent: '最近 7 天', profile: '用户的目标和作息',
  checkpoints: '今天涉及的、带检验点的任务', learning: '最近的学习检验', body: '最近的体重和健身',
}

/** 按场景和策略组装发给模型的上下文：只带这一轮用得到的，省钱，便宜的模型也够用 */
export async function buildContext(ctx: AppContext, request: ContextRequest): Promise<string> {
  const { ws } = ctx
  const settings = await loadSettings(ws)
  const { dayStartsAt } = settings
  const today = logicalToday(dayStartsAt, ctx.now())
  const tasksFile = await loadTasks(ws)
  const plan = await loadPlan(ws, today)
  const taskById = new Map(tasksFile.tasks.map((task) => [task.id, task]))
  const wanted = new Set(sectionsFor(request))

  const profile = wanted.has('profile') || wanted.has('fixed') ? await loadProfile(ws) : null
  const loaded = wanted.has('recent') || wanted.has('checkin') || wanted.has('learning') || wanted.has('body') ? await loadSources(ws) : null
  const picked = loaded ? pickCheckins(loaded.sources.checkins, today, dayStartsAt) : null

  const build: Record<SectionKey, () => Promise<string> | string> = {
    now: () => `现在：${nowISO(ctx.now()).slice(0, 16).replace('T', ' ')}；今天的日期：${today}（${weekdayName(today)}，第 ${isoWeekOf(today).week} 周）`,
    checkin: () => {
      const parts = [picked?.wake && `起床 ${clockOf(picked.wake.at)}`, picked?.sleep && `睡前 ${clockOf(picked.sleep.at)}`].filter(Boolean)
      return parts.length > 0 ? parts.join('；') : '今天还没有打卡'
    },
    todayPlan: () => planText(plan, taskById),
    fixed: () => fixedLines((profile?.schedule.fixed ?? []).filter((item) => item.weekday === weekdayOf(today))),
    schedule: async () => {
      const text = ((await ws.readText(PATHS.schedule)) ?? '').trim()
      return text === '' || text.includes(SCHEDULE_PLACEHOLDER) ? '（用户还没写课表）' : text.slice(0, 3000)
    },
    unfinished: async () => {
      const yesterday = await loadPlan(ws, shiftDate(today, -1))
      return taskLines(unfinishedFromPlan(yesterday, tasksFile).filter((task) => !plan.taskIds.includes(task.id)))
    },
    open: () => taskLines(openTasks(tasksFile)),
    recent: () => (loaded ? recentDaysText(loaded.sources, dayStartsAt, today, 7) : ''),
    profile: () => (profile ? profileText(profile) : ''),
    checkpoints: () => {
      const withChecks = tasksFile.tasks.filter((task) => task.checkpoints.length > 0 && (plan.taskIds.includes(task.id) || task.status === 'open'))
      return taskLines(withChecks, 10)
    },
    learning: () => (loaded ? learningText(loaded.sources.learning) : ''),
    body: () => {
      const weights = (loaded?.sources.weights ?? []).slice(-5).map((w) => `${w.at.slice(0, 10)} ${w.kg}kg`)
      const workouts = (loaded?.sources.workouts ?? []).slice(-5).map((w) => `${w.at.slice(0, 10)} ${w.summary}`)
      return [`体重：${weights.join('；') || '（没有）'}`, `健身：${workouts.join('；') || '（没有）'}`].join('\n')
    },
  }

  const blocks: string[] = []
  for (const key of sectionsFor(request)) blocks.push(`## ${TITLES[key]}\n${await build[key]()}`)
  if (request.strategy === 'tools') blocks.push('## 提示\n需要更多信息时，用查询工具（get_tasks、get_plan、get_records、get_profile）自己查。')
  return blocks.join('\n\n')
}
