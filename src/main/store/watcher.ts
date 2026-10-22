import { watch } from 'chokidar'
import { relative } from 'node:path'

export interface WatcherOptions {
  root: string
  /** 事件合并等待时间（毫秒） */
  debounceMs: number
  /** 自己写文件之后，这段时间内同一文件的事件当作自己写的（毫秒） */
  selfWriteWindowMs: number
  onChange: (rels: string[]) => void
  onError?: (error: unknown) => void
}

export interface ExternalWatcher {
  /** 写文件前后各调用一次：覆盖写的事件会比 writeFile 返回得还早，所以必须先登记 */
  markSelf: (abs: string) => void
  close: () => Promise<void>
}

const norm = (p: string): string => p.replace(/\\/g, '/')

/**
 * 只关心 data/、管家人格.md、课表.md 的外部改动；
 * 忽略 data/.history、*.tmp 和所有生成的 .md。chokidar 不支持 glob，这里用函数过滤。
 */
export async function startWatcher(options: WatcherOptions): Promise<ExternalWatcher> {
  const rootKey = norm(options.root).replace(/\/+$/, '').toLowerCase()

  const isWatched = (p: string): boolean => {
    const key = norm(p).toLowerCase()
    if (key === rootKey) return true
    if (!key.startsWith(`${rootKey}/`)) return false
    const rel = key.slice(rootKey.length + 1)
    if (rel === 'data') return true
    if (rel.startsWith('data/')) return !rel.split('/').includes('.history') && !rel.endsWith('.tmp')
    return rel === '管家人格.md' || rel === '课表.md'
  }

  const selfMarks = new Map<string, number>()
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  const watcher = watch(options.root, { ignoreInitial: true, ignored: (p) => !isWatched(p) })
  watcher.on('all', (event, abs) => {
    if (event !== 'add' && event !== 'change' && event !== 'unlink') return
    const markedAt = selfMarks.get(norm(abs).toLowerCase())
    if (markedAt !== undefined && Date.now() - markedAt <= options.selfWriteWindowMs) return
    pending.add(norm(relative(options.root, abs)))
    clearTimeout(timer)
    timer = setTimeout(() => {
      const rels = [...pending]
      pending.clear()
      options.onChange(rels)
    }, options.debounceMs)
  })
  watcher.on('error', (error) => options.onError?.(error))
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()))

  return {
    markSelf: (abs) => selfMarks.set(norm(abs).toLowerCase(), Date.now()),
    close: async () => {
      clearTimeout(timer)
      await watcher.close()
    },
  }
}
