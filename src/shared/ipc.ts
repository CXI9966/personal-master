// 界面和主进程之间的全部通道、请求和响应类型。新增通道只改这里和对应的 handler。

import type { PersonaId } from './persona'
import type { Checkin, Energy, ProfileFile, Task, TasksFile, TimelineItem } from './schema'
import type {
  AppState,
  ChangeInfo,
  DaySnapshot,
  HealthProblem,
  NewTaskInput,
  RecordsSnapshot,
  SettingsPatch,
  SettingsSnapshot,
  TaskPatch,
  TodaySnapshot,
} from './views'

export interface IpcMap {
  'app:state': { req: void; res: AppState }
  /** 弹出系统的选择文件夹对话框，取消返回 null */
  'workspace:pick': { req: void; res: string | null }
  'workspace:inspect': { req: { root: string }; res: { exists: boolean; initialized: boolean } }
  /** 第一次运行：初始化并打开工作区 */
  'workspace:init': { req: { root: string; persona: PersonaId }; res: AppState }
  /** 打开一个已经初始化过的工作区 */
  'workspace:open': { req: { root: string }; res: AppState }
  'today:get': { req: void; res: TodaySnapshot }
  'day:get': { req: { date: string }; res: DaySnapshot }
  'checkin:add': { req: { type: Checkin['type'] }; res: void }
  // ---- 今天的计划 ----
  'plan:energy': { req: { energy: Energy | null }; res: void }
  /** 整个替换今天的时间安排 */
  'plan:timeline': { req: { items: TimelineItem[] }; res: void }
  /** 整个替换今天计划里的任务 */
  'plan:tasks': { req: { taskIds: string[] }; res: void }
  'plan:review': { req: { done: string; learned: string; change: string }; res: void }
  // ---- 任务库 ----
  'tasks:get': { req: void; res: TasksFile }
  /** addToToday 为真时，同一次改动里排进今天的计划 */
  'tasks:add': { req: NewTaskInput & { addToToday?: boolean }; res: Task }
  'tasks:update': { req: { id: string; patch: TaskPatch }; res: void }
  'tasks:status': { req: { id: string; status: Task['status'] }; res: void }
  'tasks:delete': { req: { id: string }; res: void }
  'lists:add': { req: { name: string }; res: void }
  'lists:rename': { req: { from: string; to: string }; res: void }
  'lists:remove': { req: { name: string }; res: void }
  // ---- 记录 ----
  'weight:add': { req: { kg: number }; res: void }
  'workout:add': { req: { summary: string; durationMin: number | null }; res: void }
  'records:get': { req: void; res: RecordsSnapshot }
  // ---- 设置 ----
  'settings:get': { req: void; res: SettingsSnapshot }
  'settings:update': { req: SettingsPatch; res: void }
  'profile:update': { req: { profile: ProfileFile }; res: void }
  // ---- 历史和数据健康 ----
  /** 最近一次可撤销的改动 */
  'history:last': { req: void; res: ChangeInfo | null }
  /** 撤销最近一次改动；它已经不是最近一次时返回 false */
  'history:undo': { req: { changeId: string }; res: boolean }
  /** 数据文件坏了时，恢复成最近一份历史备份 */
  'history:restore': { req: { rel: string }; res: boolean }
  /** 核心数据文件有没有读不出来的 */
  'data:health': { req: void; res: HealthProblem[] }
}

export type Channel = keyof IpcMap
export type Request<C extends Channel> = IpcMap[C]['req']
export type Response<C extends Channel> = IpcMap[C]['res']

// 用 satisfies 保证这张表和 IpcMap 的通道一一对应，漏写、多写都会编译报错
const channelTable = {
  'app:state': true,
  'workspace:pick': true,
  'workspace:inspect': true,
  'workspace:init': true,
  'workspace:open': true,
  'today:get': true,
  'day:get': true,
  'checkin:add': true,
  'plan:energy': true,
  'plan:timeline': true,
  'plan:tasks': true,
  'plan:review': true,
  'tasks:get': true,
  'tasks:add': true,
  'tasks:update': true,
  'tasks:status': true,
  'tasks:delete': true,
  'lists:add': true,
  'lists:rename': true,
  'lists:remove': true,
  'weight:add': true,
  'workout:add': true,
  'records:get': true,
  'settings:get': true,
  'settings:update': true,
  'profile:update': true,
  'history:last': true,
  'history:undo': true,
  'history:restore': true,
  'data:health': true,
} as const satisfies Record<Channel, true>

export const CHANNELS = Object.keys(channelTable) as Channel[]

/** 主进程对每个请求的统一应答：出错时只带可以直接给用户看的消息 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

/** 主进程主动推给界面的事件 */
export interface EventMap {
  'data:changed': { reason: 'local' | 'external' }
}
export type EventName = keyof EventMap
export const EVENT_NAMES: readonly EventName[] = ['data:changed']

type InvokeArgs<C extends Channel> = Request<C> extends void ? [] : [Request<C>]

/** preload 暴露给界面的全部能力：window.butler */
export interface ButlerApi {
  /** 出错时抛 Error，message 就是给用户看的文字 */
  invoke<C extends Channel>(channel: C, ...args: InvokeArgs<C>): Promise<Response<C>>
  /** 返回取消订阅函数 */
  on<E extends EventName>(event: E, listener: (payload: EventMap[E]) => void): () => void
}
