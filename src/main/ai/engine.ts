import type { ActionCard } from '../../shared/ai'
import { formatIssues, zhParse } from '../../shared/issues'
import type { AppContext } from '../app/context'
import { DomainError } from '../domain/errors'
import { WorkspaceError } from '../store/errors'
import type { ActionDef } from './actions'

/** 模型提出的一次工具调用 */
export interface ProposedCall {
  id: string
  name: string
  input: unknown
  /** SDK 自己发现参数有问题时的原因（不是合法 JSON、不符合 schema） */
  invalidReason?: string
}

export type Checked =
  | { ok: true; call: ProposedCall; def: ActionDef; args: unknown; summary: string }
  | { ok: false; call: ProposedCall; message: string }

export interface ExecutionOutcome {
  /** 查询没有卡片 */
  card: ActionCard | null
  /** 给模型看的执行结果 */
  result: string
}

const messageOf = (error: unknown): string =>
  error instanceof DomainError || error instanceof WorkspaceError ? error.message : error instanceof Error ? error.message : String(error)

/**
 * 校验一次调用：动作存在、参数合法、引用的任务找得到（describe 会去查）。
 * 全部通过才会执行；任何一个有问题，整批都不执行，把原因发回给模型重试。
 */
export async function checkCall(ctx: AppContext, call: ProposedCall, allowed: ActionDef[]): Promise<Checked> {
  const def = allowed.find((candidate) => candidate.name === call.name)
  if (!def) {
    return { ok: false, call, message: `没有叫 ${call.name} 的动作。可用的动作：${allowed.map((d) => d.name).join('、')}` }
  }
  if (call.invalidReason) return { ok: false, call, message: `动作 ${call.name} 的参数有误：${call.invalidReason}` }
  const parsed = def.schema.safeParse(call.input, zhParse)
  if (!parsed.success) return { ok: false, call, message: `动作 ${call.name} 的参数有误：${formatIssues(parsed.error)}` }
  try {
    return { ok: true, call, def, args: parsed.data, summary: await def.describe(ctx, parsed.data) }
  } catch (error) {
    return { ok: false, call, message: `动作 ${call.name} 无法执行：${messageOf(error)}` }
  }
}

interface Pending {
  def: ActionDef
  args: unknown
  card: ActionCard
}

/** 执行动作、管理“待确认”的大改动 */
export class ActionEngine {
  private readonly pending = new Map<string, Pending>()

  constructor(
    private readonly ctx: AppContext,
    private readonly newId: () => string,
  ) {}

  /** 执行一个已经校验通过的动作：小改动和查询直接做，大改动存起来等确认 */
  async execute(checked: Extract<Checked, { ok: true }>): Promise<ExecutionOutcome> {
    const { def, args, summary } = checked
    if (def.kind === 'query') {
      try {
        return { card: null, result: await def.run(this.ctx, args) }
      } catch (error) {
        return { card: null, result: `查询失败：${messageOf(error)}` }
      }
    }
    const card: ActionCard = { id: this.newId(), name: def.name, level: def.level, summary, status: 'pending' }
    if (def.level === 'big') {
      this.pending.set(card.id, { def, args, card })
      return { card, result: '已提交给用户确认，用户点击确认后才会生效，在那之前不要说已经改好了。' }
    }
    return this.apply(def, args, card)
  }

  /** 用户点了确认或取消 */
  async confirm(cardId: string, accept: boolean): Promise<ActionCard> {
    const pending = this.pending.get(cardId)
    if (!pending) throw new DomainError('not-found', '这个待确认的操作已经过期了，请让管家重新提出')
    this.pending.delete(cardId)
    if (!accept) return { ...pending.card, status: 'cancelled' }
    return (await this.apply(pending.def, pending.args, pending.card)).card as ActionCard
  }

  hasPending(): boolean {
    return this.pending.size > 0
  }

  clearPending(): void {
    this.pending.clear()
  }

  private async apply(def: ActionDef, args: unknown, card: ActionCard): Promise<ExecutionOutcome> {
    try {
      const result = await def.run(this.ctx, args)
      return { card: { ...card, status: 'applied', changeId: this.ctx.ws.lastChange()?.id }, result }
    } catch (error) {
      const message = messageOf(error)
      return { card: { ...card, status: 'failed', error: message }, result: `执行失败：${message}` }
    }
  }
}
