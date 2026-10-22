import type { CheckResult, Checkin, Energy } from './schema'

/** 每个生成的 .md 的第一行 */
export const GENERATED_MARKER = '> 由 Butler 客户端根据 data/ 生成，改这里会被覆盖。要改请在客户端里改。'

export const ENERGY_LABELS: Record<Energy, string> = {
  high: '😀 满电',
  mid: '😐 一般',
  low: '😫 疲惫',
}

export const RESULT_LABELS: Record<CheckResult, string> = {
  mastered: '掌握',
  partial: '部分掌握',
  missed: '没掌握',
}

export const SOURCE_LABELS: Record<Checkin['source'], string> = {
  desktop: '电脑',
  phone: '手机',
}
