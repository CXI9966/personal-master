import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

// 测试和开发时可以用独立的 userData 目录，必须在 ready 之前设置
const userDataDir = process.env.BUTLER_USER_DATA_DIR
if (userDataDir) app.setPath('userData', userDataDir)

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    title: 'Butler',
    webPreferences: {
      // 沙箱预加载必须是 CommonJS，见 electron.vite.config.ts
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return win
}

void app.whenReady().then(() => {
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
