import { spawn, type ChildProcess } from 'node:child_process'
import { access } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { PetLaunchStatus } from '../../shared/pet'

const STARTUP_TIMEOUT_MS = 60_000 // 启动后多久还连不上，就算失败
const POLL_MS = 500

export interface PetLauncherDeps {
  /** 桌宠现在连得上吗 */
  isUp: () => Promise<boolean>
  /** 桌宠被 Butler 启动起来并且连得上了 */
  onUp?: () => void
  onWarn: (message: string) => void
}

export interface PetLauncher {
  status(): PetLaunchStatus
  /** 桌宠没在运行就用启动文件启动。最多等 waitMs 看它起来了没有，之后在后台继续等 */
  ensure(launcher: string, waitMs: number): Promise<PetLaunchStatus>
  /** 只停 Butler 自己启动的那一个（连同它开出来的桌面小窗） */
  stopOwn(): Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 按用户给的启动文件启动桌宠，不负责下载。启动文件是 .bat、.cmd 或 .exe。
 * 只管自己启动的进程：桌宠本来就在运行（用户自己开的），就直接用，退出 Butler 时也不去关它。
 */
export function createPetLauncher(deps: PetLauncherDeps): PetLauncher {
  let status: PetLaunchStatus = { state: 'off', message: '还没有启动过桌宠' }
  let child: ChildProcess | null = null
  let tail: string[] = [] // 启动文件最近的输出，失败时给用户看最后一行
  let generation = 0 // 每次启动或停止加一，后台等待据此知道自己过期了

  const set = (state: PetLaunchStatus['state'], message: string): void => {
    status = { state, message }
  }
  // 状态会在异步回调里被改掉，等待的循环要每次重新读，不能让 TypeScript 按前面赋的值收窄
  const current = (): PetLaunchStatus => status

  function remember(chunk: Buffer): void {
    for (const line of chunk.toString('utf8').split(/\r?\n/)) {
      const text = line.trim()
      if (text) tail = [...tail.slice(-11), text]
    }
  }

  async function waitUp(gen: number): Promise<boolean> {
    const end = Date.now() + STARTUP_TIMEOUT_MS
    while (gen === generation && Date.now() < end) {
      if (await deps.isUp()) return true
      await sleep(POLL_MS)
    }
    return false
  }

  async function ensure(launcher: string, waitMs: number): Promise<PetLaunchStatus> {
    if (status.state === 'starting') return status
    if (await deps.isUp()) {
      if (child === null) set('external', '桌宠已经在运行，Butler 直接用')
      return status
    }
    const file = launcher.trim()
    if (file === '') {
      set('missing', '还没有填桌宠的启动文件')
      return status
    }
    try {
      await access(file)
    } catch {
      set('missing', `找不到启动文件：${file}`)
      return status
    }

    generation += 1
    const gen = generation
    tail = []
    set('starting', '正在启动桌宠…')
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE // 从 VS Code 里启动的程序会继承它，会让桌宠的 Electron 被当成纯 Node 运行
    const options = { cwd: dirname(file), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] }
    const proc = /\.(bat|cmd)$/i.test(file)
      ? spawn('cmd.exe', ['/d', '/s', '/c', `"${file}"`], { ...options, windowsVerbatimArguments: true })
      : spawn(file, [], options)
    child = proc
    proc.stdout.on('data', remember)
    proc.stderr.on('data', remember)
    proc.on('error', (error) => {
      if (child !== proc) return
      child = null
      set('failed', `启动失败：${error.message}`)
      deps.onWarn(`桌宠：启动失败：${error.message}`)
    })
    proc.on('exit', (code) => {
      if (child !== proc) return
      child = null
      // 退出码 0 的启动文件可能只是把桌宠交给了别的进程，继续等它连上就行
      if (status.state === 'starting' && code !== 0) set('failed', `启动文件退出了（代码 ${code ?? '?'}）：${tail.at(-1) ?? '没有输出'}`)
      else if (status.state === 'started') set('stopped', '桌宠已经退出')
    })
    void waitUp(gen).then((up) => {
      if (gen !== generation || status.state !== 'starting') return
      if (up) {
        set('started', '桌宠已经启动（Butler 启动的）')
        deps.onUp?.()
      } else {
        set('failed', `启动后一分钟还连不上：${tail.at(-1) ?? '启动文件没有输出'}`)
      }
    })

    const end = Date.now() + waitMs
    while (current().state === 'starting' && Date.now() < end) await sleep(200)
    return current()
  }

  async function stopOwn(): Promise<void> {
    generation += 1
    const proc = child
    child = null
    if (proc === null || proc.exitCode !== null || proc.pid === undefined) return
    set('stopped', '桌宠已经停止')
    await new Promise<void>((resolve) => {
      const done = setTimeout(resolve, 3000)
      const finish = (): void => {
        clearTimeout(done)
        resolve()
      }
      if (process.platform !== 'win32') {
        proc.kill()
        return finish()
      }
      // /T 连它开出来的 node 和桌面小窗一起结束
      const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
      killer.on('exit', finish)
      killer.on('error', () => {
        proc.kill()
        finish()
      })
    })
  }

  return { status: () => status, ensure, stopOwn }
}
