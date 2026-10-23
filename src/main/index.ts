import { app, dialog, ipcMain, Menu, nativeImage, powerMonitor, safeStorage, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createAiService } from './ai/service'
import { createFileConfigStore } from './app/config'
import type { Platform } from './app/context'
import { makeIconPng } from './app/icon'
import { createFileLedger } from './app/reminders'
import { createSecretStore } from './app/secrets'
import { createSession } from './app/session'
import { buildToday } from './app/snapshots'
import { createTicker } from './app/ticker'
import { buildTrayModel, performTrayAction } from './app/trayModel'
import { checkPetSettings, DEFAULT_PET_SETTINGS, normalizePetSettings, type PetSettings } from '../shared/pet'
import { DomainError } from './domain/errors'
import { createHandlers } from './ipc'
import { createPetBridge, type PetBridge } from './pet/bridge'
import { createPetClient } from './pet/client'
import type { PetControl } from './pet/control'
import { createPetLauncher } from './pet/launcher'
import { registerIpc } from './ipc/register'
import { showNotification } from './shell/notify'
import { createTray, type TrayController } from './shell/tray'
import { createMainWindow, showWindow } from './shell/window'

// 测试和开发时可以用独立的 userData 目录，必须在 ready 之前设置
const userDataDir = process.env.BUTLER_USER_DATA_DIR
if (userDataDir) app.setPath('userData', userDataDir)

const log = (message: string): void => console.warn(`[butler] ${message}`)

// 开机自启时带上这个参数，启动后只留在托盘，不弹窗口
const HIDDEN_FLAG = '--hidden'
// 每隔多久检查一次“是不是新的一天、该不该提醒”；测试里可以调短
const TICK_MS = Number(process.env.BUTLER_TICK_MS) > 0 ? Number(process.env.BUTLER_TICK_MS) : 60_000

// 只接受来自我们自己页面的请求：打包后是 file://，开发时是 Vite 的开发服务器
const devUrl = process.env.ELECTRON_RENDERER_URL
const devOrigin = devUrl ? new URL(devUrl).origin : null
function isTrustedSender(event: unknown): boolean {
  const url = (event as { senderFrame?: { url?: string } }).senderFrame?.url ?? ''
  return url.startsWith('file://') || (devOrigin !== null && url.startsWith(devOrigin))
}

