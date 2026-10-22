import { vi } from 'vitest'
import type { ButlerApi, Channel, EventMap, EventName } from '../../src/shared/ipc'

type Handler = (request: unknown) => unknown

export interface ButlerMock {
  invoke: ReturnType<typeof vi.fn>
  /** 触发主进程推送的事件 */
  emit<E extends EventName>(event: E, payload: EventMap[E]): void
  /** 某个通道被调用的参数列表 */
  callsOf(channel: Channel): unknown[]
}

/**
 * 装一个假的 window.butler：handlers 里给出各通道的返回值（或函数）。
 * 没给出的通道一调用就报错，免得测试悄悄通过。
 */
export function installButler(handlers: Partial<Record<Channel, unknown>> = {}): ButlerMock {
  const listeners = new Map<EventName, Set<(payload: never) => void>>()
  const invoke = vi.fn(async (channel: Channel, request?: unknown) => {
    if (!(channel in handlers)) throw new Error(`测试里没有给通道 ${channel} 准备返回值`)
    const handler = handlers[channel]
    return typeof handler === 'function' ? (handler as Handler)(request) : handler
  })
  const api: ButlerApi = {
    invoke: invoke as unknown as ButlerApi['invoke'],
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener as (payload: never) => void)
      listeners.set(event, set)
      return () => set.delete(listener as (payload: never) => void)
    },
  }
  window.butler = api
  return {
    invoke,
    emit(event, payload) {
      for (const listener of listeners.get(event) ?? []) listener(payload as never)
    },
    callsOf: (channel) => invoke.mock.calls.filter(([c]) => c === channel).map(([, request]) => request),
  }
}
