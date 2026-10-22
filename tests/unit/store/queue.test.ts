import { describe, expect, it } from 'vitest'
import { WriteQueue } from '../../../src/main/store/queue'
import { sleep } from './helpers'

describe('WriteQueue', () => {
  it('按提交顺序串行执行，先提交的先完成', async () => {
    const queue = new WriteQueue()
    const order: number[] = []
    await Promise.all(
      [1, 2, 3].map((n) =>
        queue.run(async () => {
          await sleep(10 * (4 - n)) // 先提交的反而耗时更长
          order.push(n)
        }),
      ),
    )
    expect(order).toEqual([1, 2, 3])
  })

  it('前一个任务失败，不影响后面的任务', async () => {
    const queue = new WriteQueue()
    const failing = queue.run(async () => {
      throw new Error('boom')
    })
    const ok = queue.run(async () => 'ok')
    await expect(failing).rejects.toThrow('boom')
    await expect(ok).resolves.toBe('ok')
  })
})
