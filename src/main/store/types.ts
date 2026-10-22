import type { z, ZodType } from 'zod'
import type { AtomicWriteOptions } from './atomic'
import type { ChangeInfo } from './history'
import type { LinesResult } from './jsonl'

/** 一次改动里能做的读写。路径一律是相对工作区的正斜杠路径，例如 data/tasks.json */
export interface Tx {
  /** 文件不存在时：有 fallback 就用它，否则抛 missing */
  readJson<S extends ZodType>(rel: string, schema: S, fallback?: () => z.output<S>): Promise<z.output<S>>
  /** 坏行跳过并返回行号；文件不存在返回空结果 */
  readLines<S extends ZodType>(rel: string, schema: S): Promise<LinesResult<z.output<S>>>
  /** 文件不存在返回 null；会去掉 BOM */
  readText(rel: string): Promise<string | null>
  /** 目录下的文件名（不含子目录），按名字排序；目录不存在返回空数组 */
  list(relDir: string): Promise<string[]>
  writeJson<S extends ZodType>(rel: string, value: z.input<S>, schema: S): Promise<void>
  writeText(rel: string, text: string): Promise<void>
  appendLine<S extends ZodType>(rel: string, value: z.input<S>, schema: S): Promise<void>
}

export interface Workspace extends Tx {
  readonly root: string
  /**
   * 写生成的视图文件（今日.md 之类）：内容没变就不重写，不进改动历史，也不算外部改动。
   */
  writeGenerated(rel: string, text: string): Promise<void>
  /**
   * 一次改动 = 一个队列任务，可以写多个文件；fn 里的写入共用一条历史，撤销时整体回退。
   * fn 抛错时，已经写进去的部分会回滚。tx 内部不再排队，不要在 fn 里调用 Workspace 自己的方法（会死锁）。
   */
  batch<T>(label: string, fn: (tx: Tx) => Promise<T>): Promise<T>
  /** 最近一次可撤销的改动 */
  lastChange(): ChangeInfo | null
  /** 只有它还是最近一次改动时才成功 */
  undo(changeId: string): Promise<boolean>
  /** 文件整个坏了时，恢复成最近一份历史备份；这次恢复本身也能撤销 */
  restoreFromHistory(rel: string): Promise<boolean>
  /** data/、管家人格.md、课表.md 被外部程序改动时回调（相对路径，正斜杠） */
  onExternalChange(callback: (rel: string) => void): () => void
  close(): Promise<void>
}

export interface OpenOptions {
  /** 是否监听外部改动，默认 true */
  watch?: boolean
  /** 外部改动事件的合并等待时间，默认 300 毫秒 */
  debounceMs?: number
  /** 自己写文件后，这段时间内的事件不算外部改动，默认 1000 毫秒 */
  selfWriteWindowMs?: number
  /** 最多保留多少次改动历史，默认 50 */
  historyLimit?: number
  atomic?: AtomicWriteOptions
  now?: () => Date
  /** 非致命的问题，例如写改动历史失败 */
  onWarn?: (message: string) => void
}
