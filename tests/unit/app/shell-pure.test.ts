import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { makeIconPng } from '../../../src/main/app/icon'
import { createSecretStore, type SecretCrypto } from '../../../src/main/app/secrets'
import { toMenuTemplate, type TrayItem } from '../../../src/main/app/trayModel'
import { makeTempDir } from '../store/helpers'

// 假的加密：只做 base64 反转，足以验证“存进去的不是明文、取出来能还原”
const fakeCrypto = (available = true): SecretCrypto => ({
  isAvailable: () => available,
  encrypt: (plain) => Buffer.from(`enc:${plain}`, 'utf8').reverse(),
  decrypt: (data) => {
    const text = Buffer.from(data).reverse().toString('utf8')
    if (!text.startsWith('enc:')) throw new Error('解不开')
    return text.slice(4)
  },
})

describe('createSecretStore', () => {
  it('存进去、取出来；磁盘上看不到明文', async () => {
    const tmp = await makeTempDir()
    const store = createSecretStore(tmp.dir, fakeCrypto())
    expect(await store.has('model-key')).toBe(false)
    await store.set('model-key', 'sk-test-12345')
    expect(await store.get('model-key')).toBe('sk-test-12345')
    expect(await store.has('model-key')).toBe(true)
    const file = join(tmp.dir, 'secrets', 'model-key.secret')
    expect(await readFile(file, 'utf8')).not.toContain('sk-test')
    await store.delete('model-key')
    expect(await store.get('model-key')).toBeNull()
    await tmp.cleanup()
  })

  it('加密不可用时拒绝保存，不会写出明文文件', async () => {
    const tmp = await makeTempDir()
    const store = createSecretStore(tmp.dir, fakeCrypto(false))
    await expect(store.set('model-key', 'sk-test')).rejects.toThrow(/无法加密/)
    await expect(readdir(join(tmp.dir, 'secrets'))).rejects.toThrow()
    await tmp.cleanup()
  })

  it('解不开的文件当作没有；不合法的名字被拒绝', async () => {
    const tmp = await makeTempDir()
    const writer = createSecretStore(tmp.dir, fakeCrypto())
    await writer.set('a', 'v')
    const other = createSecretStore(tmp.dir, { ...fakeCrypto(), decrypt: () => { throw new Error('换了账户') } })
    expect(await other.get('a')).toBeNull()
    await expect(writer.set('../evil', 'x')).rejects.toThrow(/不合法/)
    await tmp.cleanup()
  })
})

describe('makeIconPng', () => {
  it('是合法的 PNG：签名、尺寸、RGBA，像素数据长度对得上，四个角透明、中心是白色', () => {
    const size = 32
    const png = makeIconPng(size)
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    expect(png.readUInt32BE(16)).toBe(size) // IHDR 宽
    expect(png.readUInt32BE(20)).toBe(size) // IHDR 高
    expect(png[24]).toBe(8) // 位深
    expect(png[25]).toBe(6) // RGBA
    const idatAt = png.indexOf('IDAT')
    const length = png.readUInt32BE(idatAt - 4)
    const raw = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + length))
    expect(raw.length).toBe((size * 4 + 1) * size)
    const px = (x: number, y: number): number[] => [...raw.subarray(y * (size * 4 + 1) + 1 + x * 4, y * (size * 4 + 1) + 1 + x * 4 + 4)]
    expect(px(0, 0)[3]).toBe(0)
    expect(px(size - 1, size - 1)[3]).toBe(0)
    expect(px(size / 2, size / 2)).toEqual([255, 255, 255, 255])
    expect(px(size / 2, 3)[3]).toBe(255)
  })
})

describe('toMenuTemplate', () => {
  const items: TrayItem[] = [
    { id: 'a', label: '甲' },
    { separator: true },
    { label: '子菜单', submenu: [{ id: 'b', label: '乙' }, { label: '灰色', enabled: false }] },
  ]

  it('转成 Electron 菜单模板，点击回调带着 id', () => {
    const onAction = vi.fn()
    const template = toMenuTemplate(items, onAction)
    expect(template.map((t) => t.type ?? t.label)).toEqual(['甲', 'separator', '子菜单'])
    template[0]?.click?.()
    template[2]?.submenu?.[0]?.click?.()
    expect(onAction.mock.calls).toEqual([['a'], ['b']])
    expect(template[2]?.submenu?.[1]).toMatchObject({ label: '灰色', enabled: false })
    expect(template[2]?.submenu?.[1]?.click).toBeUndefined()
  })
})
