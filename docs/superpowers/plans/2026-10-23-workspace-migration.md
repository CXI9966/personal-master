# 工作区迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在设置页把工作区迁移到别的文件夹（复制、校验、切换），或切换到已有的 Butler 工作区。

**Architecture:** 文件操作放在新文件 `src/main/app/migrate.ts`（只依赖 Node）。`Session` 负责“关闭当前工作区、复制、打开新位置、失败时回退”，经新通道 `workspace:migrate` 暴露给界面。设置页的工作区卡片里新增 `WorkspaceMove` 组件。设计见 [2026-10-23-workspace-migration-design.md](../specs/2026-10-23-workspace-migration-design.md)。

**Tech Stack:** Electron 44、TypeScript 6、React 19、Node `fs/promises`。不加新依赖。

**验证方式：** 用户要求仓库里不放测试，所以不写测试文件。每个任务改完跑 `npm run typecheck`，主进程和界面都改完后跑 `npm run build`，最后用放在仓库外的一次性脚本启动真实的 Electron，在临时文件夹里跑四种情况。

---

## 文件结构

| 文件 | 动作 | 职责 |
| --- | --- | --- |
| `src/shared/paths.ts` | 改 | 新增 `MANAGED_ENTRIES`：Butler 自己管的顶层条目 |
| `src/main/app/migrate.ts` | 新增 | 判断目标文件夹、复制并校验、撤销复制 |
| `src/shared/views.ts` | 改 | 新增 `FolderInfo`、`MigrationResult` |
| `src/shared/ipc.ts` | 改 | `workspace:inspect` 返回 `FolderInfo`；新增 `workspace:migrate` |
| `src/main/app/session.ts` | 改 | `inspect` 扩展；新增 `migrate`；`open` 失败时回到原工作区，成功后通知界面 |
| `src/main/ai/service.ts` | 改 | 新增 `abortAll()` |
| `src/main/ipc/index.ts` | 改 | 两个通道的处理函数 |
| `src/renderer/src/components/WorkspaceMove.tsx` | 新增 | 选文件夹、确认、执行 |
| `src/renderer/src/pages/Settings.tsx`、`app.css` | 改 | 放进工作区卡片；路径自动换行 |
| `README.md` | 改 | 补“迁移工作区”一节 |

### Task 1: 同步设计文档并提交计划

**Files:** Modify `docs/superpowers/specs/2026-10-23-workspace-migration-design.md`（5.1、5.2 两节）

写计划时把回退改成由 `Session` 统一驱动、`inspect` 的返回值也简化了，所以先让设计文档跟上。

- [ ] **Step 1: 5.1 节，把 `copyManaged(from, to)` 那一整条（到“才删目标文件夹。”为止）换成：**

```
- `createCopyJob(from, to)`：先检查新位置里没有 Butler 的条目（有就拒绝），并算出目标路径上要新建的几层文件夹；这一步不改动任何东西。返回的对象有两个方法：`run()` 把 `MANAGED_ENTRIES` 里源文件夹实际存在的条目递归复制过去（不覆盖），再校验两边的相对路径集合和每个文件的大小，不一致就抛错；`undo()` 只删本次复制出来的条目和本次新建的空文件夹，清不掉就返回没删掉的路径。回退由 `Session` 统一调用，所以复制失败和后面“打开新位置”失败走同一条路径。
```

- [ ] **Step 2: 5.2 节，把 `migrate(root)` 的第 2 到 4 步换成：**

```
  2. `createCopyJob` 检查新位置（不改动任何东西），然后进入迁移状态，记下旧路径，`close()`（写完待渲染的视图、停掉文件监听）。
  3. `job.run()` 复制并校验，再 `openAt(目标, null)`（会校验已初始化并写入 `config.json`）。
  4. 任何一步失败：`close()`、`job.undo()`、`openAt(旧路径, null)`，再抛出带原因的错误；旧路径也打不开就在错误里说明并建议重启程序。
```

- [ ] **Step 3: 5.2 节，把 `open(root)` 和 `inspect(root)` 两条换成：**

