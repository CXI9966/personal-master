import { Menu, Tray, type NativeImage } from 'electron'
import { toMenuTemplate, type TrayItem } from '../app/trayModel'

export interface TrayController {
  setModel(items: TrayItem[]): void
  destroy(): void
}

export interface TrayOptions {
  icon: NativeImage
  /** 点了菜单项，参数是 TrayItem.id */
  onAction: (id: string) => void
  /** 单击托盘图标 */
  onActivate: () => void
}

export function createTray(options: TrayOptions): TrayController {
  const tray = new Tray(options.icon.resize({ width: 16, height: 16 }))
  tray.setToolTip('Butler')
  tray.on('click', options.onActivate)
  return {
    setModel(items) {
      tray.setContextMenu(Menu.buildFromTemplate(toMenuTemplate(items, options.onAction)))
    },
    destroy() {
      tray.destroy()
    },
  }
}
