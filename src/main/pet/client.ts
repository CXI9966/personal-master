// dsh-pet 的本机 HTTP 接口（见它仓库里的 API.md 和 openapi.yaml）。
// 每个方法都不抛错：失败返回 { ok: false, reason }，连不上的 reason 是 'unreachable'。

export type PetWorkState = 'thinking' | 'working' | 'result' | 'waiting' | 'success' | 'error'

export interface Fail {
  ok: false
  reason: string
  message?: string
}
export type Plain = { ok: true } | Fail

export interface PetClient {
  /** 配置里所有宠物的 id（GET /config） */
  pets(): Promise<({ ok: true; ids: string[] } | Fail)>
  /** 探活（GET /state） */
  ping(): Promise<boolean>
  setWorkStatus(state: PetWorkState, task?: string): Promise<Plain>
  clearWorkStatus(): Promise<Plain>
  /** 让桌宠说一句。别的程序占着锁时会回 lock-required */
  broadcast(text: string, options: { durationMs: number; lockId?: string }): Promise<Plain>
  acquireLock(ttlMs: number): Promise<({ ok: true; lockId: string } | Fail)>
  releaseLock(lockId: string): Promise<Plain>
  registerMenu(owner: string, labels: string[]): Promise<Plain>
  clearMenu(owner: string): Promise<Plain>
  /** 长轮询，返回这段时间里被点的菜单项文案 */
  pollMenu(owner: string, waitMs: number, signal?: AbortSignal): Promise<({ ok: true; clicked: string[] } | Fail)>
}

export interface ClientOptions {
  baseUrl: string
  petId: string
  /** 普通调用的超时，默认 1500 毫秒 */
  timeoutMs?: number
  fetch?: typeof fetch
  /** 访问令牌（独立运行的 dsh-pet 的写请求需要）；每次请求前取一次，因为桌宠重启会换 */
  token?: () => Promise<string | undefined>
}

type Reply = { ok: true; body: Record<string, unknown> } | Fail

const asText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

export function createPetClient(options: ClientOptions): PetClient {
  const base = options.baseUrl.trim().replace(/\/+$/, '')
  const timeoutMs = options.timeoutMs ?? 1500
  const doFetch = options.fetch ?? fetch
  const petId = encodeURIComponent(options.petId)
  const target = `pet=${petId}&surface=any`

  async function call(method: string, path: string, init: { body?: unknown; timeoutMs?: number; signal?: AbortSignal } = {}): Promise<Reply> {
    const timeout = AbortSignal.timeout(init.timeoutMs ?? timeoutMs)
    const signal = init.signal ? AbortSignal.any([timeout, init.signal]) : timeout
    try {
      const headers: Record<string, string> = {}
      if (init.body !== undefined) headers['content-type'] = 'application/json'
      const token = await options.token?.()
      if (token) headers['x-dsh-pet-token'] = token
      const response = await doFetch(`${base}${path}`, {
        method,
        signal,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
      const raw = response.status === 204 ? '' : await response.text()
      let parsed: unknown = null
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        // 不是 JSON，当作没有内容
      }
      const body = (parsed !== null && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>
      if (response.status === 403) return { ok: false, reason: 'unauthorized', message: asText(body.error) }
      if (!response.ok) return { ok: false, reason: `http-${response.status}`, message: asText(body.error) }
      if (body.ok === false) return { ok: false, reason: asText(body.reason) ?? 'failed', message: asText(body.message) }
      return { ok: true, body }
    } catch (error) {
      const aborted = init.signal?.aborted === true
      return { ok: false, reason: aborted ? 'aborted' : 'unreachable', message: error instanceof Error ? error.message : String(error) }
    }
  }

  const plain = (reply: Reply): Plain => (reply.ok ? { ok: true } : reply)

  return {
    async pets() {
      const reply = await call('GET', '/config')
      if (!reply.ok) return reply
      const ids: string[] = []
      for (const entry of Object.values(reply.body)) {
        const list = (entry as { pets?: unknown } | null)?.pets
        if (!Array.isArray(list)) continue
        for (const item of list) {
          const id = (item as { id?: unknown } | null)?.id
          if (typeof id === 'string') ids.push(id)
        }
      }
      return { ok: true, ids }
    },
    async ping() {
      return (await call('GET', '/state')).ok
    },
    async setWorkStatus(state, task) {
      return plain(await call('POST', '/work-status', { body: task === undefined ? { state } : { state, task } }))
    },
    async clearWorkStatus() {
      return plain(await call('DELETE', '/work-status'))
    },
    async broadcast(text, { durationMs, lockId }) {
      const lock = lockId ? `&lock=${encodeURIComponent(lockId)}` : ''
      return plain(await call('POST', `/broadcast?${target}${lock}`, { body: { text, duration: durationMs } }))
    },
    async acquireLock(ttlMs) {
      const reply = await call('POST', `/lock?${target}`, { body: { ttl: ttlMs } })
      if (!reply.ok) return reply
      const lockId = asText(reply.body.lockId)
      return lockId ? { ok: true, lockId } : { ok: false, reason: 'bad-response' }
    },
    async releaseLock(lockId) {
      return plain(await call('POST', `/lock/release?pet=${petId}`, { body: { lockId } }))
    },
    async registerMenu(owner, labels) {
      return plain(await call('POST', '/menu/item', { body: { owner, labels } }))
    },
    async clearMenu(owner) {
      return plain(await call('DELETE', `/menu/item?owner=${encodeURIComponent(owner)}`))
    },
    async pollMenu(owner, waitMs, signal) {
      const reply = await call('GET', `/menu/events?owner=${encodeURIComponent(owner)}&wait=${waitMs}`, { timeoutMs: waitMs + 3000, signal })
      if (!reply.ok) return reply
      const events = (reply.body.events !== null && typeof reply.body.events === 'object' ? reply.body.events : {}) as Record<string, unknown>
      return { ok: true, clicked: Object.entries(events).filter(([, pet]) => typeof pet === 'string').map(([label]) => label) }
    },
  }
}
