import type { UsageFeatureName, UsageSummary } from './ai'

export const FEATURE_NAMES: Record<UsageFeatureName, string> = {
  chat: '聊天',
  plan: '排计划',
  review: '复盘检验',
  weekly: '周报点评',
  pet: '桌宠台词',
}
export const FEATURES = Object.keys(FEATURE_NAMES) as UsageFeatureName[]

/** 一周用量的一句话说明：没调用就直说 */
export function usageLine(usage: UsageSummary): string {
  const { total, byFeature } = usage
  if (total.calls === 0) return '这一周没有调用管家'
  const parts = FEATURES.flatMap((feature) => {
    const t = byFeature[feature]
    return t ? [`${FEATURE_NAMES[feature]} ${t.calls} 次`] : []
  })
  return `调用 ${total.calls} 次，输入 ${total.inputTokens} token，输出 ${total.outputTokens} token（${parts.join('、')}）`
}
