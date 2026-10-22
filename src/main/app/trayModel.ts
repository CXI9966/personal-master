import { clockOf } from '../../shared/calendar'
import type { TodaySnapshot } from '../../shared/views'
import type { AppContext } from './context'
import { addCheckin, completeTaskById } from './services'

export interface TrayItem {
  /** 点击后交给 performTrayAction 的标识；分隔线没有 */
  id?: string
  label?: string
  enabled?: boolean
  separator?: boolean
  submenu?: TrayItem[]
}

/** 托盘菜单：纯数据，shell 层把它转成 Electron 的菜单 */
export function buildTrayModel(snapshot: TodaySnapshot | null): TrayItem[] {
  const footer: TrayItem[] = [{ separator: true }, { id: 'open', label: '打开 Butler' }, { id: 'quit', label: '退出' }]
  if (!snapshot) return [{ id: 'open', label: '打开 Butler（先选择工作区）' }, { separator: true }, { id: 'quit', label: '退出' }]

  const open = snapshot.planTasks.filter((task) => task.status === 'open')
  const tasks: TrayItem[] =
    open.length === 0
      ? [{ label: '今天没有待办任务', enabled: false }]
      : open.map((task) => ({ id: `task:${task.id}`, label: `完成：${task.title}` }))

  return [
    { id: 'checkin:wake', label: snapshot.wake ? `起床打卡（已打卡 ${clockOf(snapshot.wake.at)}）` : '起床打卡' },
    { id: 'checkin:sleep', label: snapshot.sleep ? `睡前打卡（已打卡 ${clockOf(snapshot.sleep.at)}）` : '睡前打卡' },
    { label: '今天的任务', submenu: tasks },
    ...footer,
  ]
}

/** 和 Electron 的 MenuItemConstructorOptions 兼容的菜单模板，这里不 import electron */
export interface MenuTemplateItem {
  label?: string
  type?: 'separator'
  enabled?: boolean
  submenu?: MenuTemplateItem[]
  click?: () => void
}

export function toMenuTemplate(items: TrayItem[], onAction: (id: string) => void): MenuTemplateItem[] {
  return items.map((item): MenuTemplateItem => {
    if (item.separator) return { type: 'separator' }
    const { id } = item
    return {
      label: item.label,
      enabled: item.enabled ?? true,
      ...(item.submenu ? { submenu: toMenuTemplate(item.submenu, onAction) } : {}),
      ...(id ? { click: () => onAction(id) } : {}),
    }
  })
}

export type TrayOutcome = 'done' | 'open' | 'quit'

/** 执行托盘菜单项。打卡和勾任务走和界面一样的服务 */
export async function performTrayAction(ctx: AppContext | null, id: string): Promise<TrayOutcome> {
  if (id === 'open') return 'open'
  if (id === 'quit') return 'quit'
  if (!ctx) return 'open' // 还没有工作区，引导去主窗口
  if (id === 'checkin:wake') await addCheckin(ctx, 'wake')
  else if (id === 'checkin:sleep') await addCheckin(ctx, 'sleep')
  else if (id.startsWith('task:')) await completeTaskById(ctx, id.slice('task:'.length))
  else throw new Error(`未知的托盘操作：${id}`)
  return 'done'
}
