import { appendFile, mkdir, open, readFile, rm, stat, truncate } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { z, ZodType } from 'zod'
import { formatIssues, zhParse } from '../../shared/issues'
import { writeFileAtomic, type AtomicWriteOptions } from './atomic'
import { WorkspaceError } from './errors'
import { History, type ChangeInfo, type PreImage } from './history'
import { parseJsonl, stripBom, type LinesResult } from './jsonl'
import { WriteQueue } from './queue'
import { Recorder } from './recorder'
import type { OpenOptions, Tx, Workspace } from './types'
import { startWatcher, type ExternalWatcher } from './watcher'

export type { OpenOptions, Tx, Workspace } from './types'
export { WorkspaceError } from './errors'

// Windows 上目标文件被占用时 rename 报这几种
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])
const isEnoent = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT'
const normalizeRel = (rel: string): string => rel.replace(/\\/g, '/')

function resolveInside(root: string, rel: string): string {
  const bad = (): WorkspaceError => new WorkspaceError('bad-path', rel, `路径必须是工作区内的相对路径：${rel}`)
  if (isAbsolute(rel)) throw bad()
  const abs = resolve(root, rel)
  const diff = relative(root, abs)
  if (diff === '' || diff === '..' || diff.startsWith(`..${sep}`) || isAbsolute(diff)) throw bad()
  return abs
}

class WorkspaceImpl implements Workspace {
  private readonly queue = new WriteQueue()
  private readonly listeners = new Set<(rel: string) => void>()
  private watcher: ExternalWatcher | null = null

  constructor(
    readonly root: string,
    private readonly history: History,
    private readonly atomic: AtomicWriteOptions,
    private readonly onWarn: (message: string) => void,
  ) {}

  attachWatcher(watcher: ExternalWatcher): void {
    this.watcher = watcher
  }

  emitExternal(rels: string[]): void {
    for (const rel of rels) for (const listener of this.listeners) listener(rel)
  }

  // ---------- 队列外的底层操作（调用方必须已经在队列里） ----------

  private abs(rel: string): string {
    return resolveInside(this.root, rel)
  }

  private mark(abs: string): void {
    this.watcher?.markSelf(abs)
  }

  private async readTextRaw(rel: string): Promise<string | null> {
    try {
      return stripBom(await readFile(this.abs(rel), 'utf8'))
    } catch (error) {
      if (isEnoent(error)) return null
      throw error
    }
  }

  private async readJsonRaw<S extends ZodType>(rel: string, schema: S, fallback?: () => z.output<S>): Promise<z.output<S>> {
    const text = await this.readTextRaw(rel)
    if (text === null) {
      if (fallback) return fallback()
      throw new WorkspaceError('missing', rel, `找不到文件：${rel}`)
    }
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch (cause) {
      throw new WorkspaceError('corrupt', rel, `${rel} 不是合法的 JSON：${(cause as Error).message}`, { cause })
    }
    const result = schema.safeParse(data, zhParse)
    if (!result.success) {
      throw new WorkspaceError('invalid', rel, `${rel} 内容格式不对：${formatIssues(result.error)}`, { cause: result.error })
    }
    return result.data
  }

  private validate<S extends ZodType>(rel: string, value: z.input<S>, schema: S): z.output<S> {
    const result = schema.safeParse(value, zhParse)
    if (!result.success) {
      throw new WorkspaceError('invalid', rel, `${rel} 的数据格式不对：${formatIssues(result.error)}`, { cause: result.error })
    }
    return result.data
  }

  private async writeRaw(rel: string, text: string): Promise<void> {
    const abs = this.abs(rel)
    await mkdir(dirname(abs), { recursive: true })
    this.mark(abs)
    try {
      await writeFileAtomic(abs, text, this.atomic)
    } catch (error) {
      if (BUSY.has((error as NodeJS.ErrnoException).code ?? '')) {
        throw new WorkspaceError('busy', rel, `文件被其他程序占用：${rel}`, { cause: error })
      }
      throw error
    }
    this.mark(abs)
  }

