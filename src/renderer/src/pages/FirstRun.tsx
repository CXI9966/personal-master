import { useState } from 'react'
import { PERSONA_CHOICES, type PersonaId } from '../../../shared/persona'
import type { AppState } from '../../../shared/views'
import ModelForm from '../components/ModelForm'

interface Props {
  initial: AppState
  onDone: (state: AppState) => void
}

/** 第一次运行：选工作区文件夹，再选管家的性格 */
export default function FirstRun({ initial, onDone }: Props) {
  const [step, setStep] = useState<'folder' | 'persona' | 'model'>('folder')
  const [opened, setOpened] = useState<AppState | null>(null)
  const [root, setRoot] = useState(initial.defaultRoot)
  const [persona, setPersona] = useState<PersonaId>('coach')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(task: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const pick = () =>
    run(async () => {
      const picked = await window.butler.invoke('workspace:pick')
      if (picked) setRoot(picked)
    })

  const next = () =>
    run(async () => {
      const folder = root.trim()
      if (!folder) throw new Error('请先选一个文件夹')
      const info = await window.butler.invoke('workspace:inspect', { root: folder })
      if (info.initialized) onDone(await window.butler.invoke('workspace:open', { root: folder }))
      else setStep('persona')
    })

  // 工作区在这一步建好，但先不进主界面：还有一步可以顺手填模型接口
  const finish = () =>
    run(async () => {
      setOpened(await window.butler.invoke('workspace:init', { root: root.trim(), persona }))
      setStep('model')
    })

  const enter = (): void => {
    if (opened) onDone(opened)
  }

  return (
    <main className="first-run">
      <h1>欢迎使用 Butler</h1>
      {step === 'folder' && (
        <section aria-labelledby="folder-title">
          <p className="step">第 1 步，共 3 步</p>
          <h2 id="folder-title">选择工作区文件夹</h2>
          <p className="hint">
            你的计划、打卡和记录都放在这个文件夹里，是普通的文本文件，随时可以打开看。文件夹不存在会自动创建。
          </p>
          <label htmlFor="workspace-root">工作区文件夹</label>
          <div className="row">
            <input id="workspace-root" value={root} onChange={(e) => setRoot(e.target.value)} spellCheck={false} />
            <button type="button" onClick={pick} disabled={busy}>
              选择文件夹…
            </button>
          </div>
          <div className="actions">
            <button type="button" className="primary" onClick={next} disabled={busy}>
              下一步
            </button>
          </div>
        </section>
      )}
      {step === 'persona' && (
        <section aria-labelledby="persona-title">
          <p className="step">第 2 步，共 3 步</p>
          <h2 id="persona-title">管家的性格</h2>
          <p className="hint">选一个起步的风格，以后随时可以在设置里改。你的目标和作息不会被预填，都由你自己填。</p>
          <fieldset className="persona-choices">
            <legend>管家的性格</legend>
            {PERSONA_CHOICES.map((choice) => (
              <label key={choice.id} className={`choice${persona === choice.id ? ' selected' : ''}`}>
                <input
                  type="radio"
                  name="persona"
                  value={choice.id}
                  checked={persona === choice.id}
                  onChange={() => setPersona(choice.id)}
                />
                <span className="choice-name">{choice.name}</span>
                <span className="choice-summary">{choice.summary}</span>
              </label>
            ))}
          </fieldset>
          <div className="actions">
            <button type="button" onClick={() => setStep('folder')} disabled={busy}>
              上一步
            </button>
            <button type="button" className="primary" onClick={finish} disabled={busy}>
              下一步
            </button>
          </div>
        </section>
      )}
      {step === 'model' && (
        <section aria-labelledby="model-step-title">
          <p className="step">第 3 步，共 3 步</p>
          <h2 id="model-step-title">连上一个大模型（可以跳过）</h2>
          <p className="hint">管家要聊天、排计划，需要一个大模型接口。不填也能用打卡、任务、日历这些功能，以后在设置里补上就行。</p>
          <ModelForm saveLabel="保存并开始用" onSaved={enter} onSkip={enter} />
        </section>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  )
}
