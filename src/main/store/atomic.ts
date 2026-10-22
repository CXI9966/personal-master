import { randomUUID } from 'node:crypto'
import { open, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

// Windows 上目标文件被别的进程（或自己进程的读）占用时，rename 会报这几种
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES'])

export interface AtomicWriteOptions {
  /** 先落盘再改名，默认 true */
  fsync?: boolean
  /** 遇到占用时是否退避重试，默认 true */
  retry?: boolean
  /** 重试总时长上限（毫秒），默认 10000 */
  maxWaitMs?: number
  /** 单次等待上限（毫秒），默认 50 */
  maxDelayMs?: number
}

export interface AtomicWriteResult {
  retries: number
  waitedMs: number
}

/** 临时文件放在同一目录（同一个卷上 rename 才是原子的），以 .tmp 结尾便于监听时忽略 */
function tempPathFor(target: string): string {
  return join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
}

/** 写临时文件 → fsync → rename 覆盖；遇到占用就带抖动地退避重试，超时后抛出最后一次的错误 */
export async function writeFileAtomic(
  target: string,
  data: string,
  options: AtomicWriteOptions = {},
): Promise<AtomicWriteResult> {
  const { fsync = true, retry = true, maxWaitMs = 10_000, maxDelayMs = 50 } = options
  const tmp = tempPathFor(target)
  const handle = await open(tmp, 'wx') // wx：临时文件已存在就报错
  try {
    await handle.writeFile(data, 'utf8')
    if (fsync) await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(tmp, { force: true })
    throw error
  }
  await handle.close()

  const started = performance.now()
  let retries = 0
  for (;;) {
    try {
      await rename(tmp, target)
      return { retries, waitedMs: performance.now() - started }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      // 5, 10, 20, 40, 50, 50… 毫秒，再乘 0.5 到 1.5 的抖动，避免和占用方的节奏同步
      const delay = Math.min(maxDelayMs, 5 * 2 ** retries) * (0.5 + Math.random())
      if (!retry || !RETRYABLE.has(code) || performance.now() - started + delay > maxWaitMs) {
        await rm(tmp, { force: true }).catch(() => undefined)
        throw error
      }
      retries++
      await sleep(delay)
    }
  }
}