  /** 把文件还原成改动前的样子（撤销和回滚共用） */
  private async applyImage(image: PreImage): Promise<void> {
    const abs = this.abs(image.rel)
    if (image.kind === 'text') {
      await this.writeRaw(image.rel, image.text)
      return
    }
    this.mark(abs)
    try {
      if (image.kind === 'absent') await rm(abs, { force: true })
      else await truncate(abs, image.length)
    } catch (error) {
      if (!isEnoent(error)) throw error
    }
    this.mark(abs)
  }
  // ---------- 带改动记录的写入 ----------

  private async writeTracked(rec: Recorder, rel: string, text: string): Promise<void> {
    const abs = this.abs(rel)
    if (rec.kindOf(rel) === 'truncate') throw new Error(`同一次改动里不能对 ${rel} 混用覆盖写和追加`)
    if (!rec.has(rel)) {
      try {
        rec.add({ rel, kind: 'text', text: await readFile(abs, 'utf8') }) // 原样保存，撤销时字节级还原
      } catch (error) {
        if (!isEnoent(error)) throw error
        rec.add({ rel, kind: 'absent' })
      }
    }
    await this.writeRaw(rel, text)
    rec.markApplied(rel)
  }

  private async appendTracked(rec: Recorder, rel: string, line: string): Promise<void> {
    const abs = this.abs(rel)
    if (rec.kindOf(rel) === 'text') throw new Error(`同一次改动里不能对 ${rel} 混用覆盖写和追加`)
    let size = 0
    let exists = true
    try {
      size = (await stat(abs)).size
    } catch (error) {
      if (!isEnoent(error)) throw error
      exists = false
    }
    if (!rec.has(rel)) rec.add(exists ? { rel, kind: 'truncate', length: size } : { rel, kind: 'absent' })
    await mkdir(dirname(abs), { recursive: true })
    // 上次写到一半的半行没有换行，先补一个，免得新行粘在它后面
    let prefix = ''
    if (size > 0) {
      const handle = await open(abs, 'r')
      try {
        const last = Buffer.alloc(1)
        await handle.read(last, 0, 1, size - 1)
        if (last[0] !== 0x0a) prefix = '\n'
      } finally {
        await handle.close()
      }
    }
    this.mark(abs)
    rec.markApplied(rel) // 追加可能已写入一部分，保守地算已落盘
    await appendFile(abs, `${prefix}${line}\n`, 'utf8')
    this.mark(abs)
  }

  private makeTx(rec: Recorder): Tx {
    return {
      readJson: (rel, schema, fallback) => this.readJsonRaw(normalizeRel(rel), schema, fallback),
      readLines: async (rel, schema) => {
        const text = await this.readTextRaw(normalizeRel(rel))
        return text === null ? { items: [], skipped: [] } : parseJsonl(text, schema)
      },
      readText: (rel) => this.readTextRaw(normalizeRel(rel)),
      writeJson: async (rel, value, schema) => {
        const r = normalizeRel(rel)
        return this.writeTracked(rec, r, `${JSON.stringify(this.validate(r, value, schema), null, 2)}\n`)
      },
      writeText: (rel, text) => this.writeTracked(rec, normalizeRel(rel), text),
      appendLine: async (rel, value, schema) => {
        const r = normalizeRel(rel)
        return this.appendTracked(rec, r, JSON.stringify(this.validate(r, value, schema)))
      },
    }
  }
  // ---------- 对外接口 ----------

  readJson<S extends ZodType>(rel: string, schema: S, fallback?: () => z.output<S>): Promise<z.output<S>> {
    return this.queue.run(() => this.readJsonRaw(normalizeRel(rel), schema, fallback))
  }

