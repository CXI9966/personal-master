import { open, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { writeFileAtomic } from '../../../src/main/store/atomic'
import { makeTempDir } from './helpers'

let ctx: Awaited<ReturnType<typeof makeTempDir>>
beforeEach(async () => {
  ctx = await makeTempDir()
})
afterEach(async () => {
  await ctx.cleanup()
})

async function tmpFiles(): Promise<string[]> {
  return (await readdir(ctx.dir)).filter((name) => name.endsWith('.tmp'))
}

// 目标文件被打开时，Windows 上 rename 覆盖会报 EPERM
const onWindows = process.platform === 'win32'

describe('writeFileAtomic', () => {
  it('写出内容，且不留临时文件', async () => {
    const target = join(ctx.dir, '数据.json')
    await writeFileAtomic(target, '{"a":1}\n')
    expect(await readFile(target, 'utf8')).toBe('{"a":1}\n')
    expect(await tmpFiles()).toEqual([])
  })

  it('覆盖已有文件', async () => {
    const target = join(ctx.dir, 'a.json')
    await writeFile(target, 'old')
    await writeFileAtomic(target, 'new')
    expect(await readFile(target, 'utf8')).toBe('new')
  })

  it.skipIf(!onWindows)('目标被占用时退避重试，释放后写入成功', async () => {
    const target = join(ctx.dir, 'a.json')
    await writeFile(target, 'old')
    const holder = await open(target, 'r')
    setTimeout(() => void holder.close(), 150)
    const result = await writeFileAtomic(target, 'new', { maxWaitMs: 3000 })
    expect(result.retries).toBeGreaterThan(0)
    expect(await readFile(target, 'utf8')).toBe('new')
  })

  it.skipIf(!onWindows)('一直被占用就在超时后抛错，旧内容保持不变，也不留临时文件', async () => {
    const target = join(ctx.dir, 'a.json')
    await writeFile(target, 'old')
    const holder = await open(target, 'r')
    try {
      await expect(writeFileAtomic(target, 'new', { maxWaitMs: 200 })).rejects.toMatchObject({ code: 'EPERM' })
    } finally {
      await holder.close()
    }
    expect(await readFile(target, 'utf8')).toBe('old')
    expect(await tmpFiles()).toEqual([])
  })
})
