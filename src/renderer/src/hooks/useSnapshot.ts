import { useCallback, useEffect, useRef, useState } from 'react'
import type { Channel, Request, Response } from '../../../shared/ipc'

type Args<C extends Channel> = Request<C> extends void ? [] : [Request<C>]

export interface Snapshot<T> {
  data: T | null
  error: string | null
  reload: () => void
}

const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** 读一份快照；主进程推 data:changed（自己改的、外部改的）时自动重新读 */
export function useSnapshot<C extends Channel>(channel: C, ...args: Args<C>): Snapshot<Response<C>> {
  const [data, setData] = useState<Response<C> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const key = JSON.stringify(args)

  const load = useCallback(() => {
    const id = ++latest.current
    const invoke = window.butler.invoke as (channel: Channel, ...args: unknown[]) => Promise<unknown>
    invoke(channel, ...(JSON.parse(key) as unknown[])).then(
      (value) => {
        if (id !== latest.current) return // 已经有更新的请求，丢掉旧的
        setData(value as Response<C>)
        setError(null)
      },
      (e: unknown) => {
        if (id === latest.current) setError(messageOf(e))
      },
    )
  }, [channel, key])

  useEffect(() => {
    load()
    return window.butler.on('data:changed', load)
  }, [load])

  return { data, error, reload: load }
}