```
- `open(root)`：已经打开了别的工作区时，成功后同样发 `notifyDataChanged('local')`，失败则回到原来的工作区；选的是当前工作区时什么都不做。
- `inspect(root)`：结果新增 `blocked`，是这个文件夹既不能迁移进去、也不能切换过去的原因（当前工作区本身或其内部、是文件、非空且不是 Butler 工作区），可以用就是 `null`。界面先看 `blocked`（显示原因），再看 `initialized`（切换），否则就是空文件夹或还不存在（迁移）。
```

- [ ] **Step 4: 提交**

```bash
git add docs/superpowers/specs/2026-10-23-workspace-migration-design.md docs/superpowers/plans/2026-10-23-workspace-migration.md
git commit -m "docs: workspace migration plan"
```

### Task 2: 复制与判断逻辑（`paths.ts` 和 `migrate.ts`）

**Files:**
- Modify: `src/shared/paths.ts`（文件末尾追加）
- Create: `src/main/app/migrate.ts`

- [ ] **Step 1: 在 `src/shared/paths.ts` 末尾追加**

```ts
/**
 * Butler 自己管的顶层条目（相对工作区）。迁移时只搬这些，其余文件一概不碰。
 * 生成的视图名字以 src/main/render 实际生成的为准。
 */
export const MANAGED_ENTRIES = ['data', PATHS.persona, PATHS.schedule, '今日.md', '本周.md', '我的设定.md', '任务库', '记录', '归档'] as const
```

- [ ] **Step 2: 创建 `src/main/app/migrate.ts`**

```ts
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
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 退出码 0，没有错误输出。

### Task 3: 共享类型、IPC、Session、管家服务

**Files:** Modify `src/shared/views.ts`、`src/shared/ipc.ts`、`src/main/ai/service.ts`、`src/main/app/session.ts`、`src/main/ipc/index.ts`

这些必须一起改：`Handlers` 要求每个通道都有处理函数，少一个就编译报错。

- [ ] **Step 1: `src/shared/views.ts`，在 `AppState` 后面追加**

```ts
/** 某个文件夹能不能当工作区用（设置页判断该迁移、切换还是拒绝） */
export interface FolderInfo {
  exists: boolean
  /** 里面已经有 Butler 工作区（有 data/settings.json） */
  initialized: boolean
  /** 既不能迁移进去、也不能切换过去的原因；可以用就是 null */
  blocked: string | null
}

export interface MigrationResult {
  workspaceRoot: string
  /** 旧文件夹里不属于 Butler、没有搬的顶层条目 */
  skipped: string[]
}
```

- [ ] **Step 2: `src/shared/ipc.ts`**

1. 从 `./views` 导入的列表里加 `FolderInfo`（放在 `DaySnapshot` 后）和 `MigrationResult`（放在 `HealthProblem` 后）。
2. `'workspace:inspect'` 的 `res` 改成 `FolderInfo`。
3. 在 `'workspace:open'` 后面加：

```ts
  /** 把工作区迁移到空文件夹：复制、检查、切换。失败时回到原工作区；旧文件夹原样保留 */
  'workspace:migrate': { req: { root: string }; res: MigrationResult }
```

4. `channelTable` 里 `'workspace:open': true,` 后面加 `'workspace:migrate': true,`。

- [ ] **Step 3: `src/main/ai/service.ts`**

1. `AiService` 接口里 `cancel(runId: string): void` 后面加：

```ts
  /** 中止所有进行中的对话，最多等 3 秒让它们收尾（换工作区之前用） */
  abortAll(): Promise<void>
```

2. `const runs = new Map<string, AbortController>()` 后面加 `const pending = new Set<Promise<unknown>>()`。
3. `send` 里把 `void runChat({` 改成 `const run: Promise<unknown> = runChat({`，结尾改成：

```ts
      }).finally(() => {
        runs.delete(runId)
        pending.delete(run)
        platform.notifyDataChanged('local') // 用量记了一笔，设置页的本周用量要刷新
      })
      pending.add(run)
      return { runId }
```

4. `cancel(runId) {…},` 后面加：

```ts
    async abortAll() {
      for (const controller of runs.values()) controller.abort()
      if (pending.size === 0) return
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 3000) // 不让迁移卡在一个停不下来的对话上
      })
      await Promise.race([Promise.allSettled([...pending]), timeout])
      clearTimeout(timer)
    },
