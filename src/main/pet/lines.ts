import { splitPersona } from '../../shared/persona'
import { PERSONA_PRESETS } from '../init/personas'
import type { PetEventKind, PetSummary } from './summary'

export type Voice = 'coach' | 'gentle' | 'strict' | 'whale' | 'neutral'

/** 管家人格.md 的“说话风格”和哪套预设一样，就用哪套台词；对不上用中性 */
export function voiceOf(personaMarkdown: string): Voice {
  const style = splitPersona(personaMarkdown)?.说话风格.trim()
  if (!style) return 'neutral'
  return PERSONA_PRESETS.find((preset) => preset.sections.说话风格.trim() === style)?.id ?? 'neutral'
}

type LineTable = Record<PetEventKind, readonly [string, string]>

const COACH: LineTable = {
  wake: ['起床打卡，漂亮，今天开个好头。', '醒了就赢了一半，今天冲。'],
  sleep: ['睡前打卡收到，今天辛苦了。', '今天收工，睡个好觉明天接着干。'],
  taskDone: ['又拿下一个，稳。', '这个搞定了，下一个等你。'],
  planned: ['计划排好了，目标清楚就好办。', '今天的路线有了，开干。'],
  reviewed: ['复盘写完了，这一步最值钱。', '复盘完成，明天会更稳。'],
  remindPlan: ['今天还没排计划，两分钟的事。', '先把今天排一下，再开始干活。'],
  remindReview: ['还没复盘，写几句就好。', '收个尾，把今天复盘一下。'],
  welcomeBack: ['欢迎回来，今天最想推进哪一件？', '回来就好，先挑一件最想做的。'],
}

const GENTLE: LineTable = {
  wake: ['早上好，起床打卡收到了。', '醒了呀，今天慢慢来。'],
  sleep: ['睡前打卡收到，晚安。', '今天先到这里，好好休息。'],
  taskDone: ['完成了一个，辛苦了。', '又做完一件，慢慢来也很好。'],
  planned: ['计划排好了，按自己的节奏来。', '今天的安排有了，不用着急。'],
  reviewed: ['复盘写好了，谢谢你认真对待今天。', '回顾完了，可以放松一下了。'],
  remindPlan: ['要不要花两分钟，看看今天想做什么？', '今天还没排计划，想先做哪一件呢？'],
  remindReview: ['想不想写几句今天的感受？', '今天的复盘还空着，有空的时候写几句就好。'],
  welcomeBack: ['欢迎回来。', '回来了呀，今天想先做哪一件？'],
}

const STRICT: LineTable = {
  wake: ['起床打卡，记录在案。', '已打卡。开始今天的任务。'],
  sleep: ['睡前打卡，记录在案。', '今天结束。按时睡觉。'],
  taskDone: ['任务完成。下一个。', '完成一项。继续。'],
  planned: ['计划已定，按计划执行。', '计划确认。不要拖。'],
  reviewed: ['复盘完成。明天改进。', '复盘记录在案。'],
  remindPlan: ['今天的计划还没排。现在排。', '计划未定。立刻安排。'],
  remindReview: ['复盘未完成。现在补上。', '今天的复盘还没写。写。'],
  welcomeBack: ['欢迎回来。今天先推进哪一件？', '回来了。说出今天最重要的一件事。'],
}

const WHALE: LineTable = {
  wake: ['噗——早上好，起床打卡收到。', '醒啦？我刚打完一个盹，今天一起干活。'],
  sleep: ['睡前打卡收到，我也要去打盹了。', '晚安，梦里记得分我一包零食。'],
  taskDone: ['又搞定一个，值得吃块小饼干。', '漂亮，这个我记下了。'],
  planned: ['计划排好了，我来盯着。', '今天的路线有了，出发。'],
  reviewed: ['复盘写完啦，奖励自己一点零食。', '复盘完成，明天继续一起冲。'],
  remindPlan: ['今天还没排计划呀，两分钟就好。', '先排个计划再摸鱼，我不告诉别人。'],
  remindReview: ['复盘还没写，写几句我就不碎碎念了。', '收个尾吧，写完就可以放心打盹。'],
  welcomeBack: ['欢迎回来，我一直在这里等你。', '终于回来啦，今天先做哪一件？'],
}

const NEUTRAL: LineTable = {
  wake: ['起床打卡完成。', '早上好，已记录起床打卡。'],
  sleep: ['睡前打卡完成。', '已记录睡前打卡，晚安。'],
  taskDone: ['完成了一个任务。', '又完成一个任务。'],
  planned: ['今天的计划排好了。', '计划已安排。'],
  reviewed: ['今天的复盘完成了。', '复盘已记录。'],
  remindPlan: ['今天还没排计划。', '该排今天的计划了。'],
  remindReview: ['今天还没复盘。', '该复盘了。'],
  welcomeBack: ['欢迎回来。', '欢迎回来，今天从哪件事开始？'],
}

const TABLES: Record<Voice, LineTable> = { coach: COACH, gentle: GENTLE, strict: STRICT, whale: WHALE, neutral: NEUTRAL }

/** 本地模板里随机取一句 */
export function pickLine(voice: Voice, kind: PetEventKind, random: () => number = Math.random): string {
  const options = TABLES[voice][kind]
  return options[Math.floor(random() * options.length) % options.length] ?? options[0]
}

/** 不用台词时，状态气泡里显示的固定短语 */
export const plainLine = (kind: PetEventKind): string => NEUTRAL[kind][0]

/** 按码点截断，超出的加省略号 */
export function shorten(text: string, max: number): string {
  const chars = [...text.trim().replace(/\s+/g, ' ')]
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`
}

/** 给模型看的事件事实：只有这件事本身，没有别的数据 */
export function describeEvent(kind: PetEventKind, summary: PetSummary | null): string {
  switch (kind) {
    case 'wake':
      return `用户刚刚完成了起床打卡${summary?.wakeClock ? `（${summary.wakeClock}）` : ''}。`
    case 'sleep':
      return `用户刚刚完成了睡前打卡。今天完成了 ${summary?.done ?? 0} 个任务。`
    case 'taskDone':
      return `用户刚刚完成了一个任务${summary?.lastDone ? `：「${shorten(summary.lastDone, 20)}」` : ''}。今天已完成 ${summary?.done ?? 0} 个。`
    case 'planned':
      return '用户刚刚排好了今天的计划。'
    case 'reviewed':
      return '用户刚刚完成了今天的复盘。'
    case 'remindPlan':
      return '现在到了提醒时间，用户今天还没排计划。'
    case 'remindReview':
      return '现在到了提醒时间，用户今天还没复盘。'
    case 'welcomeBack':
      return '用户隔了几天才回来。'
  }
}

export interface LineLimiter {
  /** 放行就记一笔并返回 true；离上次太近、或这一小时已经够多就返回 false */
  tryTake(now: number): boolean
}

/** 模型台词的限频：最短间隔（可随设置改变）加每小时上限。只在内存里，重启后重新计 */
export function createLineLimiter(options: { minIntervalMs: () => number; maxPerHour: number }): LineLimiter {
  const taken: number[] = []
  return {
    tryTake(now) {
      while (taken.length > 0 && now - (taken[0] ?? now) >= 3_600_000) taken.shift()
      const last = taken.at(-1)
      if (last !== undefined && now - last < options.minIntervalMs()) return false
      if (taken.length >= options.maxPerHour) return false
      taken.push(now)
      return true
    },
  }
}
