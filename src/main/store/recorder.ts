import type { PreImage } from './history'

/**
 * 一次 batch 里每个文件第一次被碰之前的样子。
 * applied 表示改动是否已经落盘：回滚时只还原已落盘的，没写进去的不用动。
 */
export class Recorder {
  private readonly entries = new Map<string, { image: PreImage; applied: boolean }>()

  get size(): number {
    return this.entries.size
  }

  has(rel: string): boolean {
    return this.entries.has(rel)
  }

  kindOf(rel: string): PreImage['kind'] | undefined {
    return this.entries.get(rel)?.image.kind
  }

  add(image: PreImage): void {
    this.entries.set(image.rel, { image, applied: false })
  }

  markApplied(rel: string): void {
    const entry = this.entries.get(rel)
    if (entry) entry.applied = true
  }

  /** 写进改动历史的全部内容 */
  list(): PreImage[] {
    return [...this.entries.values()].map((entry) => entry.image)
  }

  /** 需要回滚的，最后改的先还原 */
  appliedForRollback(): PreImage[] {
    return [...this.entries.values()]
      .filter((entry) => entry.applied)
      .map((entry) => entry.image)
      .reverse()
  }
}
