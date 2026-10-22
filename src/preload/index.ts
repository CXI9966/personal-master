import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { CHANNELS, EVENT_NAMES, type ButlerApi, type EventMap, type IpcResult } from '../shared/ipc'

// 界面只能通过这两个入口和主进程说话：invoke 调用通道，on 订阅事件。
// 通道和事件都有白名单，界面拿不到 ipcRenderer 本身。
const channels = new Set<string>(CHANNELS)
const events = new Set<string>(EVENT_NAMES)

const api: ButlerApi = {
  async invoke(channel, ...args) {
    if (!channels.has(channel)) throw new Error(`未知通道：${channel}`)
    const result = (await ipcRenderer.invoke(channel, args[0])) as IpcResult<never>
    if (!result.ok) throw new Error(result.error)
    return result.data
  },
  on(event, listener) {
    if (!events.has(event)) throw new Error(`未知事件：${event}`)
    const handler = (_event: IpcRendererEvent, payload: EventMap[typeof event]): void => listener(payload)
    ipcRenderer.on(event, handler)
    return () => {
      ipcRenderer.removeListener(event, handler)
    }
  },
}

contextBridge.exposeInMainWorld('butler', api)
