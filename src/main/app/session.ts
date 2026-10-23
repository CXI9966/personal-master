import { randomUUID } from 'node:crypto'
import { access, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PersonaId } from '../../shared/persona'
import { PATHS } from '../../shared/paths'
import type { AppState, FolderInfo, MigrationResult } from '../../shared/views'
import { DomainError } from '../domain/errors'
import { initWorkspace, isInitialized } from '../init/firstRun'
import { createRenderScheduler, type RenderScheduler } from '../render/scheduler'
import { openWorkspace } from '../store/workspace'
import type { Workspace } from '../store/types'
import type { AppContext, Platform } from './context'
import { classifyTarget, createCopyJob, messageOf, migrateRefusal, relationOf, unusableReason } from './migrate'

export interface Session {
  state(): Promise<AppState>
  isOpen(): boolean
  /** 还没打开工作区时抛 DomainError */
  ctx(): AppContext
  /** 启动时调用：按配置重新打开上次的工作区，打不开就保持未打开 */
  restore(): Promise<void>
  /** 不打开工作区，只看这个文件夹是什么情况 */
  inspect(root: string): Promise<FolderInfo>
  initialize(root: string, persona: PersonaId): Promise<AppState>
  /** 打开一个已经初始化过的工作区。已经打开了别的工作区时，成功后通知界面刷新，失败就回到原来那个 */
  open(root: string): Promise<AppState>
  /** 把工作区迁移到空文件夹：先复制、检查，再切换。失败时回到原工作区；旧文件夹不会被改动或删除 */
  migrate(root: string): Promise<MigrationResult>
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
  let migrating = false

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

  /** 新位置没打开成功：关掉半成品，把原来的工作区重新打开，免得程序停在“没有工作区”。总是抛错 */
  async function reopenPrevious(previous: string, cause: unknown): Promise<never> {
    await close()
    try {
      await openAt(previous, null)
    } catch (error) {
      warn(`重新打开原工作区失败：${String(error)}`)
      throw new DomainError('invalid', `${messageOf(cause)}。原工作区也没能重新打开（${messageOf(error)}），请重启程序。`)
    }
    throw cause
  }

  return {
    state,
    isOpen: () => current !== null && !migrating,
    ctx() {
      if (migrating) throw new DomainError('invalid', '正在迁移工作区，请稍等')
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
      // 判断出错（比如读不了）就当作不能用，只是提示，不该让界面报错
      const kind = await classifyTarget(current?.root ?? null, absRoot).catch((): 'occupied' => 'occupied')
      return {
        exists: await isDirectory(absRoot),
        initialized: await exists(join(absRoot, PATHS.settings)),
        blocked: unusableReason(kind),
      }
    },
    initialize: (root, persona) => openAt(root, persona),
    async open(root) {
      const previous = current?.root ?? null
      if (previous !== null && relationOf(previous, root) === 'same') return state()
      try {
        const next = await openAt(root, null)
        if (previous !== null) platform.notifyDataChanged('local') // 换了工作区，各页要重新读
        return next
      } catch (error) {
        if (previous === null || current?.root === previous) throw error // 旧工作区没动过
        return reopenPrevious(previous, error)
      }
    },
    async migrate(root) {
      if (!current) throw new DomainError('invalid', '还没有选择工作区')
      if (migrating) throw new DomainError('invalid', '正在迁移工作区，请稍等')
      const previous = current.root
      const target = resolve(root)
      const refusal = migrateRefusal(await classifyTarget(previous, target))
      if (refusal) throw new DomainError('invalid', refusal)
      const job = await createCopyJob(previous, target) // 只检查，失败时什么都没动
      migrating = true
      try {
        try {
          await close() // 写完待渲染的视图、停掉监听，之后程序不会再改旧文件夹
          const copied = await job.run()
          await openAt(target, null)
          platform.notifyDataChanged('local')
          return { workspaceRoot: target, skipped: copied.skipped }
        } catch (error) {
          await close() // 新位置如果已经打开了半成品，先关掉
          const leftover = await job.undo()
          const detail = `${messageOf(error)}${leftover ? `。新位置里还残留 ${leftover}，请手动删除` : ''}`
          return await reopenPrevious(previous, new DomainError('invalid', `迁移失败，原工作区没有改动：${detail}`))
        }
      } finally {
        migrating = false
      }
    },
    close,
  }
}
