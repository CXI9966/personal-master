import { app, dialog, ipcMain, Menu, nativeImage, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { createFileConfigStore } from './app/config'
import type { Platform } from './app/context'
import { makeIconPng } from './app/icon'
import { createSession } from './app/session'
import { buildToday } from './app/snapshots'
import { buildTrayModel, performTrayAction } from './app/trayModel'
import { createHandlers } from './ipc'
import { registerIpc } from './ipc/register'
import { createTray, type TrayController } from './shell/tray'
import { createMainWindow, showWindow } from './shell/window'

// 测试和开发时可以用独立的 userData 目录，必须在 ready 之前设置
const userDataDir = process.env.BUTLER_USER_DATA_DIR
if (userDataDir) app.setPath('userData', userDataDir)

const log = (message: string): void => console.warn(`[butler] ${message}`)

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
  let quitting = false
  let cleanedUp = false

  const configStore = createFileConfigStore(app.getPath('userData'))
  const platform: Platform = {
    async pickFolder() {
      const options = { properties: ['openDirectory' as const, 'createDirectory' as const] }
      const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    defaultRoot: () => process.env.BUTLER_DEFAULT_WORKSPACE ?? join(app.getPath('documents'), 'Butler'),
    readConfig: () => configStore.read(),
    writeConfig: (config) => configStore.write(config),
    notifyDataChanged(reason) {
      if (window && !window.isDestroyed()) window.webContents.send('data:changed', { reason })
      refreshTray()
    },
  }
  const session = createSession({ platform, onWarn: log })

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
    if (cleanedUp) return
    // 退出前先把还没渲染的视图渲染掉、关掉工作区，再真正退出
    event.preventDefault()
    cleanedUp = true
    void session
      .close()
      .catch((error: unknown) => log(`关闭工作区失败：${String(error)}`))
      .finally(() => app.quit())
  })

  await app.whenReady()
  app.setAppUserModelId('com.butler.app') // Windows 通知需要
  Menu.setApplicationMenu(null)
  registerIpc(ipcMain, createHandlers(session, platform), isTrustedSender)
  await session.restore()

  const icon = nativeImage.createFromBuffer(makeIconPng(256))
  window = createMainWindow({ icon, isQuitting: () => quitting })
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
}

if (!app.requestSingleInstanceLock()) app.quit()
else void start()
