import type { Page } from '../../shellContext'

const PATHS: Record<Page, string> = {
  today: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z',
  tasks: 'M9 11l3 3 8-8M4 12v7a1 1 0 0 0 1 1h14',
  records: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2',
}

/** 导航栏里每一页的小图标，颜色跟着文字走 */
export default function NavIcon({ name }: { name: Page }) {
  return (
    <svg className="nav-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
