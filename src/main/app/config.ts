import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '../store/atomic'
import type { AppConfig } from './context'

export interface ConfigStore {
  read(): Promise<AppConfig>
  write(config: AppConfig): Promise<void>
}

const EMPTY: AppConfig = { workspaceRoot: null }

/** 应用自己的配置（目前只记着上次的工作区），放在应用数据目录里，不进工作区 */
export function createFileConfigStore(dir: string): ConfigStore {
  const file = join(dir, 'config.json')
  return {
    async read() {
      try {
        const data = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')) as Partial<AppConfig>
        return { workspaceRoot: typeof data.workspaceRoot === 'string' && data.workspaceRoot ? data.workspaceRoot : null }
      } catch {
        return { ...EMPTY } // 没有或者损坏，都当作没配置过
      }
    },
    async write(config) {
      await mkdir(dir, { recursive: true })
      await writeFileAtomic(file, `${JSON.stringify(config, null, 2)}\n`)
    },
  }
}
