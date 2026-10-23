// 界面和主进程之间的全部通道、请求和响应类型。新增通道只改这里和对应的 handler。

import type {
  ActionCard,
  AiEvent,
  AiScene,
  AiStatus,
  ChatMessage,
  ConnectionResult,
  ModelConfig,
  PersonaPresetInfo,
  UsageSummary,
} from './ai'
import type { PersonaId, PersonaSections } from './persona'
import type { PetLaunchStatus, PetSettings, PetTestResult } from './pet'
import type { ActionMode, Checkin, ContextStrategy, Energy, ProfileFile, Task, TasksFile, TimelineItem } from './schema'
import type {
  AppState,
  AutostartInfo,
  ChangeInfo,
  DaySnapshot,
  FolderInfo,
  HealthProblem,
  MigrationResult,
  NewTaskInput,
  RecordsSnapshot,
  SettingsPatch,
  SettingsSnapshot,
  TaskPatch,
  TodaySnapshot,
  WeeklyReportView,
} from './views'

export interface IpcMap {
  'app:state': { req: void; res: AppState }
  /** 弹出系统的选择文件夹对话框，取消返回 null */
  'workspace:pick': { req: void; res: string | null }
  'workspace:inspect': { req: { root: string }; res: FolderInfo }
  /** 第一次运行：初始化并打开工作区 */
  'workspace:init': { req: { root: string; persona: PersonaId }; res: AppState }
  /** 打开一个已经初始化过的工作区 */
  'workspace:open': { req: { root: string }; res: AppState }
  /** 把工作区迁移到空文件夹：复制、检查、切换。失败时回到原工作区；旧文件夹原样保留 */
  'workspace:migrate': { req: { root: string }; res: MigrationResult }
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
  /** 已经结束、有记录的最近几周的周报，最新的在前 */
  'weekly:list': { req: void; res: WeeklyReportView[] }
  /** 让管家点评某一周（传周一的日期），点评会存下来 */
  'weekly:comment': { req: { weekStart: string }; res: { text: string } }
  // ---- 设置 ----
  'settings:get': { req: void; res: SettingsSnapshot }
  'settings:update': { req: SettingsPatch; res: void }
  'profile:update': { req: { profile: ProfileFile }; res: void }
  /** 开机自启（这台电脑的设置，不属于工作区）。开发时不支持，会报错 */
  'autostart:set': { req: { enabled: boolean }; res: AutostartInfo }
  // ---- 历史和数据健康 ----
  /** 最近一次可撤销的改动 */
  'history:last': { req: void; res: ChangeInfo | null }
  /** 撤销最近一次改动；它已经不是最近一次时返回 false */
  'history:undo': { req: { changeId: string }; res: boolean }
  /** 数据文件坏了时，恢复成最近一份历史备份 */
  'history:restore': { req: { rel: string }; res: boolean }
  /** 核心数据文件有没有读不出来的 */
  'data:health': { req: void; res: HealthProblem[] }
  // ---- 管家 ----
  'ai:status': { req: void; res: AiStatus }
  /** 保存模型接口配置。apiKey 不给就保持原来的；clearKey 为真就清掉已保存的 key */
  'ai:save': {
    req: { provider: ModelConfig; contextStrategy: ContextStrategy; actionMode: ActionMode; apiKey?: string; clearKey?: boolean }
    res: void
  }
  /** 测试连接。apiKey 不给就用已保存的 */
  'ai:test': { req: { provider: ModelConfig; apiKey?: string }; res: ConnectionResult }
  /** 开始一次对话，马上返回；进展通过 ai:event 事件推过来 */
  'ai:send': { req: { messages: ChatMessage[]; scene: AiScene }; res: { runId: string } }
  'ai:cancel': { req: { runId: string }; res: void }
  /** 对一张待确认的卡片点确认或取消 */
  'ai:confirm': { req: { cardId: string; accept: boolean }; res: ActionCard }
  /** 新对话：清掉还没确认的卡片 */
  'ai:reset': { req: void; res: void }
  'ai:usage': { req: void; res: UsageSummary }
  'persona:get': { req: void; res: { markdown: string; sections: PersonaSections | null } }
  'persona:save': { req: { markdown: string }; res: void }
  'persona:presets': { req: void; res: PersonaPresetInfo[] }
  // ---- 桌宠 ----
  /** 桌宠（dsh-pet）接入的设置，这台电脑的设置，不属于工作区 */
  'pet:get': { req: void; res: PetSettings }
  /** 保存并立即生效；地址不是本机、数值越界会被拒绝 */
  'pet:save': { req: PetSettings; res: PetSettings }
  /** 用给定的地址和宠物 id 试连一次，不保存 */
  'pet:test': { req: { baseUrl: string; petId: string }; res: PetTestResult }
  /** 弹出系统的选择文件对话框，选桌宠的启动文件（.bat、.cmd、.exe），取消返回 null */
  'pet:pick': { req: void; res: string | null }
  /** 桌宠有没有在运行、是不是 Butler 启动的（设置页隔几秒问一次） */
  'pet:status': { req: void; res: PetLaunchStatus }
  /** 现在就按启动文件把桌宠启动起来（已经在运行就不动）。最多等几秒，之后用 pet:status 看进展 */
  'pet:launch': { req: void; res: PetLaunchStatus }
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
  'workspace:migrate': true,
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
  'weekly:list': true,
  'weekly:comment': true,
  'settings:get': true,
  'settings:update': true,
  'profile:update': true,
  'autostart:set': true,
  'history:last': true,
  'history:undo': true,
  'history:restore': true,
  'data:health': true,
  'ai:status': true,
  'ai:save': true,
  'ai:test': true,
  'ai:send': true,
  'ai:cancel': true,
  'ai:confirm': true,
  'ai:reset': true,
  'ai:usage': true,
  'persona:get': true,
  'persona:save': true,
  'persona:presets': true,
  'pet:get': true,
  'pet:save': true,
  'pet:test': true,
  'pet:pick': true,
  'pet:status': true,
  'pet:launch': true,
} as const satisfies Record<Channel, true>

export const CHANNELS = Object.keys(channelTable) as Channel[]

/** 主进程对每个请求的统一应答：出错时只带可以直接给用户看的消息 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string }

/** 主进程主动推给界面的事件 */
export interface EventMap {
  'data:changed': { reason: 'local' | 'external' }
  /** 管家对话的进展：文字、动作卡片、提示、错误、结束 */
  'ai:event': AiEvent
}
export type EventName = keyof EventMap
export const EVENT_NAMES: readonly EventName[] = ['data:changed', 'ai:event']

type InvokeArgs<C extends Channel> = Request<C> extends void ? [] : [Request<C>]

/** preload 暴露给界面的全部能力：window.butler */
export interface ButlerApi {
  /** 出错时抛 Error，message 就是给用户看的文字 */
  invoke<C extends Channel>(channel: C, ...args: InvokeArgs<C>): Promise<Response<C>>
  /** 返回取消订阅函数 */
  on<E extends EventName>(event: E, listener: (payload: EventMap[E]) => void): () => void
}
