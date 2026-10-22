import { contextBridge } from 'electron'

// 脚手架阶段只暴露一个占位对象，任务 5 换成完整的类型化接口
contextBridge.exposeInMainWorld('butler', {
  sandboxed: process.sandboxed === true,
})
