import type { Stats } from 'node:fs'
import { cp, lstat, mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { MANAGED_ENTRIES, PATHS } from '../../shared/paths'
import { DomainError } from '../domain/errors'

/** 目标文件夹的情况：和当前工作区的关系，以及它自己里面有什么 */
export type TargetKind = 'same' | 'inside' | 'empty' | 'workspace' | 'occupied' | 'file'

export interface CopyResult {
  files: number
  bytes: number
  /** 旧文件夹里不属于 Butler 的顶层条目，没有搬 */
  skipped: string[]
}

export interface CopyJob {
  /** 复制并逐个检查；失败时抛错，已经复制的部分留给 undo 清理 */
  run(): Promise<CopyResult>
  /** 清掉这次复制在新位置建出来的东西；清干净返回 null，清不掉就返回没删掉的路径 */
  undo(): Promise<string | null>
}

const MANAGED = new Set<string>(MANAGED_ENTRIES)

const REASONS: Record<string, string> = {
  ENOSPC: '磁盘空间不够',
  EACCES: '没有写入权限',
  EPERM: '没有权限，或者文件被其他程序占用',
  EBUSY: '文件被其他程序占用',
}

/** 把文件系统的错误变成能直接给用户看的话 */
export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const hint = REASONS[(error as NodeJS.ErrnoException | null)?.code ?? '']
  return hint ? `${hint}（${raw}）` : raw
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/** b 和 a 是不是同一个文件夹，或者在 a 里面。Windows 上 path.relative 不分大小写 */
export function relationOf(a: string, b: string): 'same' | 'inside' | 'other' {
  const rel = relative(resolve(a), resolve(b))
  if (rel === '') return 'same'
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return 'other'
  return 'inside'
}

/** 看一个文件夹是什么情况；currentRoot 为 null 表示还没打开工作区 */
export async function classifyTarget(currentRoot: string | null, target: string): Promise<TargetKind> {
  const abs = resolve(target)
  if (currentRoot !== null) {
    const relation = relationOf(currentRoot, abs)
    if (relation !== 'other') return relation
  }
  let info: Stats
  try {
    info = await stat(abs)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return 'empty' // 还不存在，迁移时会创建
    if (code === 'ENOTDIR') return 'file' // 路径中间有一段是文件
    throw error
  }
  if (!info.isDirectory()) return 'file'
  if (await exists(join(abs, PATHS.settings))) return 'workspace'
  return (await readdir(abs)).length === 0 ? 'empty' : 'occupied'
}

const REFUSALS = {
  same: '这就是当前的工作区，请换一个文件夹。',
  inside: '不能选当前工作区里面的文件夹。',
  file: '这不是文件夹，请换一个。',
  occupied: '这个文件夹不是空的，请选一个空文件夹，或者新建一个。',
  workspace: '这个文件夹里已经有一个 Butler 工作区，不能把数据迁移进去。要用那边的数据，请选“切换”。',
} as const

/** 迁移要求目标是空文件夹或者还不存在；不满足就返回原因 */
export function migrateRefusal(kind: TargetKind): string | null {
  return kind === 'empty' ? null : REFUSALS[kind]
}

/** 既不能迁移进去、也不能切换过去的原因；Butler 工作区可以切换，所以不算 */
export function unusableReason(kind: TargetKind): string | null {
  return kind === 'empty' || kind === 'workspace' ? null : REFUSALS[kind]
}

/** 一个条目下所有文件的相对路径（正斜杠）和大小，目录本身不算，按路径排序 */
async function listFiles(root: string, entry: string): Promise<Array<{ rel: string; size: number }>> {
  const out: Array<{ rel: string; size: number }> = []
  async function walk(rel: string): Promise<void> {
    const info = await lstat(join(root, rel))
    if (info.isDirectory()) {
      for (const name of await readdir(join(root, rel))) await walk(`${rel}/${name}`)
    } else {
      out.push({ rel, size: info.size })
    }
  }
  await walk(entry)
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

/**
 * 准备把 from 里 Butler 管的条目复制到 to。这一步只检查、不改动任何东西；
 * 真正的复制在 run() 里，撤销在 undo() 里，什么时候用由调用方（Session）决定。
 */
export async function createCopyJob(from: string, to: string): Promise<CopyJob> {
  const src = resolve(from)
  const dst = resolve(to)
  for (const entry of MANAGED_ENTRIES) {
    if (await exists(join(dst, entry))) throw new DomainError('invalid', `新位置里已经有 ${entry}，没有复制任何东西。`)
  }
  // 目标路径上原本不存在的几层文件夹（由外到内），撤销时要一并清掉
  const made: string[] = []
  for (let dir = dst; !(await exists(dir)); dir = dirname(dir)) {
    made.unshift(dir)
    if (dirname(dir) === dir) break
  }
  const copied: string[] = []

  return {
    async run() {
      await mkdir(dst, { recursive: true })
      for (const entry of MANAGED_ENTRIES) {
        if (!(await exists(join(src, entry)))) continue
        copied.push(entry) // 先记下：复制到一半失败时，这个条目也要清掉
        await cp(join(src, entry), join(dst, entry), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
      }
      let files = 0
      let bytes = 0
      for (const entry of copied) {
        const [original, copy] = await Promise.all([listFiles(src, entry), listFiles(dst, entry)])
        if (original.length !== copy.length) throw new Error(`复制后 ${entry} 里的文件数量对不上`)
        original.forEach((file, i) => {
          if (file.rel !== copy[i]?.rel || file.size !== copy[i]?.size) throw new Error(`复制后的文件和原来不一致：${file.rel}`)
        })
        files += original.length
        bytes += original.reduce((sum, file) => sum + file.size, 0)
      }
      const skipped = (await readdir(src)).filter((name) => !MANAGED.has(name)).sort()
      return { files, bytes, skipped }
    },

    async undo() {
      try {
        for (const entry of copied) await rm(join(dst, entry), { recursive: true, force: true })
        for (const dir of [...made].reverse()) await rmdir(dir).catch(() => undefined) // 非空就留着，不强删
        return null
      } catch (error) {
        return `${dst}（${messageOf(error)}）`
      }
    },
  }
}
