import { useState, type FormEvent } from 'react'
import type { AiStatus, ConnectionResult } from '../../../shared/ai'
import type { ActionMode, ContextStrategy, ProviderKind } from '../../../shared/schema'
import { useAction } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'
import { ErrorNote } from './Notices'

interface Props {
  /** 保存成功之后 */
  onSaved?: () => void
  /** 给了就显示“跳过”按钮（第一次运行用） */
  onSkip?: () => void
  saveLabel?: string
}

/** 读出当前配置，再交给表单。表单的输入框用配置做初始值，之后由用户自己改 */
export default function ModelForm(props: Props) {
  const { data, error } = useSnapshot('ai:status')
  if (error) return <ErrorNote message={error} />
  if (!data) return <p className="hint">加载中…</p>
  return <ModelFormFields status={data} {...props} />
}

function ModelFormFields({ status, onSaved, onSkip, saveLabel = '保存' }: Props & { status: AiStatus }) {
  const [kind, setKind] = useState<ProviderKind>(status.provider.kind)
  const [baseURL, setBaseURL] = useState(status.provider.baseURL)
  const [model, setModel] = useState(status.provider.model)
  const [apiKey, setApiKey] = useState('')
  const [strategy, setStrategy] = useState<ContextStrategy>(status.contextStrategy)
  const [mode, setMode] = useState<ActionMode>(status.actionMode)
  const [result, setResult] = useState<ConnectionResult | null>(null)
  const act = useAction()

  const provider = { kind, baseURL, model }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault()
    const ok = await act.run(() =>
      window.butler.invoke('ai:save', { provider, contextStrategy: strategy, actionMode: mode, apiKey: apiKey.trim() || undefined }),
    )
    if (ok) {
      setApiKey('')
      onSaved?.()
    }
  }

  async function test(): Promise<void> {
    setResult(null)
    await act.run(async () => setResult(await window.butler.invoke('ai:test', { provider, apiKey: apiKey.trim() || undefined })))
  }

  return (
    <form onSubmit={save}>
      <div className="field">
        <label htmlFor="model-kind">接口类型</label>
        <select id="model-kind" value={kind} onChange={(e) => setKind(e.target.value as ProviderKind)}>
          <option value="openai-compatible">OpenAI 兼容（DeepSeek、通义、Kimi、智谱、OpenRouter、Ollama 等）</option>
          <option value="anthropic">Anthropic（Claude，或兼容它的代理）</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="model-url">接口地址</label>
        <input id="model-url" type="text" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} spellCheck={false} placeholder="https://……/v1" />
        <p className="hint">照服务商的文档填，通常以 /v1 结尾。程序不会替你补。</p>
      </div>
      <div className="field">
        <label htmlFor="model-name">模型名</label>
        <input id="model-name" type="text" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
      </div>
      <div className="field">
        <label htmlFor="model-key">API key</label>
        <input id="model-key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={status.hasKey ? '已保存，不改就留空' : ''} />
        <p className="hint">{status.hasKey ? '已经保存了一个 key。' : '还没有保存 key。'}key 会加密保存在这台电脑上，不会放进工作区。</p>
        {!status.encryptionAvailable && <p className="error">这台电脑上无法加密保存 key，所以保存 key 会被拒绝。</p>}
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="model-strategy">每次给管家看哪些内容</label>
          <select id="model-strategy" value={strategy} onChange={(e) => setStrategy(e.target.value as ContextStrategy)}>
            <option value="scene">按场景挑（推荐，省钱）</option>
            <option value="full">每次一份完整概况</option>
            <option value="tools">让它自己按需查（要模型支持工具调用）</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="model-mode">动作模式</label>
          <select id="model-mode" value={mode} onChange={(e) => setMode(e.target.value as ActionMode)}>
            <option value="tools">工具调用（推荐）</option>
            <option value="json">JSON 文本（模型不支持工具调用时用）</option>
          </select>
        </div>
      </div>

      <ErrorNote message={act.error} />
      {result && (
        <p role="status" className={result.ok ? 'hint' : 'error'}>
          {result.ok ? `连接成功，模型回复：${result.reply || '（空）'}` : result.message}
        </p>
      )}
      <div className="actions">
        {onSkip && (
          <button type="button" disabled={act.busy} onClick={onSkip}>
            跳过，以后再填
          </button>
        )}
        {status.hasKey && (
          <button type="button" disabled={act.busy} onClick={() => act.run(() => window.butler.invoke('ai:save', { provider, contextStrategy: strategy, actionMode: mode, clearKey: true }))}>
            清除已保存的 key
          </button>
        )}
        <button type="button" disabled={act.busy} onClick={test}>
          测试连接
        </button>
        <button type="submit" className="primary" disabled={act.busy}>
          {saveLabel}
        </button>
      </div>
    </form>
  )
}
