import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_PET_SETTINGS, parsePetSettings } from '../../shared/pet'
import { writeFileAtomic } from '../store/atomic'
import type { AppConfig } from './context'

export interface ConfigStore {
  read(): Promise<AppConfig>
  /** 只改给出的字段，其余保持原样 */
  write(patch: Partial<AppConfig>): Promise<void>
}

const EMPTY: AppConfig = { workspaceRoot: null, pet: DEFAULT_PET_SETTINGS }

/** 应用自己的配置（上次的工作区、桌宠接入的设置），放在应用数据目录里，不进工作区 */
export function createFileConfigStore(dir: string): ConfigStore {
  const file = join(dir, 'config.json')

  async function read(): Promise<AppConfig> {
    try {
      const data = JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')) as Record<string, unknown>
      return {
        workspaceRoot: typeof data.workspaceRoot === 'string' && data.workspaceRoot ? data.workspaceRoot : null,
        pet: parsePetSettings(data.pet),
      }
    } catch {
      return { ...EMPTY } // 没有或者损坏，都当作没配置过
    }
  }

  return {
    read,
    async write(patch) {
      const next: AppConfig = { ...(await read()), ...patch }
      await mkdir(dir, { recursive: true })
      await writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`)
    },
  }
}
