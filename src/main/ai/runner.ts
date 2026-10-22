import { streamText, tool, type LanguageModel, type ModelMessage, type ToolSet } from 'ai'
import type { AiEvent, AiEventBody, AiScene, ChatMessage } from '../../shared/ai'
import type { ActionMode, ContextStrategy, ProviderKind } from '../../shared/schema'
import type { AppContext } from '../app/context'
import { MUTATING, QUERIES, type ActionDef } from './actions'
import { buildContext } from './context'
import { checkCall, type ActionEngine, type Checked, type ProposedCall } from './engine'
import { extractJsonActions } from './jsonMode'
import { buildSystemPrompt } from './prompt'
import { describeAiError } from './provider'
import { logUsage } from './usage'

type EventBody = AiEventBody

export interface RunInput {
  ctx: AppContext
  engine: ActionEngine
  model: LanguageModel
  /** 用来给用量记录写 provider 和 model */
  provider: { kind: ProviderKind; model: string }
  actionMode: ActionMode
  contextStrategy: ContextStrategy
  persona: string
  scene: AiScene
  messages: ChatMessage[]
  signal: AbortSignal
  runId: string
  emit: (event: AiEvent) => void
  /** 同一次对话里最多跟模型来回几轮（查询工具会让它多来回几次），默认 4 */
  maxRounds?: number
  /** 网络类错误的自动重试次数，默认 1 */
  maxRetries?: number
}

interface Turn {
  text: string
  calls: ProposedCall[]
  usage?: { inputTokens?: number; outputTokens?: number }
  aborted: boolean
  error?: unknown
}

const asObject = (input: unknown): Record<string, unknown> =>
  typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as Record<string, unknown>) : {}

/** 和模型来回一轮，边收边把文字推给界面 */
async function streamTurn(input: RunInput, system: string, messages: ModelMessage[], tools: ToolSet | undefined, emit: (e: EventBody) => void): Promise<Turn> {
  const turn: Turn = { text: '', calls: [], aborted: false }
  const live = input.actionMode === 'tools' // JSON 模式要等全文出来才能去掉代码块，所以不边收边显示
  const result = streamText({
    model: input.model,
    instructions: system,
    messages,
    tools,
    maxOutputTokens: 4096,
    abortSignal: input.signal,
    maxRetries: input.maxRetries ?? 1,
    onError: ({ error }) => {
      turn.error = error
    },
  })
  try {
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        turn.text += part.text
        if (live) emit({ type: 'text', delta: part.text })
      } else if (part.type === 'tool-call') {
        turn.calls.push({
          id: part.toolCallId,
          name: part.toolName,
          input: part.input,
          invalidReason: part.invalid ? String(part.error ?? '参数无效') : undefined,
        })
      } else if (part.type === 'finish') {
        turn.usage = part.totalUsage
      } else if (part.type === 'error') {
        turn.error = part.error
      } else if (part.type === 'abort') {
        turn.aborted = true
      }
    }
  } catch (error) {
    if (input.signal.aborted) turn.aborted = true
    else turn.error = error
  }
  if (input.signal.aborted) turn.aborted = true
  return turn
}

const failureText = (checks: Checked[], call: ProposedCall): string => {
  const mine = checks.find((c) => c.call.id === call.id)
  return mine && !mine.ok ? mine.message : '没有执行：同一次回复里有别的动作的参数有误。请把所有动作改对，重新提出。'
}

/**
 * 一次对话：组装上下文 → 问模型 → 校验动作 → 执行（大改动等确认）。
 * 动作等整轮回复结束、全部校验通过才执行；有问题的整批不执行，把原因发回去让模型重试一次。
 */