```

- [ ] **Step 4: `src/main/app/session.ts`，分六处改**

1. 导入：`views` 那行改成 `import type { AppState, FolderInfo, MigrationResult } from '../../shared/views'`，并在 `import type { AppContext, Platform } from './context'` 后面加：

```ts
import { classifyTarget, createCopyJob, messageOf, migrateRefusal, relationOf, unusableReason } from './migrate'
```

2. `Session` 接口：`inspect` 的返回类型改成 `Promise<FolderInfo>`；`open` 和 `migrate` 写成：

```ts
  /** 打开一个已经初始化过的工作区。已经打开了别的工作区时，成功后通知界面刷新，失败就回到原来那个 */
  open(root: string): Promise<AppState>
  /** 把工作区迁移到空文件夹：先复制、检查，再切换。失败时回到原工作区；旧文件夹不会被改动或删除 */
  migrate(root: string): Promise<MigrationResult>
```

3. `let current: Open | null = null` 后面加 `let migrating = false`。

4. 在 `openAt` 函数后面、`return {` 之前加：

```ts
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
```

5. `isOpen` 和 `ctx` 改成：

```ts
    isOpen: () => current !== null && !migrating,
    ctx() {
      if (migrating) throw new DomainError('invalid', '正在迁移工作区，请稍等')
      if (!current) throw new DomainError('invalid', '还没有选择工作区')
      return current.ctx
    },
```

6. `inspect`、`initialize`、`open` 三项换成下面这些，后面补上 `migrate`，`close` 保留：

```ts
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
```

- [ ] **Step 5: `src/main/ipc/index.ts`，把 `'workspace:open'` 一行换成下面两项**

```ts
    'workspace:open': async ({ root }) => {
      const folder = s.folder.parse(root)
      if (session.isOpen()) await ai.abortAll() // 换工作区之前先中止进行中的管家对话
      return session.open(folder)
    },
    'workspace:migrate': async ({ root }) => {
      const folder = s.folder.parse(root)
      await ai.abortAll()
      return session.migrate(folder)
    },
```

- [ ] **Step 6: 类型检查和构建**

Run: `npm run typecheck && npm run build`
Expected: 两个都退出码 0（构建里关于 zod 注释的黄色警告是原来就有的，不用管）。

- [ ] **Step 7: 提交**

```bash
git add src/shared/paths.ts src/shared/views.ts src/shared/ipc.ts src/main/app/migrate.ts src/main/app/session.ts src/main/ai/service.ts src/main/ipc/index.ts
git commit -m "feat(workspace): migrate or switch the workspace from the session"
```

### Task 4: 设置页的迁移入口

**Files:**
- Create: `src/renderer/src/components/WorkspaceMove.tsx`
- Modify: `src/renderer/src/pages/Settings.tsx`、`src/renderer/src/app.css`、`README.md`

- [ ] **Step 1: 创建 `src/renderer/src/components/WorkspaceMove.tsx`**

```tsx
import { useState } from 'react'
import type { FolderInfo } from '../../../shared/views'
import type { Action } from '../hooks/useAction'

type Step =
  | { kind: 'idle' }
  | { kind: 'migrate'; folder: string }
  | { kind: 'switch'; folder: string }
  | { kind: 'refused'; folder: string; reason: string }
  | { kind: 'done'; mode: 'migrate' | 'switch'; from: string; to: string; skipped: string[] }

function decide(folder: string, info: FolderInfo): Step {
  if (info.blocked) return { kind: 'refused', folder, reason: info.blocked }
  return info.initialized ? { kind: 'switch', folder } : { kind: 'migrate', folder }
}

/** 设置页“工作区”卡片里的迁移入口：选文件夹、确认、执行。出错时错误显示在页面顶部（act.error） */
export default function WorkspaceMove({ root, act }: { root: string; act: Action }) {
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const cancel = (): void => setStep({ kind: 'idle' })

  const choose = (): Promise<boolean> =>
    act.run(async () => {
      const folder = await window.butler.invoke('workspace:pick')
      if (!folder) return
      setStep(decide(folder, await window.butler.invoke('workspace:inspect', { root: folder })))
    })

  const migrate = (to: string): Promise<boolean> =>
    act.run(async () => {
      const result = await window.butler.invoke('workspace:migrate', { root: to })
      setStep({ kind: 'done', mode: 'migrate', from: root, to: result.workspaceRoot, skipped: result.skipped })
    })

  const switchTo = (to: string): Promise<boolean> =>
    act.run(async () => {
      const state = await window.butler.invoke('workspace:open', { root: to })
      setStep({ kind: 'done', mode: 'switch', from: root, to: state.workspaceRoot ?? to, skipped: [] })
    })

  return (
    <>
      {step.kind === 'migrate' && (
        <section className="banner" aria-label="确认迁移">
          <p>
            把工作区迁移到 <strong className="path">{step.folder}</strong>。程序会先复制全部数据并逐个检查，没问题再切换过去。旧文件夹{' '}
            <span className="path">{root}</span> 原样保留。
          </p>
          <div className="actions">
            <button type="button" disabled={act.busy} onClick={cancel}>
              取消
            </button>
            <button type="button" className="primary" disabled={act.busy} onClick={() => migrate(step.folder)}>
              {act.busy ? '迁移中…' : '迁移'}
            </button>
          </div>
        </section>
      )}
      {step.kind === 'switch' && (
        <section className="banner" aria-label="确认切换">
          <p>
            <strong className="path">{step.folder}</strong> 里已经有一个 Butler 工作区。切换过去会改用那里的数据，不会和现在的合并，现在这个工作区也不会被删除。
          </p>
          <div className="actions">
            <button type="button" disabled={act.busy} onClick={cancel}>
              取消
            </button>
            <button type="button" className="primary" disabled={act.busy} onClick={() => switchTo(step.folder)}>
              切换
            </button>
          </div>
        </section>
      )}
      {step.kind === 'refused' && (
        <section className="banner danger" role="alert">
          <p>{step.reason}</p>
          <p className="hint path">选的是：{step.folder}</p>
        </section>
      )}
      {step.kind === 'done' && (
        <section className="banner" role="status">
          {step.mode === 'migrate' ? (
            <p>
              已迁移到 <span className="path">{step.to}</span>。旧文件夹 <span className="path">{step.from}</span> 还在，确认新位置没问题后可以自己删除。
            </p>
          ) : (
            <p>
              已切换到 <span className="path">{step.to}</span>。原来的工作区 <span className="path">{step.from}</span> 没有改动，也没有和这边合并。
            </p>
          )}
          {step.skipped.length > 0 && <p className="hint">旧文件夹里这些不属于 Butler 的内容没有搬：{step.skipped.join('、')}。</p>}
        </section>
      )}
      {(step.kind === 'idle' || step.kind === 'refused' || step.kind === 'done') && (
        <div className="actions">
          <button type="button" disabled={act.busy} onClick={choose}>
            迁移到其他位置…
          </button>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: `src/renderer/src/pages/Settings.tsx`**

顶部加 `import WorkspaceMove from '../components/WorkspaceMove'`。工作区卡片改成：

```tsx
      <section className="card" aria-labelledby="workspace-title">
        <h2 id="workspace-title">工作区</h2>
        <p className="path">{data.workspaceRoot}</p>
        <p className="hint">所有数据都在这个文件夹里。data 文件夹是程序读写的原始数据，其余 .md 是自动生成给你看的。</p>
        <WorkspaceMove root={data.workspaceRoot} act={act} />
      </section>
```

- [ ] **Step 3: `src/renderer/src/app.css`，在 `.step { … }` 后面加**

```css
.path {
  overflow-wrap: anywhere;
}
```

- [ ] **Step 4: `README.md`，在“数据在哪”一节后面、`## 改错了怎么办` 之前加**

```markdown
## 迁移工作区

设置页 → “工作区” → “迁移到其他位置…”，选一个空文件夹（还不存在的也行，会自动创建）。程序先把数据复制过去并逐个检查，没问题才切换；旧文件夹原样留着，确认新位置没问题后可以自己删。中途出错会回到原来的工作区，什么都不会变。

选到的文件夹里如果已经有 Butler 工作区（比如你在别的电脑上复制过来的），会问你要不要“切换”过去：用的是那边的数据，不会和现在的合并。

只搬 Butler 自己管的内容（`data/`、`管家人格.md`、`课表.md`、生成的 `.md` 和几个文件夹）。旧文件夹里别的文件（比如 `.git`）不会搬，完成后会告诉你有哪些没搬。
```

- [ ] **Step 5: 类型检查和构建**

Run: `npm run typecheck && npm run build`
Expected: 都退出码 0。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/components/WorkspaceMove.tsx src/renderer/src/pages/Settings.tsx src/renderer/src/app.css README.md
git commit -m "feat(ui): move the workspace from the settings page"
```

### Task 5: 在真实的 Electron 里验证（脚本放在仓库外，用完删除）

**Files:** Create `%TEMP%\butler-verify-migrate.mjs`（系统临时目录，不进仓库）

脚本用 `createRequire('D:/dev/butler-app/package.json')('@playwright/test')` 取 `_electron`，去掉环境变量 `ELECTRON_RUN_AS_NODE` 后启动 `D:/dev/butler-app`（读 `out/`，所以先构建）。`BUTLER_USER_DATA_DIR` 和 `BUTLER_DEFAULT_WORKSPACE` 都指向系统临时目录下新建的文件夹，不会碰真实的 `%APPDATA%\butler` 和正在用的工作区。用 `app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }) }, folder)` 代替系统的选文件夹窗口，用 `window.evaluate(() => window.butler.invoke(...))` 造数据和查结果。

- [ ] **Step 1: 构建**：`npm run build`，期望退出码 0。
- [ ] **Step 2: 写脚本，依次覆盖四种情况，每项打印 PASS 或 FAIL**
  - A. 正常迁移：第一次运行后加体重和任务，旧文件夹里另放 `extra.txt` 和 `.git/`；迁移到两层都不存在的新路径。期望：新位置有 `data/settings.json`、`data/tasks.json`、`data/.history`、`管家人格.md`、`课表.md`、`今日.md`；完成提示里列出 `extra.txt` 和 `.git`；旧文件夹里每个文件的哈希迁移前后一致；`config.json` 指向新路径；设置页显示新路径；`history:undo` 能撤销迁移前的最后一次改动；之后新增的任务只出现在新位置。
  - B. 选非空文件夹：期望提示“不是空的”，没有“迁移”按钮，配置没变。
  - C. 切换到已有工作区：在新位置里选回旧文件夹，期望出现“切换”并成功，设置页显示旧路径，旧文件夹的任务里没有迁移后新增的那个。
  - D. 复制中途失败：用 PowerShell 以 `FileShare.None` 独占打开旧工作区的 `课表.md`（它排在 `data` 和 `管家人格.md` 之后），先确认 Node 读它会报错；再迁移到两层都不存在的路径。期望：页面顶部出现“迁移失败”；新位置的两层文件夹都被清掉；配置没变；程序还能新增任务，且写进旧文件夹。
- [ ] **Step 3: 运行**：`node "%TEMP%\butler-verify-migrate.mjs"`（在仓库根目录运行），期望四项全部 PASS，退出码 0。有 FAIL 就按输出修代码，重新构建再跑。
- [ ] **Step 4: 清理**：删掉脚本目录和脚本建的临时文件夹；确认 `git status` 里没有多出来的文件，也没有残留的 Electron 进程。

### Task 6: 收尾

- [ ] **Step 1:** `git log --oneline -5` 和 `git status` 确认三次提交都在、工作区干净。
- [ ] **Step 2:** 告诉用户做完了什么、验证了什么。是否推送到 GitHub、是否重新打包安装包（会覆盖 `release/Butler-Setup-0.1.0.exe`）由用户决定。

## 自检

- 设计文档 3 到 7 节都有对应任务：界面（Task 4）、搬什么（Task 2）、实现（Task 2、3、4）、出错与边界（Task 3 的 `migrate`、`reopenPrevious`、`createCopyJob`）、验证（Task 5）。
- 名字前后一致：`createCopyJob` 返回 `CopyJob { run, undo }`；`FolderInfo.blocked`；`MigrationResult { workspaceRoot, skipped }`；`workspace:migrate` 在 `IpcMap`、`channelTable`、处理函数三处都有。
- 没有占位内容：每个改动都给了完整代码或精确的替换位置。

