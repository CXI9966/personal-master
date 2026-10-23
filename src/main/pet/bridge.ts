import type { AiEvent } from '../../shared/ai'
import type { PetSettings, PetTestResult } from '../../shared/pet'
import type { TodaySnapshot } from '../../shared/views'
import type { AppContext } from '../app/context'
import type { Session } from '../app/session'
import { buildTrayModel, type TrayOutcome } from '../app/trayModel'
import { createPetClient, type Fail, type PetClient } from './client'
import { createLineLimiter, describeEvent, pickLine, plainLine, shorten, voiceOf } from './lines'
import { tokenFor } from './runtime'
import { diffSummary, summarize, type PetEventKind, type PetSummary } from './summary'

const MENU_OWNER = '管家'
const BUBBLE_MS = 8000 // 一句台词在气泡里停多久
const SPEAK_GAP_MS = 3000 // 两句台词至少隔多久
const MODEL_TIMEOUT_MS = 8000
const MODEL_MAX_PER_HOUR = 6
const HEALTH_MS = 30_000
const POLL_WAIT_MS = 8000
const DEBOUNCE_MS = 700
const SETTLE_MS = 10_000 // success、error 的气泡停多久，之后回到常驻状态

export interface PetBridgeDeps {
  session: Pick<Session, 'isOpen' | 'ctx'>
  buildToday: (ctx: AppContext) => Promise<TodaySnapshot>
  /** 模型配好了（有地址、模型名和 key） */
  modelReady: () => Promise<boolean>
  /** 让模型写一句台词；失败就抛错 */
  writeLine: (facts: string, signal: AbortSignal) => Promise<string>
  /** 管家人格.md 全文，用来判断台词风格 */
  readPersona: () => Promise<string>
  /** 执行右键菜单项，和托盘是同一套 */
  perform: (id: string) => Promise<TrayOutcome>
  openWindow: () => void
  onWarn: (message: string) => void
}

export interface PetBridge {
  /** 按设置开始、停止，或者换一份配置 */
  configure(settings: PetSettings): void
  onDataChanged(): void
  onReminder(kind: 'plan' | 'review'): void
  onAiStart(runId: string): void
  onAiEvent(event: AiEvent): void
  test(input: { baseUrl: string; petId: string }): Promise<PetTestResult>
  /** 刚把桌宠启动起来：马上探一次，不用等每 30 秒一次的探活 */
  reconnect(): void
  /** 退出前清掉自己写的状态、菜单项和锁 */
  dispose(): Promise<void>
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const AUTH_HINT =
  '桌宠拒绝了写入。独立运行的 dsh-pet 每次启动都会换一个访问令牌，Butler 从它写在 DSH_HOME 下的 dsh-pet/standalone-runtime.json 里读取；现在读不到，或者里面的端口和上面的地址对不上。'

/** 把失败原因说成人话（写进日志用） */
const reasonText = (reason: string): string => (reason === 'unauthorized' ? '被桌宠拒绝了（缺少访问令牌）' : reason)

export function createPetBridge(deps: PetBridgeDeps): PetBridge {
  let settings: PetSettings | null = null
  let client: PetClient | null = null
  let generation = 0 // 每次换配置加一，旧的异步流程据此知道自己过期了
  let connected = false
  /** 上次写给桌宠的常驻状态：null = 已清空，undefined = 不确定（要重新写） */
  let applied: string | null | undefined
  let summary: PetSummary | null = null
  let summaryCtx: AppContext | null = null
  let lastSnapshot: TodaySnapshot | null = null
  let reminderDate = ''
  let welcomeDate = ''
  const fired = { plan: false, review: false } // 今天提醒过了
  const runs = new Set<string>() // 正在进行的管家对话
  let errorUntil = 0
  let menuKey = ''
  let menuIds = new Map<string, string>()
  let pollAbort: AbortController | null = null
  let healthTimer: ReturnType<typeof setInterval> | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | undefined
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let pending: { kind: PetEventKind; summary: PetSummary | null } | null = null
  let speaking = false
  let lastSpokeAt = 0
  let heldLock: string | null = null
  let refreshing = false
  let refreshAgain = false
  const warned = new Set<string>()
  const limiter = createLineLimiter({
    minIntervalMs: () => (settings?.linesMinIntervalMin ?? 10) * 60_000,
    maxPerHour: MODEL_MAX_PER_HOUR,
  })

  const warnOnce = (key: string, message: string): void => {
    if (warned.has(key)) return
    warned.add(key)
    deps.onWarn(`桌宠：${message}`)
  }
  const warnError = (error: unknown): void => deps.onWarn(`桌宠：${String(error)}`)

  function markDisconnected(): void {
    if (!connected) return
    connected = false
    applied = undefined
    menuKey = ''
    pollAbort?.abort()
    warnOnce('down', `连不上 ${settings?.baseUrl ?? ''}，每 30 秒再试一次`)
  }

  /** 看一次调用的结果：连不上就记下来，等探活恢复 */
  function note<T extends { ok: boolean }>(reply: T): T {
    if (!reply.ok && (reply as unknown as Fail).reason === 'unreachable') markDisconnected()
    return reply
  }

  /** 桌宠现在该显示的常驻状态，优先级：提醒了没办 > 出错 > 管家在想 */
  function desiredStanding(): { state: 'waiting' | 'error' | 'thinking'; task: string } | null {
    if (fired.plan && summary && !summary.planned) return { state: 'waiting', task: '该排今天的计划了' }
    if (fired.review && summary && !summary.reviewed) return { state: 'waiting', task: '该复盘了' }
    if (Date.now() < errorUntil) return { state: 'error', task: '管家出错了' }
    if (runs.size > 0) return { state: 'thinking', task: '管家在想…' }
    return null
  }

  async function applyStanding(): Promise<void> {
    const c = client
    if (!c || !settings || !connected) return
    if (!settings.status) {
      if (applied !== null) {
        applied = null
        note(await c.clearWorkStatus())
      }
      return
    }
    const desired = desiredStanding()
    const key = desired ? `${desired.state}|${desired.task}` : null
    if (key === applied) return
    const reply = note(desired ? await c.setWorkStatus(desired.state, desired.task) : await c.clearWorkStatus())
    if (reply.ok) applied = key
    else warnOnce(`status-${reply.reason}`, `写状态失败：${reasonText(reply.reason)}`)
  }

  /** 过一会儿再按当前情况重写一次常驻状态（success、error 的气泡过去以后） */
  function settleLater(ms: number): void {
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => void applyStanding().catch(warnError), ms)
  }

