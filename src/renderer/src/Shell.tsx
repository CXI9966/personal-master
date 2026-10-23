import { useMemo, useState } from 'react'
import { HealthBanner, UndoBar } from './components/Notices'
import NavIcon from './components/viz/NavIcon'
import { useChat } from './hooks/useChat'
import Chat from './pages/Chat'
import Records from './pages/Records'
import Settings from './pages/Settings'
import Tasks from './pages/Tasks'
import Today from './pages/Today'
import { ShellContext, type Page, type ShellApi } from './shellContext'

const PAGES: Array<[Page, string]> = [
  ['today', '今日'],
  ['chat', '管家'],
  ['tasks', '任务'],
  ['records', '记录'],
  ['settings', '设置'],
]

/** 打开工作区之后的主界面：左边导航，右边当前页，底部是撤销条。对话的状态放在这一层，切页面不会丢 */
export default function Shell() {
  const [page, setPage] = useState<Page>('today')
  const chat = useChat()
  const api = useMemo<ShellApi>(
    () => ({
      goto: setPage,
      ask: (scene, text) => {
        setPage('chat')
        void chat.send(text, scene)
      },
    }),
    [chat.send],
  )

  return (
    <ShellContext.Provider value={api}>
      <div className="app">
        <nav className="nav" aria-label="主导航">
          <p className="brand">Butler</p>
          {PAGES.map(([id, label]) => (
            <button key={id} type="button" aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}>
              <NavIcon name={id} />
              {label}
            </button>
          ))}
        </nav>
        <div className="content">
          <HealthBanner />
          <main>
            <div className="page" key={page}>
              {page === 'today' && <Today />}
              {page === 'chat' && <Chat chat={chat} />}
              {page === 'tasks' && <Tasks />}
              {page === 'records' && <Records />}
              {page === 'settings' && <Settings />}
            </div>
          </main>
          <UndoBar />
        </div>
      </div>
    </ShellContext.Provider>
  )
}
