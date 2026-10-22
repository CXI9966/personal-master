import { randomUUID } from 'node:crypto'
import { access, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PersonaId } from '../../shared/persona'
import { PATHS } from '../../shared/paths'
import type { AppState } from '../../shared/views'
import { DomainError } from '../domain/errors'
import { initWorkspace, isInitialized } from '../init/firstRun'
import { createRenderScheduler, type RenderScheduler } from '../render/scheduler'
import { openWorkspace } from '../store/workspace'
import type { Workspace } from '../store/types'
import type { AppContext, Platform } from './context'

export interface Session {
  state(): Promise<AppState>
  isOpen(): boolean
  /** 还没打开工作区时抛 DomainError */
  ctx(): AppContext
  /** 启动时调用：按配置重新打开上次的工作区，打不开就保持未打开 */
  restore(): Promise<void>
  /** 不打开工作区，只看这个文件夹是什么情况 */
  inspect(root: string): Promise<{ exists: boolean; initialized: boolean }>
  initialize(root: string, persona: PersonaId): Promise<AppState>
  open(root: string): Promise<AppState>
  close(): Promise<void>
}

export interface SessionOptions {
  platform: Platform
  now?: () => Date
  newId?: () => string
  /** 数据变化后多久重新生成视图，默认 500 毫秒 */
  renderDelayMs?: number
  /** 是否监听外部改动，默认 true */
  watch?: boolean
  onWarn?: (message: string) => void
}

interface Open {
  root: string
  ws: Workspace
  scheduler: RenderScheduler
  ctx: AppContext
  stopListening: () => void
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export function createSession(options: SessionOptions): Session {
  const { platform } = options
  const now = options.now ?? (() => new Date())
  const newId = options.newId ?? (() => randomUUID())
  const warn = options.onWarn ?? (() => undefined)
  let current: Open | null = null

  const state = async (): Promise<AppState> => ({
    workspaceRoot: current?.root ?? null,
    initialized: current !== null,
    defaultRoot: platform.defaultRoot(),
  })

  async function close(): Promise<void> {
    const open = current
    current = null
    if (!open) return
    open.stopListening()
    await open.scheduler.flush() // 退出前把还没渲染的视图渲染掉
    open.scheduler.dispose()
    await open.ws.close()
  }

  async function openAt(root: string, persona: PersonaId | null): Promise<AppState> {
    const absRoot = resolve(root)
    if (persona === null && !(await exists(join(absRoot, PATHS.settings)))) {
      throw new DomainError('invalid', `这个文件夹还没有初始化：${absRoot}`)
    }
    await close()
    const ws = await openWorkspace(absRoot, { watch: options.watch, onWarn: warn })
    try {
      if (persona !== null) await initWorkspace(ws, { persona, now: now() })
      else if (!(await isInitialized(ws))) throw new DomainError('invalid', `这个文件夹还没有初始化：${absRoot}`)
    } catch (error) {
      await ws.close()
      throw error
    }
    const scheduler = createRenderScheduler(ws, {
      delayMs: options.renderDelayMs,
      now,
      onWarnings: (warnings) => warnings.forEach(warn),
      onError: (error) => warn(`生成视图失败：${String(error)}`),
    })
    const ctx: AppContext = {
      ws,
      now,
      newId,
      changed: () => {
        scheduler.schedule()
        platform.notifyDataChanged('local')
      },
    }
    const stopListening = ws.onExternalChange(() => {
      scheduler.schedule()
      platform.notifyDataChanged('external')
    })
    current = { root: absRoot, ws, scheduler, ctx, stopListening }
    await platform.writeConfig({ workspaceRoot: absRoot })
    return state()
  }

  return {
    state,
    isOpen: () => current !== null,
    ctx() {
      if (!current) throw new DomainError('invalid', '还没有选择工作区')
      return current.ctx
    },
    async restore() {
      const { workspaceRoot } = await platform.readConfig()
      if (!workspaceRoot || !(await isDirectory(workspaceRoot))) return
      try {
        await openAt(workspaceRoot, null)
      } catch (error) {
        warn(`打不开上次的工作区 ${workspaceRoot}：${String(error)}`)
      }
    },
    async inspect(root) {
      const absRoot = resolve(root)
      return { exists: await isDirectory(absRoot), initialized: await exists(join(absRoot, PATHS.settings)) }
    },
    initialize: (root, persona) => openAt(root, persona),
    open: (root) => openAt(root, null),
    close,
  }
}
