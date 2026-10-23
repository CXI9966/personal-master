/** 工作区里的数据文件，路径都是相对工作区的正斜杠路径 */
export const PATHS = {
  tasks: 'data/tasks.json',
  profile: 'data/profile.json',
  settings: 'data/settings.json',
  checkins: 'data/checkins.jsonl',
  weight: 'data/weight.jsonl',
  workouts: 'data/workouts.jsonl',
  learning: 'data/learning.jsonl',
  usage: 'data/usage.jsonl',
  weeklyComments: 'data/weekly-comments.jsonl',
  plansDir: 'data/plans',
  persona: '管家人格.md',
  schedule: '课表.md',
} as const

export const planPath = (date: string): string => `${PATHS.plansDir}/${date}.json`

/**
 * Butler 自己管的顶层条目（相对工作区）。迁移时只搬这些，其余文件一概不碰。
 * 生成的视图名字以 src/main/render 实际生成的为准。
 */
export const MANAGED_ENTRIES = ['data', PATHS.persona, PATHS.schedule, '今日.md', '本周.md', '我的设定.md', '任务库', '记录', '归档'] as const
