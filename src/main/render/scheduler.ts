import type { Workspace } from '../store/types'
import { renderAll } from './index'

export interface RenderScheduler {
  /** 数据变了就调用；短时间内多次调用只会在最后一次之后等 delayMs 渲染一次 */
  schedule(): void
  /** 立刻渲染掉还没渲染的（退出前、测试里用），并等正在进行的渲染做完 */
  flush(): Promise<void>
  dispose(): void
}

export interface SchedulerOptions {
  delayMs?: number
  now?: () => Date
  onWarnings?: (warnings: string[]) => void
  onError?: (error: unknown) => void
}

/** 防抖渲染：数据变化后延迟 500 毫秒，重新生成给人看的 Markdown */
export function createRenderScheduler(ws: Workspace, options: SchedulerOptions = {}): RenderScheduler {
  const delayMs = options.delayMs ?? 500
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | null = null
  let dirty = false
  let disposed = false

  async function run(): Promise<void> {
    dirty = false
    try {
      const { warnings } = await renderAll(ws, { now: options.now?.() })
      options.onWarnings?.(warnings)
    } catch (error) {
      options.onError?.(error)
    }
  }

  function start(): void {
    if (running || disposed) return
    running = run().finally(() => {
      running = null
      if (dirty) schedule() // 渲染期间又有新变化
    })
  }

  function schedule(): void {
    if (disposed) return
    dirty = true
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (dirty) start()
    }, delayMs)
  }

  return {
    schedule,
    async flush() {
      clearTimeout(timer)
      timer = undefined
      for (;;) {
        if (running) {
          await running
        } else if (dirty && !disposed) {
          start()
        } else {
          return
        }
      }
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
    },
  }
}
