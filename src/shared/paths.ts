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
