import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 复制当前环境变量并去掉 ELECTRON_RUN_AS_NODE：
// 从 VS Code 等 Electron 程序里启动的终端会继承它，electron.exe 会被当成纯 Node 运行
function electronEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value
  }
  return { ...env, ...extra }
}

export interface LaunchedButler {
  app: ElectronApplication
  window: Page
  userData: string
  cleanup: () => Promise<void>
}

// 启动构建产物，用独立的 userData 目录，测试不会碰真实数据
export async function launchButler(extraEnv: Record<string, string> = {}): Promise<LaunchedButler> {
  const userData = mkdtempSync(join(tmpdir(), 'butler-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    env: electronEnv({ BUTLER_USER_DATA_DIR: userData, ...extraEnv }),
  })
  const window = await app.firstWindow()
  return {
    app,
    window,
    userData,
    cleanup: async () => {
      await app.close()
      rmSync(userData, { recursive: true, force: true })
    },
  }
}
