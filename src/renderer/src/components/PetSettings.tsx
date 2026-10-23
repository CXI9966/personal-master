import { useEffect, useState, type FormEvent } from 'react'
import { DEFAULT_PET_SETTINGS, type PetLaunchStatus, type PetSettings as Settings, type PetTestResult } from '../../../shared/pet'
import type { Action } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'

/** 桌宠（dsh-pet）接入：开关、地址、宠物 id、几个子开关、试连。这台电脑的设置，不在工作区里 */
export default function PetSettings({ act }: { act: Action }) {
  const { data, reload } = useSnapshot('pet:get')
  const [form, setForm] = useState<Settings>(DEFAULT_PET_SETTINGS)
  const [loaded, setLoaded] = useState(false)
  const [result, setResult] = useState<PetTestResult | null>(null)
  const [saved, setSaved] = useState(false)
  const [launchStatus, setLaunchStatus] = useState<PetLaunchStatus | null>(null)

  // 桌宠的启动进展由主进程维护，这里隔几秒问一次
  useEffect(() => {
    let alive = true
    const tick = (): void => {
      window.butler.invoke('pet:status').then(
        (status) => alive && setLaunchStatus(status),
        () => undefined,
      )
    }
    tick()
    const timer = setInterval(tick, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const launch = (): Promise<boolean> => act.run(async () => setLaunchStatus(await window.butler.invoke('pet:launch')))

  useEffect(() => {
    if (data && !loaded) {
      setForm(data)
      setLoaded(true)
    }
  }, [data, loaded])

  const change = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    setForm((current) => ({ ...current, [key]: value }))
    setSaved(false)
    setResult(null) // 改了设置，之前的试连结果就不作数了
  }

  const save = (event: FormEvent): Promise<boolean> => {
    event.preventDefault()
    return act.run(async () => {
      setForm(await window.butler.invoke('pet:save', form))
      reload() // 已保存的值变了，“现在启动”这类要和它比对的按钮才会跟着更新
      setResult(null)
      setSaved(true)
    })
  }

  const test = (): Promise<boolean> =>
    act.run(async () => {
      setSaved(false)
      setResult(null)
      setResult(await window.butler.invoke('pet:test', { baseUrl: form.baseUrl, petId: form.petId }))
    })

  if (!loaded) return null
  const off = !form.enabled

  return (
    <section className="card" aria-labelledby="pet-title">
      <h2 id="pet-title">桌宠</h2>
      <p className="hint">
        接上本机运行的 dsh-pet（装在 DSH 里，或者独立运行的 dsh-pet-standalone）：Butler 里的打卡、任务、提醒会让桌宠有反应，桌宠的右键菜单里可以直接打卡，管家也会用自己的口吻说话。桌宠没开时什么都不会发生。独立运行的 dsh-pet 每次启动都会换访问令牌，Butler 会自动从它写在 DSH_HOME 下的运行状态文件里读，不用手动填。
      </p>
      <form onSubmit={save}>
        <label className="day-check">
          <input type="checkbox" checked={form.enabled} onChange={(e) => change('enabled', e.target.checked)} />
          启用桌宠
        </label>
        <div className="field-row">
          <div className="field">
            <label htmlFor="pet-url">dsh-pet 的接口地址（只能是本机）</label>
            <input id="pet-url" type="text" spellCheck={false} value={form.baseUrl} onChange={(e) => change('baseUrl', e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="pet-id">宠物 id</label>
            <input id="pet-id" type="text" spellCheck={false} value={form.petId} onChange={(e) => change('petId', e.target.value)} />
          </div>
        </div>
        <label className="day-check">
          <input type="checkbox" disabled={off} checked={form.status} onChange={(e) => change('status', e.target.checked)} />
          桌宠随 Butler 的状态变化（提醒时等待、管家回复时思考、出错时报错）
        </label>
        <label className="day-check">
          <input type="checkbox" disabled={off} checked={form.menu} onChange={(e) => change('menu', e.target.checked)} />
          在桌宠的右键菜单里加打卡、完成任务、打开 Butler
        </label>
        <label className="day-check">
          <input type="checkbox" disabled={off} checked={form.lines} onChange={(e) => change('lines', e.target.checked)} />
          打卡、完成任务这些事发生时，管家说一句话
        </label>
        <label className="day-check">
          <input type="checkbox" disabled={off || !form.lines} checked={form.linesUseModel} onChange={(e) => change('linesUseModel', e.target.checked)} />
          让模型来写这句话（会消耗少量 token，记在“本周用量”的“桌宠台词”里；关掉就只用内置的话）
        </label>
        <div className="field">
          <label htmlFor="pet-interval">模型写台词的最短间隔（分钟）</label>
          <input
            id="pet-interval"
            type="number"
            min="1"
            max="240"
            step="1"
            disabled={off || !form.lines || !form.linesUseModel}
            value={form.linesMinIntervalMin}
            onChange={(e) => change('linesMinIntervalMin', Number(e.target.value))}
          />
        </div>
        <p className="hint">间隔内发生的事用内置的话回应，另外每小时最多让模型写 6 次。</p>
        <div className="field">
          <label htmlFor="pet-launcher">桌宠的启动文件（完整路径，.bat、.cmd 或 .exe）</label>
          <input
            id="pet-launcher"
            type="text"
            spellCheck={false}
            placeholder="比如 D:\dev\dsh-pet\start-pet.bat"
            value={form.launcher}
            onChange={(e) => change('launcher', e.target.value)}
          />
        </div>
        <label className="day-check">
          <input
            type="checkbox"
            disabled={off || form.launcher.trim() === ''}
            checked={form.autoStart}
            onChange={(e) => change('autoStart', e.target.checked)}
          />
          打开 Butler 时，桌宠没在运行就用这个文件启动它（Butler 退出时只关它自己启动的那个）
        </label>
        <p className="hint">Butler 只负责启动，不负责下载桌宠。桌宠要你先自己装好，启动文件指到它就行。</p>
        {launchStatus && (
          <p role="status" className={launchStatus.state === 'failed' || launchStatus.state === 'missing' ? 'error' : 'hint'}>
            <span
              className={`light ${launchStatus.state === 'started' || launchStatus.state === 'external' ? 'ok' : launchStatus.state === 'failed' || launchStatus.state === 'missing' ? 'bad' : ''}`}
              aria-hidden="true"
            />
            桌宠：{launchStatus.message}
          </p>
        )}
        {result && (
          <p role="status" className={result.ok ? 'hint' : 'error'}>
            <span className={result.ok ? 'light ok' : 'light bad'} aria-hidden="true" />
            {result.message}
          </p>
        )}
        {saved && (
          <p role="status" className="hint">
            已保存
          </p>
        )}
        <div className="actions">
          <button
            type="button"
            disabled={act.busy || form.launcher.trim() === '' || form.launcher.trim() !== (data?.launcher ?? '')}
            title="按已保存的启动文件启动；刚改过的话先保存"
            onClick={launch}
          >
            现在启动桌宠
          </button>
          <button type="button" disabled={act.busy} onClick={test}>
            测试连接
          </button>
          <button type="submit" className="primary" disabled={act.busy}>
            保存桌宠设置
          </button>
        </div>
      </form>
    </section>
  )
}
