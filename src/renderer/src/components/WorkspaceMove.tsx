import { useState } from 'react'
import type { FolderInfo } from '../../../shared/views'
import type { Action } from '../hooks/useAction'

type Step =
  | { kind: 'idle' }
  | { kind: 'migrate'; folder: string }
  | { kind: 'switch'; folder: string }
  | { kind: 'refused'; folder: string; reason: string }
  | { kind: 'done'; mode: 'migrate' | 'switch'; from: string; to: string; skipped: string[] }

function decide(folder: string, info: FolderInfo): Step {
  if (info.blocked) return { kind: 'refused', folder, reason: info.blocked }
  return info.initialized ? { kind: 'switch', folder } : { kind: 'migrate', folder }
}

/** 设置页“工作区”卡片里的迁移入口：选文件夹、确认、执行。出错时错误显示在页面顶部（act.error） */
export default function WorkspaceMove({ root, act }: { root: string; act: Action }) {
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const cancel = (): void => setStep({ kind: 'idle' })

  const choose = (): Promise<boolean> =>
    act.run(async () => {
      const folder = await window.butler.invoke('workspace:pick')
      if (!folder) return
      setStep(decide(folder, await window.butler.invoke('workspace:inspect', { root: folder })))
    })

  const migrate = (to: string): Promise<boolean> =>
    act.run(async () => {
      const result = await window.butler.invoke('workspace:migrate', { root: to })
      setStep({ kind: 'done', mode: 'migrate', from: root, to: result.workspaceRoot, skipped: result.skipped })
    })

  const switchTo = (to: string): Promise<boolean> =>
    act.run(async () => {
      const state = await window.butler.invoke('workspace:open', { root: to })
      setStep({ kind: 'done', mode: 'switch', from: root, to: state.workspaceRoot ?? to, skipped: [] })
    })

  return (
    <>
      {step.kind === 'migrate' && (
        <section className="banner" aria-label="确认迁移">
          <p>
            把工作区迁移到 <strong className="path">{step.folder}</strong>。程序会先复制全部数据并逐个检查，没问题再切换过去。旧文件夹{' '}
            <span className="path">{root}</span> 原样保留。
          </p>
          <div className="actions">
            <button type="button" disabled={act.busy} onClick={cancel}>
              取消
            </button>
            <button type="button" className="primary" disabled={act.busy} onClick={() => migrate(step.folder)}>
              {act.busy ? '迁移中…' : '迁移'}
            </button>
          </div>
        </section>
      )}
      {step.kind === 'switch' && (
        <section className="banner" aria-label="确认切换">
          <p>
            <strong className="path">{step.folder}</strong> 里已经有一个 Butler 工作区。切换过去会改用那里的数据，不会和现在的合并，现在这个工作区也不会被删除。
          </p>
          <div className="actions">
            <button type="button" disabled={act.busy} onClick={cancel}>
              取消
            </button>
            <button type="button" className="primary" disabled={act.busy} onClick={() => switchTo(step.folder)}>
              切换
            </button>
          </div>
        </section>
      )}
      {step.kind === 'refused' && (
        <section className="banner danger" role="alert">
          <p>{step.reason}</p>
          <p className="hint path">选的是：{step.folder}</p>
        </section>
      )}
      {step.kind === 'done' && (
        <section className="banner" role="status">
          {step.mode === 'migrate' ? (
            <p>
              已迁移到 <span className="path">{step.to}</span>。旧文件夹 <span className="path">{step.from}</span> 还在，确认新位置没问题后可以自己删除。
            </p>
          ) : (
            <p>
              已切换到 <span className="path">{step.to}</span>。原来的工作区 <span className="path">{step.from}</span> 没有改动，也没有和这边合并。
            </p>
          )}
          {step.skipped.length > 0 && <p className="hint">旧文件夹里这些不属于 Butler 的内容没有搬：{step.skipped.join('、')}。</p>}
        </section>
      )}
      {(step.kind === 'idle' || step.kind === 'refused' || step.kind === 'done') && (
        <div className="actions">
          <button type="button" disabled={act.busy} onClick={choose}>
            迁移到其他位置…
          </button>
        </div>
      )}
    </>
  )
}
