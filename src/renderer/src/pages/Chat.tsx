import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react'
import ActionCardView from '../components/ActionCardView'
import type { ChatApi } from '../hooks/useChat'
import { useSnapshot } from '../hooks/useSnapshot'
import { PLAN_PROMPT, REVIEW_PROMPT, useShell } from '../shellContext'

export default function Chat({ chat }: { chat: ChatApi }) {
  const shell = useShell()
  const { data: status } = useSnapshot('ai:status')
  const { draft, setDraft } = chat // 输入框的字存在上一层，切页面不会丢
  const log = useRef<HTMLDivElement>(null)
  const notConfigured = status !== null && !status.configured

  // 新内容出现时滚到底
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight
  }, [chat.items])

  function submit(event?: FormEvent): void {
    event?.preventDefault()
    if (!draft.trim() || chat.busy) return
    void chat.send(draft, 'chat')
    setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter 发送，Shift+Enter 换行；用拼音输入法选字时的 Enter 不算
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="chat">
      <header className="card-header">
        <h1>管家</h1>
        <button type="button" disabled={chat.items.length === 0} onClick={chat.reset}>
          新对话
        </button>
      </header>

      {notConfigured && (
        <section className="banner" aria-label="还没有配置模型接口">
          <strong>还没有配置模型接口</strong>
          <p>管家需要你填一个模型接口（地址、模型名、API key）才能聊天。其他功能不受影响。</p>
          <button type="button" className="primary" onClick={() => shell.goto('settings')}>
            去设置
          </button>
        </section>
      )}

      <div className="row quick">
        <button type="button" disabled={chat.busy} onClick={() => void chat.send(PLAN_PROMPT, 'plan')}>
          让管家排今天
        </button>
        <button type="button" disabled={chat.busy} onClick={() => void chat.send(REVIEW_PROMPT, 'review')}>
          复盘并检验
        </button>
      </div>

      <div ref={log} className="chat-log" role="log" aria-label="对话" aria-live="polite">
        {chat.items.length === 0 && <p className="hint">和管家说点什么吧。它能帮你排计划、记任务、记体重、做学习检验。</p>}
        {chat.items.map((item) =>
          item.kind === 'user' ? (
            <div key={item.id} className="msg user">
              <p className="msg-text">{item.text}</p>
            </div>
          ) : (
            <div key={item.id} className="msg assistant">
              {item.text && <p className="msg-text">{item.text}</p>}
              {item.streaming && !item.text && item.cards.length === 0 && <p className="hint">管家在想……</p>}
              {item.cards.length > 0 && (
                <ul className="cards" aria-label="管家提出的动作">
                  {item.cards.map((card) => (
                    <ActionCardView key={card.id} card={card} onChange={chat.setCard} />
                  ))}
                </ul>
              )}
              {item.notices.map((notice) => (
                <p key={notice} className="hint">
                  {notice}
                </p>
              ))}
              {item.aborted && <p className="hint">已停止</p>}
              {item.error && (
                <p role="alert" className="error">
                  {item.error}
                </p>
              )}
            </div>
          ),
        )}
      </div>

      <form className="chat-input" onSubmit={submit}>
        <label htmlFor="chat-draft" className="sr-only">
          给管家发消息
        </label>
        <textarea
          id="chat-draft"
          rows={2}
          placeholder="给管家发消息（Enter 发送，Shift+Enter 换行）"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {chat.busy ? (
          <button type="button" onClick={chat.stop}>
            停止
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!draft.trim()}>
            发送
          </button>
        )}
      </form>
    </div>
  )
}
