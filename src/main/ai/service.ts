import { randomUUID } from 'node:crypto'
import type { ActionCard, AiScene, AiStatus, ChatMessage, ConnectionResult, ModelConfig, UsageSummary } from '../../shared/ai'
import { PATHS } from '../../shared/paths'
import { splitPersona, type PersonaSections } from '../../shared/persona'
import type { ActionMode, ContextStrategy } from '../../shared/schema'
import { logicalToday } from '../domain/day'
import { DomainError } from '../domain/errors'
import { loadSettings } from '../domain/load'
import type { AppContext, Platform } from '../app/context'
import type { SecretStore } from '../app/secrets'
import { changeSettings, savePersonaText } from '../app/services-records'
import type { Session } from '../app/session'
import { ActionEngine } from './engine'
import { createModel, normalizeBaseURL, testConnection } from './provider'
import { runChat } from './runner'
import { summarizeUsage } from './usage'

/** API key 在密钥存储里的名字 */
export const KEY_NAME = 'model-key'

export interface SaveConfigInput {
  provider: ModelConfig
  contextStrategy: ContextStrategy
  actionMode: ActionMode
  /** 给了就保存（先加密）；不给就保持原来的 */
  apiKey?: string
  clearKey?: boolean
}

export interface AiService {
  status(): Promise<AiStatus>
  saveConfig(input: SaveConfigInput): Promise<void>
  test(input: { provider: ModelConfig; apiKey?: string }): Promise<ConnectionResult>
  /** 开始一次对话，马上返回 runId；进展通过 platform.notifyAi 推给界面 */
  send(input: { messages: ChatMessage[]; scene: AiScene }): Promise<{ runId: string }>
  cancel(runId: string): void
  /** 用户对一张待确认的卡片点了确认或取消 */
  confirm(cardId: string, accept: boolean): Promise<ActionCard>
  /** 新对话：清掉还没确认的卡片 */
  reset(): void
  usage(): Promise<UsageSummary>
  persona(): Promise<{ markdown: string; sections: PersonaSections | null }>
  savePersona(markdown: string): Promise<void>
}

export interface AiServiceDeps {
  session: Session
  secrets: SecretStore
  platform: Platform
  encryptionAvailable: () => boolean
  newId?: () => string
}

export function createAiService(deps: AiServiceDeps): AiService {
  const { session, secrets, platform } = deps
  const newId = deps.newId ?? (() => randomUUID())
  const runs = new Map<string, AbortController>()
  let engineFor: { ctx: AppContext; engine: ActionEngine } | null = null

  /** 每个工作区一个引擎；换了工作区，旧的待确认卡片作废 */
  const engineOf = (ctx: AppContext): ActionEngine => {
    if (engineFor?.ctx !== ctx) {
      engineFor?.engine.clearPending()
      engineFor = { ctx, engine: new ActionEngine(ctx, newId) }
    }
    return engineFor.engine
  }

  return {
    async status() {
      const settings = await loadSettings(session.ctx().ws)
      const hasKey = await secrets.has(KEY_NAME)
      return {
        provider: settings.provider,
        contextStrategy: settings.contextStrategy,
        actionMode: settings.actionMode,
        hasKey,
        encryptionAvailable: deps.encryptionAvailable(),
        configured: Boolean(normalizeBaseURL(settings.provider.baseURL) && settings.provider.model.trim() && hasKey),
      }
    },

    async saveConfig(input) {
      const ctx = session.ctx()
      // 先存 key：加密不可用会在这里报错，这样不会出现“设置存了、key 没存”的半成品
      const apiKey = input.apiKey?.trim()
      if (apiKey) await secrets.set(KEY_NAME, apiKey)
      else if (input.clearKey) await secrets.delete(KEY_NAME)
      await changeSettings(ctx, {
        provider: { kind: input.provider.kind, baseURL: normalizeBaseURL(input.provider.baseURL), model: input.provider.model.trim() },
        contextStrategy: input.contextStrategy,
        actionMode: input.actionMode,
      })
    },

    async test({ provider, apiKey }) {
      const key = apiKey?.trim() || (await secrets.get(KEY_NAME)) || ''
      return testConnection({ ...provider, apiKey: key })
    },

    async send({ messages, scene }) {
      if (messages.at(-1)?.role !== 'user') throw new DomainError('invalid', '最后一条消息应该是用户说的话')
      const ctx = session.ctx()
      const settings = await loadSettings(ctx.ws)
      const model = createModel({ ...settings.provider, apiKey: (await secrets.get(KEY_NAME)) ?? '' }) // 没配置好会在这里报错
      const persona = (await ctx.ws.readText(PATHS.persona)) ?? ''
      const runId = newId()
      const controller = new AbortController()
      runs.set(runId, controller)
      void runChat({
        ctx,
        engine: engineOf(ctx),
        model,
        provider: { kind: settings.provider.kind, model: settings.provider.model },
        actionMode: settings.actionMode,
        contextStrategy: settings.contextStrategy,
        persona,
        scene,
        messages,
        signal: controller.signal,
        runId,
        emit: (event) => platform.notifyAi(event),
      }).finally(() => {
        runs.delete(runId)
        platform.notifyDataChanged('local') // 用量记了一笔，设置页的本周用量要刷新
      })
      return { runId }
    },

    cancel(runId) {
      runs.get(runId)?.abort()
    },

    confirm: (cardId, accept) => engineOf(session.ctx()).confirm(cardId, accept),

    reset() {
      if (engineFor) engineFor.engine.clearPending()
    },

    async usage() {
      const ctx = session.ctx()
      const { dayStartsAt } = await loadSettings(ctx.ws)
      return summarizeUsage(ctx, logicalToday(dayStartsAt, ctx.now()))
    },

    async persona() {
      const markdown = (await session.ctx().ws.readText(PATHS.persona)) ?? ''
      return { markdown, sections: splitPersona(markdown) }
    },

    savePersona: (markdown) => savePersonaText(session.ctx(), markdown),
  }
}
