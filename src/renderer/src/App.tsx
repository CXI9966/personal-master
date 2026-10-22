import { useEffect, useState } from 'react'
import type { AppState } from '../../shared/views'
import FirstRun from './pages/FirstRun'
import Shell from './Shell'

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.butler.invoke('app:state').then(setState, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  if (error) {
    return (
      <main className="centered">
        <p role="alert" className="error">
          {error}
        </p>
      </main>
    )
  }
  if (!state) {
    return (
      <main className="centered">
        <p className="hint">加载中…</p>
      </main>
    )
  }
  if (!state.initialized) return <FirstRun initial={state} onDone={setState} />
  return <Shell />
}
