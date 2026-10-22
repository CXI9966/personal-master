import type { LearningCheck } from '../../shared/schema'

/** 学习检验的顺序号：现有最大序号 + 1 */
export function nextLearningSeq(entries: LearningCheck[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.seq), 0) + 1
}

/** 1 → L-0001，方便人看 */
export function formatSeq(seq: number): string {
  return `L-${String(seq).padStart(4, '0')}`
}
