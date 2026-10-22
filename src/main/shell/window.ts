import { BrowserWindow, shell, type NativeImage } from 'electron'
import { join } from 'node:path'

export interface WindowOptions {
  icon: NativeImage
  /** 应用正在退出：关窗口时才真的关闭，否则只是收进托盘 */
  isQuitting: () => boolean
  /** 开机自启时不弹出窗口，只留在托盘 */
  startHidden?: boolean
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    show: false,
    title: 'Butler',
    icon: options.icon,
    autoHideMenuBar: true,
    webPreferences: {
      // 沙箱预加载必须是 CommonJS，见 electron.vite.config.ts
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => {
    if (!options.startHidden) win.show()
  })

  // 点关闭只是收进托盘，打卡和提醒还要继续
  win.on('close', (event) => {
    if (options.isQuitting()) return
    event.preventDefault()
    win.hide()
  })

  // 页面里的外部链接交给系统浏览器；窗口自己不跳转到别的页面
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

/** 把窗口调到前台（可能是收在托盘里、也可能被最小化了） */
export function showWindow(win: BrowserWindow | null): void {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}
