import type { ZodType } from 'zod'
import { PATHS, planPath } from '../../shared/paths'
import {
  Checkin,
  defaultSettings,
  emptyPlan,
  emptyProfile,
  emptyTasks,
  LearningCheck,
  PlanFile,
  ProfileFile,
  SettingsFile,
  TasksFile,
  WeightEntry,
  Workout,
} from '../../shared/schema'
import type { Tx } from '../store/types'
import type { Sources } from './heatmap'

export const loadSettings = (tx: Tx): Promise<SettingsFile> => tx.readJson(PATHS.settings, SettingsFile, defaultSettings)
export const loadProfile = (tx: Tx): Promise<ProfileFile> => tx.readJson(PATHS.profile, ProfileFile, emptyProfile)
export const loadTasks = (tx: Tx): Promise<TasksFile> => tx.readJson(PATHS.tasks, TasksFile, emptyTasks)
export const loadPlan = (tx: Tx, date: string): Promise<PlanFile> =>
  tx.readJson(planPath(date), PlanFile, () => emptyPlan(date))

export interface LoadResult {
  sources: Sources
  /** 被跳过的坏行、读不出来的文件，给界面提示用 */
  warnings: string[]
}

/** 读出计分和统计需要的全部记录。坏行和坏文件不会让整体失败，只记进 warnings */
export async function loadSources(tx: Tx): Promise<LoadResult> {
  const warnings: string[] = []

  async function lines<S extends ZodType>(rel: string, schema: S): Promise<S['_output'][]> {
    const { items, skipped } = await tx.readLines(rel, schema)
    for (const line of skipped) warnings.push(`${rel} 第 ${line.line} 行被跳过：${line.reason}`)
    return items
  }

  const checkins = await lines(PATHS.checkins, Checkin)
  const weights = await lines(PATHS.weight, WeightEntry)
  const workouts = await lines(PATHS.workouts, Workout)
  const learning = await lines(PATHS.learning, LearningCheck)
  const tasks = (await loadTasks(tx)).tasks

  // 只有带复盘的计划才参与计分，其余不留在内存里
  const plans: PlanFile[] = []
  for (const name of await tx.list(PATHS.plansDir)) {
    if (!name.endsWith('.json')) continue
    const rel = `${PATHS.plansDir}/${name}`
    try {
      const plan = await tx.readJson(rel, PlanFile)
      if (plan.review) plans.push(plan)
    } catch (error) {
      warnings.push(`${rel} 读不出来：${(error as Error).message}`)
    }
  }
  return { sources: { checkins, tasks, weights, workouts, plans, learning }, warnings }
}