  /** 右键菜单的几项，和托盘同一份数据：两种打卡、最多 5 个任务、打开 Butler */
  function menuEntries(snapshot: TodaySnapshot): Array<{ id: string; label: string }> {
    const entries: Array<{ id: string; label: string }> = []
    const seen = new Set<string>()
    let tasks = 0
    const add = (id: string | undefined, label: string | undefined): boolean => {
      if (!id || !label || id === 'quit') return false
      const text = shorten(label, 30) // 接口限制每项不超过 32 个字符
      if (seen.has(text)) return false
      seen.add(text)
      entries.push({ id, label: text })
      return true
    }
    for (const item of buildTrayModel(snapshot)) {
      add(item.id, item.label)
      for (const sub of item.submenu ?? []) {
        if (tasks < 5 && add(sub.id, sub.label)) tasks += 1
      }
    }
    return entries
  }

  async function syncMenu(force: boolean): Promise<void> {
    const c = client
    if (!c || !settings?.menu || !connected || !lastSnapshot) return
    const entries = menuEntries(lastSnapshot)
    const key = entries.map((entry) => entry.label).join('\n')
    if (!force && key === menuKey) return
    const reply = note(await c.registerMenu(MENU_OWNER, entries.map((entry) => entry.label)))
    if (reply.ok) {
      menuKey = key
      menuIds = new Map(entries.map((entry) => [entry.label, entry.id]))
    } else {
      warnOnce(`menu-${reply.reason}`, `注册右键菜单失败：${reasonText(reply.reason)}`)
    }
  }

  async function handleClick(label: string): Promise<void> {
    const id = menuIds.get(label)
    if (!id) return
    try {
      if (id === 'open') deps.openWindow()
      else if ((await deps.perform(id)) === 'open') deps.openWindow()
    } catch (error) {
      deps.onWarn(`桌宠：右键菜单“${label}”执行失败：${String(error)}`)
    }
  }

  /** 长轮询右键菜单被点的情况；连不上或被清掉时退避，由探活恢复 */
  async function pollLoop(gen: number): Promise<void> {
    const abort = new AbortController()
    pollAbort = abort
    while (gen === generation && connected && settings?.menu && client) {
      const started = Date.now()
      const reply = await client.pollMenu(MENU_OWNER, POLL_WAIT_MS, abort.signal)
      if (gen !== generation || abort.signal.aborted) return
      if (!reply.ok) {
        note(reply)
        if (reply.reason === 'unknown-owner') {
          menuKey = ''
          await syncMenu(true)
          if (menuKey !== '') continue
        }
        await sleep(5000)
        continue
      }
      for (const label of reply.clicked) void handleClick(label)
      if (reply.clicked.length === 0 && Date.now() - started < 300) await sleep(500) // 对方没挂起等待时别空转
    }
  }

