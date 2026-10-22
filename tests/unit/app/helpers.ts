import { createAiService, type AiService } from '../../../src/main/ai/service'
import type { AppConfig, Platform } from '../../../src/main/app/context'
import type { SecretStore } from '../../../src/main/app/secrets'
import { DomainError } from '../../../src/main/domain/errors'
import type { AiEvent } from '../../../src/shared/ai'
import type { AutostartInfo } from '../../../src/shared/views'
import { createSession, type Session } from '../../../src/main/app/session'
import type { PersonaId } from '../../../src/shared/persona'
import { makeTempDir } from '../store/helpers'

/** 2026-10-23 12:00（上海），固定“现在” */
export const NOW = new Date('2026-10-23T12:00:00+08:00')

export interface FakePlatform extends Platform {
  config: AppConfig
  aiEvents: AiEvent[]
  notifications: Array<'local' | 'external'>
  picked: string | null
  reminders: Array<{ title: string; body: string }>
  autostart: AutostartInfo
}

export function fakePlatform(defaultRoot = 'C:\\默认\\Butler'): FakePlatform {
  const platform: FakePlatform = {
    config: { workspaceRoot: null },
    aiEvents: [],
    notifications: [],
    picked: null,
    reminders: [],
    autostart: { supported: true, enabled: false },
    pickFolder: async () => platform.picked,
    defaultRoot: () => defaultRoot,
    readConfig: async () => ({ ...platform.config }),
    writeConfig: async (config) => {
      platform.config = { ...config }
    },
    notifyDataChanged: (reason) => {
      platform.notifications.push(reason)
    },
    notifyAi: (event) => {
      platform.aiEvents.push(event)
    },
    showReminder: (message) => {
      platform.reminders.push(message)
    },
    getAutostart: () => ({ ...platform.autostart }),
    setAutostart: (enabled) => {
      platform.autostart = { ...platform.autostart, enabled }
    },
  }
  return platform
}

/** 放在内存里的密钥存储，测试用 */
export function memorySecrets(options: { available?: boolean } = {}): SecretStore & { values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    has: async (name) => values.has(name),
    get: async (name) => values.get(name) ?? null,
    set: async (name, value) => {
      if (options.available === false) throw new DomainError('invalid', '这台电脑上无法加密保存密钥，所以没有保存')
      values.set(name, value)
    },
    delete: async (name) => void values.delete(name),
  }
}

/** 给 IPC 测试用：一个接好假密钥存储的管家服务 */
export function fakeAi(session: Session, platform: Platform, secrets = memorySecrets()): AiService {
  return createAiService({ session, secrets, platform, encryptionAvailable: () => true, newId: newTestId })
}

let counter = 0
// 计数放在前 8 位，这样 8 位短编号也各不相同（真实的 UUID 前 8 位是随机的）
export const newTestId = (): string => `${String(++counter).padStart(8, '0')}-0000-4000-8000-000000000000`

/** 临时目录里初始化好一个工作区，返回会话和清理函数 */
export async function openTestSession(persona: PersonaId = 'coach'): Promise<{
  session: Session
  platform: FakePlatform
  root: string
  cleanup: () => Promise<void>
}> {
  const tmp = await makeTempDir()
  const platform = fakePlatform()
  const session = createSession({ platform, now: () => NOW, newId: newTestId, renderDelayMs: 20, watch: false })
  await session.initialize(tmp.dir, persona)
  platform.notifications.length = 0
  return {
    session,
    platform,
    root: tmp.dir,
    cleanup: async () => {
      await session.close()
      await tmp.cleanup()
    },
  }
}

/** 测试里统一把时区固定成上海，避免和运行机器的时区纠缠 */
export function useShanghaiTimezone(): { enter: () => void; leave: () => void } {
  let original: string | undefined
  return {
    enter: () => {
      original = process.env.TZ
      process.env.TZ = 'Asia/Shanghai'
    },
    leave: () => {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    },
  }
}
