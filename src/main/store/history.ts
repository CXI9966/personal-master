import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { formatISO } from 'date-fns'

/** 一次改动前某个文件的样子 */
export type PreImage =
  | { rel: string; kind: 'text'; text: string } // 改动前的完整内容
  | { rel: string; kind: 'absent' } // 改动前文件不存在
  | { rel: string; kind: 'truncate'; length: number } // 追加类文件：改动前的字节数，撤销时截断

export interface ManifestFile {
  rel: string
  kind: PreImage['kind']
  blob?: string
  length?: number
}

export interface Manifest {
  id: string
  seq: number
  label: string
  at: string
  files: ManifestFile[]
}

export interface ChangeInfo {
  id: string
  label: string
}

const dirNameOf = (m: Manifest): string => `${String(m.seq).padStart(8, '0')}-${m.id}`

/**
 * 改动历史：每次改动前把受影响文件的原样存进 data/.history/<序号>-<id>/，只留最近 limit 次。
 * manifest.json 最后写入，写到一半崩溃留下的目录没有 manifest，加载时会被忽略。
 */
export class History {
  private entries: Manifest[] = []
  private nextSeq = 1

  constructor(
    private readonly dir: string,
    private readonly limit: number,
    private readonly now: () => Date,
  ) {}

  async load(): Promise<void> {
    this.entries = []
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return
    }
    for (const name of names) {
      try {
        const manifest = JSON.parse(await readFile(join(this.dir, name, 'manifest.json'), 'utf8')) as Manifest
        this.entries.push(manifest)
      } catch {
        // 跳过没写完或损坏的记录
      }
    }
    this.entries.sort((a, b) => a.seq - b.seq)
    this.nextSeq = (this.entries.at(-1)?.seq ?? 0) + 1
  }

  last(): ChangeInfo | null {
    const entry = this.entries.at(-1)
    return entry ? { id: entry.id, label: entry.label } : null
  }

  lastEntry(): Manifest | null {
    return this.entries.at(-1) ?? null
  }

  async commit(label: string, images: PreImage[]): Promise<Manifest> {
    const id = randomUUID()
    const seq = this.nextSeq++
    const manifest: Manifest = { id, seq, label, at: formatISO(this.now()), files: [] }
    const dir = join(this.dir, dirNameOf(manifest))
    await mkdir(dir, { recursive: true })
    for (const [index, image] of images.entries()) {
      if (image.kind === 'text') {
        const blob = `${index}.bin`
        await writeFile(join(dir, blob), image.text, 'utf8')
        manifest.files.push({ rel: image.rel, kind: 'text', blob })
      } else if (image.kind === 'truncate') {
        manifest.files.push({ rel: image.rel, kind: 'truncate', length: image.length })
      } else {
        manifest.files.push({ rel: image.rel, kind: 'absent' })
      }
    }
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    this.entries.push(manifest)
    while (this.entries.length > this.limit) {
      const oldest = this.entries.shift()
      if (oldest) await rm(join(this.dir, dirNameOf(oldest)), { recursive: true, force: true })
    }
    return manifest
  }

  /** 撤销完成后，删掉最近一次的记录 */
  async popLast(): Promise<void> {
    const entry = this.entries.pop()
    if (entry) await rm(join(this.dir, dirNameOf(entry)), { recursive: true, force: true })
  }

  async readBlob(entry: Manifest, file: ManifestFile): Promise<string> {
    if (!file.blob) throw new Error(`历史记录缺少备份内容：${file.rel}`)
    return readFile(join(this.dir, dirNameOf(entry), file.blob), 'utf8')
  }

  /** 这个文件最近一份完整备份（最新的改动记录往前找） */
  async latestTextSnapshot(rel: string): Promise<string | null> {
    for (const entry of [...this.entries].reverse()) {
      const file = entry.files.find((f) => f.rel === rel && f.kind === 'text')
      if (file) {
        try {
          return await this.readBlob(entry, file)
        } catch {
          // 备份文件丢了就继续往前找
        }
      }
    }
    return null
  }
}
