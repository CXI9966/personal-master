import { createContext, useContext } from 'react'
import type { AiScene } from '../../shared/ai'

export type Page = 'today' | 'tasks' | 'chat' | 'records' | 'settings'

export interface ShellApi {
  /** 切到管家页，用指定场景发一条消息（今日页的“让管家排”“复盘并检验”用） */
  ask: (scene: AiScene, text: string) => void
  goto: (page: Page) => void
}

// 页面单独渲染（比如测试里）时用的空实现
export const ShellContext = createContext<ShellApi>({ ask: () => undefined, goto: () => undefined })
export const useShell = (): ShellApi => useContext(ShellContext)

export const PLAN_PROMPT = '帮我排今天的计划：结合我的固定安排、课表和没做完的任务，给出一个整天的时间安排和要做的任务。要重排的话，直接提出来让我确认。'
export const REVIEW_PROMPT = '我要复盘今天了。先看看今天的计划和任务完成情况，再按你的检验规则考我一下今天学的内容。'
