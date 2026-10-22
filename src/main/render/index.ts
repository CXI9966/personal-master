import { archiveDir, shiftDate } from '../../shared/calendar'
import { PATHS, planPath } from '../../shared/paths'
import { PlanFile, type Task } from '../../shared/schema'
import { pickCheckins } from '../domain/checkin'
import { logicalToday } from '../domain/day'
import { loadPlan, loadProfile, loadSettings, loadSources, loadTasks } from '../domain/load'
import { weekRows, weeklyStats } from '../domain/stats'
import type { Workspace } from '../store/types'
import { planHasContent, renderDayArchive } from './archive'
import { sanitizeFileName } from './common'
import { renderProfile } from './profile'
import { renderCheckins, renderLearning, renderWeight, renderWorkouts } from './records'
import { renderTaskList } from './tasks'
import { renderToday } from './today'
import { renderWeek } from './week'

export interface RenderOptions {
  now?: Date
  /** 重新生成全部归档；默认只重新生成最近 recentDays 天 */
  full?: boolean
  recentDays?: number
}

const TASKS_DIR = '任务库'

/** 根据 data/ 重新生成所有给人看的 Markdown。内容没变的文件不会重写 */
export async function renderAll(ws: Workspace, options: RenderOptions = {}): Promise<{ warnings: string[] }> {
  const settings = await loadSettings(ws)
  const profile = await loadProfile(ws)
  const tasksFile = await loadTasks(ws)
  const { sources, warnings } = await loadSources(ws)
  const { dayStartsAt } = settings
  const today = logicalToday(dayStartsAt, options.now)
  const config = { dayStartsAt, weights: settings.heatmap.weights }
  const taskById = new Map(tasksFile.tasks.map((task) => [task.id, task]))
  const tasksOf = (plan: PlanFile): Task[] => plan.taskIds.flatMap((id) => taskById.get(id) ?? [])

  const plan = await loadPlan(ws, today)
  const picked = pickCheckins(sources.checkins, today, dayStartsAt)
  await ws.writeGenerated('今日.md', renderToday({ date: today, plan, tasks: tasksOf(plan), wake: picked.wake, sleep: picked.sleep }))
  await ws.writeGenerated(
    '本周.md',
    renderWeek({
      stats: weeklyStats(today, sources, config),
      rows: weekRows(today, sources, config),
      fixed: profile.schedule.fixed,
    }),
  )
  await ws.writeGenerated('我的设定.md', renderProfile(profile))

  await ws.writeGenerated('记录/打卡.md', renderCheckins(sources.checkins, dayStartsAt))
  await ws.writeGenerated('记录/体重.md', renderWeight(sources.weights, profile.goals.weightTargetKg, dayStartsAt))
  await ws.writeGenerated('记录/健身.md', renderWorkouts(sources.workouts, dayStartsAt))
  await ws.writeGenerated('记录/学习.md', renderLearning(sources.learning, dayStartsAt))

  // 每个清单一份文件；改名、删除过的清单留下的旧文件也清掉
  const expected = new Set(tasksFile.lists.map((list) => `${sanitizeFileName(list)}.md`))
  for (const list of tasksFile.lists) {
    await ws.writeGenerated(`${TASKS_DIR}/${sanitizeFileName(list)}.md`, renderTaskList(list, tasksFile.tasks))
  }
  for (const name of await ws.list(TASKS_DIR)) {
    if (name.endsWith('.md') && !expected.has(name)) await ws.removeGenerated(`${TASKS_DIR}/${name}`)
  }

  // 归档：有内容的每天一份
  const recentFrom = shiftDate(today, -(options.recentDays ?? 14))
  for (const name of await ws.list(PATHS.plansDir)) {
    const date = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1]
    if (!date || (!options.full && date < recentFrom)) continue
    try {
      const archived = await ws.readJson(planPath(date), PlanFile)
      if (planHasContent(archived)) {
        await ws.writeGenerated(`${archiveDir(date)}/${date}.md`, renderDayArchive(archived, tasksOf(archived)))
      }
    } catch (error) {
      warnings.push(`${planPath(date)} 读不出来：${(error as Error).message}`)
    }
  }
  return { warnings }
}