  readLines<S extends ZodType>(rel: string, schema: S): Promise<LinesResult<z.output<S>>> {
    return this.queue.run(() => this.makeTx(new Recorder()).readLines(rel, schema))
  }

  readText(rel: string): Promise<string | null> {
    return this.queue.run(() => this.readTextRaw(normalizeRel(rel)))
  }

  writeJson<S extends ZodType>(rel: string, value: z.input<S>, schema: S): Promise<void> {
    return this.batch(`写入 ${rel}`, (tx) => tx.writeJson(rel, value, schema))
  }

  writeText(rel: string, text: string): Promise<void> {
    return this.batch(`写入 ${rel}`, (tx) => tx.writeText(rel, text))
  }

  appendLine<S extends ZodType>(rel: string, value: z.input<S>, schema: S): Promise<void> {
    return this.batch(`追加 ${rel}`, (tx) => tx.appendLine(rel, value, schema))
  }

  writeGenerated(rel: string, text: string): Promise<void> {
    return this.queue.run(async () => {
      const r = normalizeRel(rel)
      if ((await this.readTextRaw(r)) === text) return
      await this.writeRaw(r, text)
    })
  }

  batch<T>(label: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      const rec = new Recorder()
      let result: T
      try {
        result = await fn(this.makeTx(rec))
      } catch (error) {
        for (const image of rec.appliedForRollback()) await this.applyImage(image).catch(() => undefined)
        throw error
      }
      if (rec.size > 0) {
        try {
          await this.history.commit(label, rec.list())
        } catch (error) {
          this.onWarn(`记录改动历史失败：${String(error)}`) // 数据已经写好了，不能因为这个让调用方以为写失败
        }
      }
      return result
    })
  }

  lastChange(): ChangeInfo | null {
    return this.history.last()
  }

  undo(changeId: string): Promise<boolean> {
    return this.queue.run(async () => {
      const entry = this.history.lastEntry()
      if (!entry || entry.id !== changeId) return false
      const images: PreImage[] = []
      for (const file of entry.files) {
        if (file.kind === 'text') images.push({ rel: file.rel, kind: 'text', text: await this.history.readBlob(entry, file) })
        else if (file.kind === 'truncate') images.push({ rel: file.rel, kind: 'truncate', length: file.length ?? 0 })
        else images.push({ rel: file.rel, kind: 'absent' })
      }
      for (const image of images.reverse()) await this.applyImage(image)
      await this.history.popLast()
      return true
    })
  }

  restoreFromHistory(rel: string): Promise<boolean> {
    const r = normalizeRel(rel)
    return this.batch(`恢复 ${r}`, async (tx) => {
      const text = await this.history.latestTextSnapshot(r)
      if (text === null) return false
      await tx.writeText(r, text)
      return true
    })
  }

  onExternalChange(callback: (rel: string) => void): () => void {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  async close(): Promise<void> {
    await this.queue.run(async () => undefined) // 等已提交的操作做完
    await this.watcher?.close()
    this.watcher = null
  }
}

export async function openWorkspace(root: string, options: OpenOptions = {}): Promise<Workspace> {
  const absRoot = resolve(root)
  await mkdir(join(absRoot, 'data'), { recursive: true })
  const history = new History(join(absRoot, 'data', '.history'), options.historyLimit ?? 50, options.now ?? (() => new Date()))
  await history.load()
  const workspace = new WorkspaceImpl(absRoot, history, options.atomic ?? {}, options.onWarn ?? (() => undefined))
  if (options.watch !== false) {
    workspace.attachWatcher(
      await startWatcher({
        root: absRoot,
        debounceMs: options.debounceMs ?? 300,
        selfWriteWindowMs: options.selfWriteWindowMs ?? 1000,
        onChange: (rels) => workspace.emitExternal(rels),
        onError: (error) => (options.onWarn ?? (() => undefined))(`监听出错：${String(error)}`),
      }),
    )
  }
  return workspace
}