  /** 取锁说一句：先不带锁说；对方要求锁才取，取不到（别人占着）就放弃这句 */
  async function sendBubble(c: PetClient, text: string): Promise<void> {
    let reply = note(await c.broadcast(text, { durationMs: BUBBLE_MS }))
    if (reply.ok) return
    if (reply.reason !== 'lock-required') {
      warnOnce(`say-${reply.reason}`, `台词没发出去：${reasonText(reply.reason)}`)
      return
    }
    const lock = note(await c.acquireLock(BUBBLE_MS + 7000))
    if (!lock.ok) return
    heldLock = lock.lockId
    try {
      reply = note(await c.broadcast(text, { durationMs: BUBBLE_MS, lockId: lock.lockId }))
      if (reply.ok) await sleep(BUBBLE_MS)
    } finally {
      heldLock = null
      note(await c.releaseLock(lock.lockId))
    }
  }

  async function speak(c: PetClient, s: PetSettings, kind: PetEventKind, snap: PetSummary | null): Promise<void> {
    if (!s.lines) {
      // 不用台词：一次性事件换成一句固定短语的 success；提醒由常驻的 waiting 表达
      if (!s.status || kind === 'remindPlan' || kind === 'remindReview') return
      note(await c.setWorkStatus('success', plainLine(kind)))
      applied = undefined
      settleLater(SETTLE_MS)
      return
    }
    const voice = voiceOf(await deps.readPersona().catch(() => ''))
    let text = pickLine(voice, kind)
    // 限频放行才让模型写；否则直接用本地台词，桌宠马上有反应
    if (s.linesUseModel && (await deps.modelReady().catch(() => false)) && limiter.tryTake(Date.now())) {
      try {
        text = shorten(await deps.writeLine(describeEvent(kind, snap), AbortSignal.timeout(MODEL_TIMEOUT_MS)), 40)
      } catch (error) {
        warnOnce('model-line', `模型这次没写出台词，用了本地台词：${String(error)}`)
      }
    }
    await sendBubble(c, text)
  }

  async function pump(): Promise<void> {
    if (speaking) return
    speaking = true
    try {
      while (pending) {
        const job = pending
        pending = null
        const wait = lastSpokeAt + SPEAK_GAP_MS - Date.now()
        if (wait > 0) await sleep(wait)
        if (!connected || !settings || !client) break
        await speak(client, settings, job.kind, job.summary)
        lastSpokeAt = Date.now()
      }
    } catch (error) {
      warnError(error)
    } finally {
      speaking = false
      if (pending) void pump() // 说话期间又来了新的一句
    }
  }

  /** 排一句台词：同时最多排一句，新的覆盖旧的 */
  function enqueue(kind: PetEventKind): void {
    if (!settings || !connected || (!settings.lines && !settings.status)) return
    pending = { kind, summary }
    void pump()
  }

  /** 读一次今日摘要，和上一次比出刚发生的事，再更新常驻状态和右键菜单 */
  async function refreshOnce(): Promise<void> {
    if (!settings) return
    if (!deps.session.isOpen()) {
      summary = null
      summaryCtx = null
      lastSnapshot = null
      return
    }
    const ctx = deps.session.ctx()
    const snapshot = await deps.buildToday(ctx)
    const next = summarize(snapshot)
    let events: PetEventKind[]
    if (summaryCtx !== ctx || summary === null || summary.date !== next.date) {
      // 基线：刚打开、换了工作区、换了一天。不产生事件，只在隔了几天回来时说一次欢迎
      events = snapshot.welcomeBack && welcomeDate !== next.date ? ['welcomeBack'] : []
      if (snapshot.welcomeBack) welcomeDate = next.date
      if (reminderDate !== '' && next.date !== reminderDate) {
        fired.plan = false
        fired.review = false
      }
      reminderDate = next.date
    } else {
      events = diffSummary(summary, next)
    }
    summary = next
    summaryCtx = ctx
    lastSnapshot = snapshot
    for (const kind of events) enqueue(kind)
    await applyStanding()
    await syncMenu(false)
  }

  async function refresh(): Promise<void> {
    if (refreshing) {
      refreshAgain = true
      return
    }
    refreshing = true
    try {
      do {
        refreshAgain = false
        await refreshOnce()
      } while (refreshAgain)
    } catch (error) {
      warnError(error)
    } finally {
      refreshing = false
    }
  }

