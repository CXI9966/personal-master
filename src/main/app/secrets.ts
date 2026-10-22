import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { DomainError } from '../domain/errors'
import { writeFileAtomic } from '../store/atomic'

/** 加密能力：生产环境是 Electron 的 safeStorage（Windows 上用 DPAPI），测试里换成假的 */
export interface SecretCrypto {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export interface SecretStore {
  has(name: string): Promise<boolean>
  /** 没有、或者解不开（比如换了 Windows 账户）都返回 null */
  get(name: string): Promise<string | null>
  /** 加密不可用时拒绝保存，绝不退化成明文 */
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}

const NAME = /^[a-z0-9._-]+$/i

/** API key 这类密钥：加密后存在应用数据目录里，不进工作区（工作区会被 git 管、会被别人看到） */
export function createSecretStore(dir: string, crypto: SecretCrypto): SecretStore {
  const fileOf = (name: string): string => {
    if (!NAME.test(name)) throw new DomainError('invalid', `密钥名不合法：${name}`)
    return join(dir, 'secrets', `${name}.secret`)
  }
  return {
    async has(name) {
      return (await this.get(name)) !== null
    },
    async get(name) {
      let text: string
      try {
        text = await readFile(fileOf(name), 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
      try {
        return crypto.decrypt(Buffer.from(text.trim(), 'base64'))
      } catch {
        return null
      }
    },
    async set(name, value) {
      const file = fileOf(name)
      if (!crypto.isAvailable()) {
        throw new DomainError('invalid', '这台电脑上无法加密保存密钥，所以没有保存')
      }
      await mkdir(join(dir, 'secrets'), { recursive: true })
      await writeFileAtomic(file, crypto.encrypt(value).toString('base64'))
    },
    async delete(name) {
      await rm(fileOf(name), { force: true })
    },
  }
}