async function start(): Promise<void> {
  let window: BrowserWindow | null = null
  let tray: TrayController | null = null
  let trayTimer: ReturnType<typeof setTimeout> | undefined
  let tickTimer: ReturnType<typeof setInterval> | undefined
  let quitting = false
  let cleanedUp = false
  let pet: PetBridge | null = null // 平台回调里要用到它，但它依赖后面才创建的管家服务，所以先声明

  const configStore = createFileConfigStore(app.getPath('userData'))
  const platform: Platform = {
    async pickFolder() {
      const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    async pickFile(filters) {
      const options = { properties: ['openFile' as const], filters }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    defaultRoot: () => process.env.BUTLER_DEFAULT_WORKSPACE ?? join(app.getPath('documents'), 'Butler'),
    readConfig: () => configStore.read(),
    writeConfig: (config) => configStore.write(config),
    notifyDataChanged(reason) {
      if (window && !window.isDestroyed()) window.webContents.send('data:changed', { reason })
      refreshTray()
      pet?.onDataChanged()
    },
    notifyAi(event) {
      if (window && !window.isDestroyed()) window.webContents.send('ai:event', event)
      pet?.onAiEvent(event)
    },
    showReminder(message) {
      showNotification(message, () => showWindow(window))
      if (message.kind) pet?.onReminder(message.kind)
    },
    // 开机自启只对安装好的版本有意义；开发时（electron . 启动）不去动系统的启动项
    getAutostart: () =>
      app.isPackaged
        ? { supported: true, enabled: app.getLoginItemSettings({ args: [HIDDEN_FLAG] }).openAtLogin }
        : { supported: false, enabled: false },
    setAutostart(enabled) {
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_FLAG] })
    },
  }
  const session = createSession({ platform, onWarn: log })
  // API key 用系统的加密存储（Windows 上是 DPAPI）保存在应用数据目录里，不进工作区
  const secrets = createSecretStore(app.getPath('userData'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (data) => safeStorage.decryptString(data),
  })
  const ai = createAiService({
    session,
    secrets,
    platform,
    encryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    onRunStart: (runId) => pet?.onAiStart(runId),
  })
  const ticker = createTicker({ session, platform, ledger: createFileLedger(app.getPath('userData')), onWarn: log })
  pet = createPetBridge({
    session,
    buildToday,
    modelReady: async () => (await ai.status()).configured,
    writeLine: (facts, signal) => ai.petLine(facts, signal),
    readPersona: async () => (await ai.persona()).markdown,
    // 右键菜单和托盘是同一套：打卡、勾任务、打开主窗口
    perform: (id) => performTrayAction(session.isOpen() ? session.ctx() : null, id),
    openWindow: () => showWindow(window),
    onWarn: log,
  })
  let petConfig: PetSettings = DEFAULT_PET_SETTINGS // 当前生效的桌宠设置，启动器据此判断桌宠有没有在运行
  const launcher = createPetLauncher({
    isUp: () => createPetClient({ baseUrl: petConfig.baseUrl, petId: petConfig.petId, timeoutMs: 1000 }).ping(),
    onUp: () => pet?.reconnect(),
    onWarn: log,
  })
  const petControl: PetControl = {
    get: async () => (await configStore.read()).pet,
    async save(next) {
      const problem = checkPetSettings(next)
      if (problem) throw new DomainError('invalid', problem)
      const clean = normalizePetSettings(next)
      await configStore.write({ pet: clean })
      petConfig = clean
      pet?.configure(clean)
      if (!clean.enabled) await launcher.stopOwn() // 关掉桌宠接入，Butler 自己启动的那个也一起停
      else if (clean.autoStart) void launcher.ensure(clean.launcher, 0)
      return clean
    },
    test: async (input) => (pet ? pet.test(input) : { ok: false, message: '还没准备好，请稍后再试' }),
    status: () => launcher.status(),
    launch: () => launcher.ensure(petConfig.launcher, 15_000),
  }

  async function updateTray(): Promise<void> {
    if (!tray) return
    try {
      tray.setModel(buildTrayModel(session.isOpen() ? await buildToday(session.ctx()) : null))
    } catch (error) {
      log(`更新托盘菜单失败：${String(error)}`)
    }
  }
  function refreshTray(): void {
    clearTimeout(trayTimer)
    trayTimer = setTimeout(() => void updateTray(), 150)
  }

  app.on('second-instance', () => showWindow(window))
  app.on('before-quit', (event) => {
    quitting = true
    clearInterval(tickTimer)
    if (cleanedUp) return
    // 退出前先把还没渲染的视图渲染掉、关掉工作区，再真正退出
    event.preventDefault()
    cleanedUp = true
    void Promise.allSettled([
      // 先清掉桌宠上的状态、菜单项和锁，再停 Butler 自己启动的那个桌宠
      (async () => {
        await pet?.dispose()
        await launcher.stopOwn()
      })(),
      session.close().catch((error: unknown) => log(`关闭工作区失败：${String(error)}`)),
    ]).finally(() => app.quit())
  })

  await app.whenReady()
  app.setAppUserModelId('com.butler.app') // Windows 通知需要
  Menu.setApplicationMenu(null)
  registerIpc(ipcMain, createHandlers(session, platform, ai, petControl), isTrustedSender)
  await session.restore()
  petConfig = (await configStore.read()).pet
  pet.configure(petConfig)
  if (petConfig.enabled && petConfig.autoStart) void launcher.ensure(petConfig.launcher, 0) // 桌宠没在运行就启动它

  const icon = nativeImage.createFromBuffer(makeIconPng(256))
  window = createMainWindow({ icon, isQuitting: () => quitting, startHidden: process.argv.includes(HIDDEN_FLAG) })
  tray = createTray({
    icon,
    onActivate: () => showWindow(window),
    onAction: (id) => {
      void performTrayAction(session.isOpen() ? session.ctx() : null, id)
        .then((outcome) => {
          if (outcome === 'open') showWindow(window)
          else if (outcome === 'quit') app.quit()
        })
        .catch((error: unknown) => log(`托盘操作失败：${String(error)}`))
    },
  })
  await updateTray()

  // 定时检查：跨到新的一天要重新生成视图，到点了要提醒。电脑从睡眠里醒来也马上查一次
  void ticker.tick()
  tickTimer = setInterval(() => void ticker.tick(), TICK_MS)
  powerMonitor.on('resume', () => void ticker.tick())
}

if (!app.requestSingleInstanceLock()) app.quit()
else void start()
