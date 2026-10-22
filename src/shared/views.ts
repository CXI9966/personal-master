// 主进程推给界面的数据形状。界面不直接读文件，也不自己算分，只显示这些快照。

import type {
  Checkin,
  FixedItem,
  HeatmapWeights,
  LearningCheck,
  PlanFile,
  ProfileFile,
  SettingsFile,
  Task,
  WeightEntry,
  Workout,
} from './schema'

export type HeatLevel = 0 | 1 | 2 | 3 | 4

export interface HeatCell {
  date: string
  score: number
  level: HeatLevel
  /** 今天之后的格子 */
  future: boolean
}

export interface ChangeInfo {
  id: string
  label: string
}

export interface AppState {
  workspaceRoot: string | null
  /** 工作区已经初始化过（有 data/settings.json） */
  initialized: boolean
  /** 第一次运行页面里默认填的文件夹 */
  defaultRoot: string
}

export interface NewTaskInput {
  title: string
  list?: string
  due?: string | null
  checkpoints?: string[]
  notes?: string
}
export type TaskPatch = Partial<NewTaskInput>

/** 某一天做了什么：点热力图格子时看 */
export interface DaySnapshot {
  date: string
  weekday: string
  score: number
  plan: PlanFile
  planTasks: Task[]
  /** 这一天完成的任务（不一定在当天的计划里） */
  doneTasks: Task[]
  wake: Checkin | null
  sleep: Checkin | null
  weights: WeightEntry[]
  workouts: Workout[]
  learning: LearningCheck[]
}

export interface CheckinRow {
  date: string
  wake: Checkin | null
  sleep: Checkin | null
}

export interface RecordsSnapshot {
  today: string
  /** 最近 53 周（覆盖全年），每列一周 */
  heatmap: HeatCell[]
  /** 最近有打卡的日子，最新的在前 */
  checkins: CheckinRow[]
  /** 按时间从早到晚 */
  weights: WeightEntry[]
  weightTargetKg: number | null
  workouts: Workout[]
  learning: LearningCheck[]
  warnings: string[]
}

export interface SettingsSnapshot {
  workspaceRoot: string
  settings: SettingsFile
  profile: ProfileFile
}

export interface SettingsPatch {
  dayStartsAt?: string
  weights?: Partial<HeatmapWeights>
  reminders?: Partial<SettingsFile['reminders']>
}

/** 核心数据文件读不出来：界面据此提示，并提供“恢复上一个版本” */
export interface HealthProblem {
  rel: string
  message: string
}

export interface TodaySnapshot {
  /** 今天的逻辑日期 */
  date: string
  dayStartsAt: string
  plan: PlanFile
  /** 计划里引用的任务（按计划顺序，找不到的已去掉） */
  planTasks: Task[]
  /** 所有进行中的任务，排计划时从里面挑 */
  openTasks: Task[]
  lists: string[]
  /** 昨天计划里还没完成的任务；隔了几天才回来时为空 */
  unfinished: Task[]
  /** 今天是周几，对应的每周固定安排 */
  fixedToday: FixedItem[]
  wake: Checkin | null
  sleep: Checkin | null
  /** 最近 12 周，每列一周，周一开头 */
  heatmap: HeatCell[]
  /** 隔了 3 天以上才回来：只显示“欢迎回来” */
  welcomeBack: boolean
  /** 被跳过的坏行、读不出来的文件 */
  warnings: string[]
}