export async function runChat(input: RunInput): Promise<void> {
  const { ctx, engine, signal } = input
  const emit = (event: EventBody): void => input.emit({ ...event, runId: input.runId } as AiEvent)
  const mode = input.actionMode
  // 查询工具只在“工具调用 + 让它自己按需查”时提供；JSON 模式下这个策略自动退回按场景
  const strategy: ContextStrategy = mode === 'json' && input.contextStrategy === 'tools' ? 'scene' : input.contextStrategy
  const allowed: ActionDef[] = mode === 'tools' && strategy === 'tools' ? [...MUTATING, ...QUERIES] : MUTATING
  const maxRounds = input.maxRounds ?? 4

  try {
    const context = await buildContext(ctx, { scene: input.scene, strategy })
    const system = buildSystemPrompt({ persona: input.persona, context, mode, actions: MUTATING })
    // 不写 execute：SDK 只把调用交给我们，什么时候执行由我们的校验和确认流程决定
    const tools: ToolSet | undefined =
      mode === 'tools'
        ? (Object.fromEntries(allowed.map((def) => [def.name, tool({ description: def.description, inputSchema: def.schema })])) as ToolSet)
        : undefined
    const messages: ModelMessage[] = input.messages.map((m) => ({ role: m.role, content: m.text }))
    let retried = false

    for (let round = 0; round < maxRounds; round++) {
      const turn = await streamTurn(input, system, messages, tools, emit)
      try {
        await logUsage(ctx, { provider: input.provider.kind, model: input.provider.model, feature: input.scene, usage: turn.usage })
      } catch {
        // 记用量失败不该影响对话
      }

      let text = turn.text
      let calls = turn.calls
      let jsonProblem: string | undefined
      if (mode === 'json') {
        const extracted = extractJsonActions(turn.text)
        text = extracted.text
        calls = extracted.calls
        jsonProblem = extracted.error
        if (text) emit({ type: 'text', delta: text })
      }
      if (turn.aborted) return void emit({ type: 'done', aborted: true }) // 中断了：一个动作也不执行
      if (turn.error) {
        emit({ type: 'error', message: describeAiError(turn.error) })
        return void emit({ type: 'done', aborted: false })
      }
      if (calls.length === 0 && !jsonProblem) return void emit({ type: 'done', aborted: false })

      const checks: Checked[] = []
      for (const call of calls) checks.push(await checkCall(ctx, call, allowed))
      const problems = checks.flatMap((c) => (c.ok ? [] : [c.message]))
      if (jsonProblem) problems.push(jsonProblem)

      if (problems.length > 0) {
        if (retried) {
          emit({ type: 'error', message: `管家两次给出的动作都有问题，这次没有执行任何改动：${problems.join('；')}` })
          return void emit({ type: 'done', aborted: false })
        }
        retried = true
        emit({ type: 'notice', text: '管家给出的动作有问题，已经让它重试一次' })
        if (mode === 'tools') {
          messages.push({
            role: 'assistant',
            content: [
              ...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []),
              ...calls.map((c) => ({ type: 'tool-call' as const, toolCallId: c.id, toolName: c.name, input: asObject(c.input) })),
            ],
          })
          messages.push({
            role: 'tool',
            content: calls.map((c) => ({
              type: 'tool-result' as const,
              toolCallId: c.id,
              toolName: c.name,
              output: { type: 'text' as const, value: failureText(checks, c) },
            })),
          })
        } else {
          messages.push({ role: 'assistant', content: turn.text })
          messages.push({ role: 'user', content: `你上一条回复里的动作有问题，一个都没有执行：\n${problems.join('\n')}\n请重新给出完整的回复和正确的动作。` })
        }
        continue
      }

      // 全部通过：按顺序执行
      const results: Array<{ call: ProposedCall; result: string }> = []
      let usedQuery = false
      for (const checked of checks) {
        if (!checked.ok) continue
        const outcome = await engine.execute(checked)
        if (outcome.card) emit({ type: 'action', card: outcome.card })
        if (checked.def.kind === 'query') usedQuery = true
        results.push({ call: checked.call, result: outcome.result })
      }
      if (!usedQuery || mode === 'json') return void emit({ type: 'done', aborted: false })

      // 用了查询工具，把结果交给模型，让它接着回答
      messages.push({
        role: 'assistant',
        content: [
          ...(turn.text ? [{ type: 'text' as const, text: turn.text }] : []),
          ...results.map(({ call }) => ({ type: 'tool-call' as const, toolCallId: call.id, toolName: call.name, input: asObject(call.input) })),
        ],
      })
      messages.push({
        role: 'tool',
        content: results.map(({ call, result }) => ({ type: 'tool-result' as const, toolCallId: call.id, toolName: call.name, output: { type: 'text' as const, value: result } })),
      })
    }
    emit({ type: 'notice', text: '这次对话来回的次数到上限了，先停在这里' })
    emit({ type: 'done', aborted: false })
  } catch (error) {
    if (signal.aborted) return void emit({ type: 'done', aborted: true })
    emit({ type: 'error', message: describeAiError(error) })
    emit({ type: 'done', aborted: false })
  }
}
