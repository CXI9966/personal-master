import { useCallback, useState } from 'react'

export interface Action {
  /** 执行一次操作；成功返回 true，失败把原因记进 error 并返回 false */
  run: (task: () => Promise<unknown>) => Promise<boolean>
  busy: boolean
  error: string | null
  clearError: () => void
}

/** 包一层：操作进行中置忙，出错时留下可以直接给用户看的原因 */
export function useAction(): Action {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = useCallback(async (task: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true)
    setError(null)
    try {
      await task()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setBusy(false)
    }
  }, [])
  return { run, busy, error, clearError: () => setError(null) }
}
