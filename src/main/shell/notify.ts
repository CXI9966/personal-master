import { Notification } from 'electron'

// Notification 对象被回收后点击就收不到了，所以显示期间自己抓着
const live = new Set<Notification>()

/** 弹一条系统通知；点击后调用 onClick。系统不支持通知时什么也不做 */
export function showNotification(message: { title: string; body: string }, onClick: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: message.title, body: message.body })
  live.add(notification)
  const release = (): void => void live.delete(notification)
  notification.on('click', () => {
    release()
    onClick()
  })
  notification.on('close', release)
  notification.on('failed', release)
  notification.show()
}
