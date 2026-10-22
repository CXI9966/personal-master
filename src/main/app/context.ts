import type { AiEvent } from '../../shared/ai'
import type { Workspace } from '../store/types'

export interface AppConfig {
  /** 上次打开的工作区；没有就是还没做过第一次运行 */
  workspaceRoot: string | null
}

/**
 * 外部环境：文件夹对话框、配置文件、通知界面刷新。
 * electron 相关的实现都在 shell 层，这里只有接口，所以应用层可以在 Node 下单测。
 */
export interface Platform {
  pickFolder(): Promise<string | null>
  /** 第一次运行页面里默认填的工作区文件夹 */
  defaultRoot(): string
  readConfig(): Promise<AppConfig>
  writeConfig(config: AppConfig): Promise<void>
  notifyDataChanged(reason: 'local' | 'external'): void
  /** 管家对话的进展（文字、动作卡片、错误……）推给界面 */
  notifyAi(event: AiEvent): void
}

/** 打开工作区之后，所有服务共用的上下文 */
export interface AppContext {
  ws: Workspace
  now: () => Date
  newId: () => string
  /** 数据写完后调用：安排重新生成视图，并通知界面刷新 */
  changed: () => void
}
