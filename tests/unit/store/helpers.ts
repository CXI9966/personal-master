import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 临时目录名带中文和空格，顺便覆盖这类路径
export async function makeTempDir(prefix = 'butler-ws 测试-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// 轮询直到条件成立或超时
export async function waitFor(check: () => boolean, timeoutMs = 3000, stepMs = 20): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return true
    await sleep(stepMs)
  }
  return check()
}
