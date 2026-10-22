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

export interface LaunchOptions {
  /** 额外的环境变量 */
  env?: Record<string, string>
  /** 复用已有的 userData 目录（重启应用时用）；传了就不会在 cleanup 时删掉 */
  userData?: string
}

/** 和应用同一套规则：凌晨 4 点前算前一天（用本机时间） */
export function localLogicalToday(): string {
  const now = new Date()
  if (now.getHours() < 4) now.setDate(now.getDate() - 1)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** 在第一次运行页点完三步（默认战友教练，模型接口跳过） */
export async function completeFirstRun(window: Page): Promise<void> {
  await window.getByRole('button', { name: '下一步' }).click()
  await window.getByRole('button', { name: '下一步' }).click()
  await window.getByRole('button', { name: '跳过，以后再填' }).click()
  await window.getByRole('heading', { name: '今日', exact: true }).waitFor()
}

export interface LaunchedButler {
  app: ElectronApplication
  window: Page
  userData: string
  /** 关闭应用；自己建的 userData 目录一并删掉 */
  cleanup: () => Promise<void>
}

export function makeTempDir(prefix = 'butler-e2e-'): { dir: string; remove: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) }
}

// 启动构建产物，用独立的 userData 目录，测试不会碰真实数据
export async function launchButler(options: LaunchOptions = {}): Promise<LaunchedButler> {
  const owned = options.userData ? null : makeTempDir()
  const userData = options.userData ?? owned!.dir
  const app = await electron.launch({
    args: ['.'],
    env: electronEnv({ BUTLER_USER_DATA_DIR: userData, ...options.env }),
  })
  const window = await app.firstWindow()
  return {
    app,
    window,
    userData,
    cleanup: async () => {
      await app.close()
      owned?.remove()
    },
  }
}
