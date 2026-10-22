import { z } from 'zod'
import { CHANNELS, type IpcResult } from '../../shared/ipc'
import { DomainError } from '../domain/errors'
import { WorkspaceError } from '../store/errors'
import type { Handlers } from './index'

/** ipcMain 里用到的那一部分，方便测试时换成假的 */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, request: unknown) => unknown): void
}

/** 把任何错误变成可以直接给用户看的文字 */
export function toIpcError(error: unknown): { error: string; code: string } {
  if (error instanceof DomainError || error instanceof WorkspaceError) return { error: error.message, code: error.code }
  if (error instanceof z.ZodError) return { error: '请求参数不对', code: 'bad-request' }
  return { error: `出错了：${error instanceof Error ? error.message : String(error)}`, code: 'unknown' }
}

/**
 * 给每个通道注册处理函数，统一包成 { ok, data } / { ok: false, error } 的应答。
 * trusted 用来拒绝不是来自我们自己窗口的请求。
 */
export function registerIpc(ipcMain: IpcMainLike, handlers: Handlers, trusted: (event: unknown) => boolean = () => true): void {
  for (const channel of CHANNELS) {
    const handler = handlers[channel] as (request: unknown) => Promise<unknown>
    ipcMain.handle(channel, async (event, request): Promise<IpcResult<unknown>> => {
      if (!trusted(event)) return { ok: false, error: '请求来源不可信', code: 'untrusted' }
      try {
        return { ok: true, data: await handler(request) }
      } catch (error) {
        return { ok: false, ...toIpcError(error) }
      }
    })
  }
}
