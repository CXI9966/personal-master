import { useState } from 'react'
import { HealthBanner, UndoBar } from './components/Notices'
import Records from './pages/Records'
import Settings from './pages/Settings'
import Tasks from './pages/Tasks'
import Today from './pages/Today'

type Page = 'today' | 'tasks' | 'records' | 'settings'

const PAGES: Array<[Page, string]> = [
  ['today', '今日'],
  ['tasks', '任务'],
  ['records', '记录'],
  ['settings', '设置'],
]

/** 打开工作区之后的主界面：左边导航，右边当前页，底部是撤销条 */
export default function Shell() {
  const [page, setPage] = useState<Page>('today')
  return (
    <div className="app">
      <nav className="nav" aria-label="主导航">
        <p className="brand">Butler</p>
        {PAGES.map(([id, label]) => (
          <button key={id} type="button" aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="content">
        <HealthBanner />
        <main>
          {page === 'today' && <Today />}
          {page === 'tasks' && <Tasks />}
          {page === 'records' && <Records />}
          {page === 'settings' && <Settings />}
        </main>
        <UndoBar />
      </div>
    </div>
  )
}