  async function onConnected(gen: number): Promise<void> {
    const c = client
    if (!c || !settings) return
    connected = true
    warned.clear()
    applied = undefined
    menuKey = ''
    if (settings.status) {
      note(await c.clearWorkStatus()) // 清掉上次异常退出可能留下的状态
      applied = null
    }
    await refresh() // 记基线、写常驻状态、注册右键菜单
    if (gen === generation && settings?.menu && connected) void pollLoop(gen)
  }

  async function health(gen: number): Promise<void> {
    const c = client
    if (!c || gen !== generation) return
    const up = await c.ping()
    if (gen !== generation) return
    if (up && !connected) await onConnected(gen)
    else if (!up && connected) markDisconnected()
  }

  async function start(gen: number): Promise<void> {
    const c = client
    if (!c) return
    const up = await c.ping()
    if (gen !== generation) return
    if (up) await onConnected(gen)
    else warnOnce('down', `连不上 ${settings?.baseUrl ?? ''}，每 30 秒再试一次`)
    if (gen !== generation) return
    healthTimer = setInterval(() => void health(gen).catch(warnError), HEALTH_MS)
  }

  function stopTimers(): void {
    clearInterval(healthTimer)
    healthTimer = undefined
    clearTimeout(debounceTimer)
    clearTimeout(settleTimer)
    pollAbort?.abort()
    pollAbort = null
  }

  /** 清掉自己写的状态、菜单项和锁。每项失败都不要紧 */
  async function cleanup(c: PetClient, s: PetSettings): Promise<void> {
    const lock = heldLock
    heldLock = null
    await Promise.allSettled([s.status ? c.clearWorkStatus() : undefined, s.menu ? c.clearMenu(MENU_OWNER) : undefined, lock ? c.releaseLock(lock) : undefined])
  }

  function configure(next: PetSettings): void {
    const oldClient = client
    const oldSettings = settings
    stopTimers()
    generation += 1
    connected = false
    applied = undefined
    menuKey = ''
    pending = null
    if (oldClient && oldSettings) void cleanup(oldClient, oldSettings)
    if (!next.enabled) {
      settings = null
      client = null
      return
    }
    settings = next
    client = createPetClient({ baseUrl: next.baseUrl, petId: next.petId, token: () => tokenFor(next.baseUrl) })
    void start(generation).catch(warnError)
  }

  async function test(input: { baseUrl: string; petId: string }): Promise<PetTestResult> {
    const probe = createPetClient({ ...input, timeoutMs: 3000, token: () => tokenFor(input.baseUrl) })
    const reply = await probe.pets()
    if (!reply.ok) {
      if (reply.reason === 'unreachable') return { ok: false, message: '连不上：确认 dsh-pet 已经在运行，地址和端口都对' }
      if (reply.reason === 'http-404') return { ok: false, message: '连上了，但这个地址不像 dsh-pet 的接口（404），检查路径是不是 /dsh-pet-7340' }
      return { ok: false, message: `连上了，但读取失败：${reply.reason}` }
    }
    if (reply.ids.includes(input.petId)) {
      // 读是公开的，写才要令牌：用清掉自己的菜单项（幂等、只动自己的）试一次写
      const write = await probe.clearMenu(MENU_OWNER)
      if (!write.ok && write.reason === 'unauthorized') return { ok: false, message: AUTH_HINT }
      return { ok: true, message: `已连上，找到宠物“${input.petId}”` }
    }
    if (reply.ids.length === 0) return { ok: true, message: '已连上，但没读到宠物列表' }
    return { ok: false, message: `已连上，但没有叫“${input.petId}”的宠物。现有：${reply.ids.join('、')}` }
  }

  async function dispose(): Promise<void> {
    stopTimers()
    generation += 1
    const c = client
    const s = settings
    client = null
    settings = null
    connected = false
    if (c && s) await cleanup(c, s)
  }

  return {
    configure,
    onDataChanged() {
      if (!settings) return
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => void refresh(), DEBOUNCE_MS)
    },
    onReminder(kind) {
      if (!settings) return
      fired[kind] = true
      enqueue(kind === 'plan' ? 'remindPlan' : 'remindReview')
      void applyStanding().catch(warnError)
    },
    onAiStart(runId) {
      if (!settings) return
      runs.add(runId)
      void applyStanding().catch(warnError)
    },
    onAiEvent(event) {
      if (!settings) return
      if (event.type === 'error') {
        errorUntil = Date.now() + SETTLE_MS
        settleLater(SETTLE_MS + 100)
      }
      if (event.type === 'done') runs.delete(event.runId)
      void applyStanding().catch(warnError)
    },
    reconnect() {
      if (settings && client && !connected) void health(generation).catch(warnError)
    },
    test,
    dispose,
  }
}

