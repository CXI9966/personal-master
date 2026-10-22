import { useState, type FormEvent } from 'react'
import type { SettingsFile } from '../../../shared/schema'
import type { AutostartInfo } from '../../../shared/views'
import type { Action } from '../hooks/useAction'

/** 到点提醒（开关和两个时间），以及开机自启（这台电脑的设置，不在工作区里） */
export default function SettingsReminders({
  reminders,
  autostart,
  act,
}: {
  reminders: SettingsFile['reminders']
  autostart: AutostartInfo
  act: Action
}) {
  const [enabled, setEnabled] = useState(reminders.enabled)
  const [plan, setPlan] = useState(reminders.plan ?? '')
  const [review, setReview] = useState(reminders.review ?? '')
  const [startup, setStartup] = useState(autostart)

  const save = (event: FormEvent): Promise<boolean> => {
    event.preventDefault()
    return act.run(() => window.butler.invoke('settings:update', { reminders: { enabled, plan: plan || null, review: review || null } }))
  }

  // 先按点的结果显示出来（不然勾选框要等主进程应答才动，手感很迟钝）；以主进程返回的为准，失败就退回去
  async function toggleStartup(next: boolean): Promise<void> {
    const previous = startup
    setStartup({ ...previous, enabled: next })
    const ok = await act.run(async () => setStartup(await window.butler.invoke('autostart:set', { enabled: next })))
    if (!ok) setStartup(previous)
  }

  return (
    <>
      <section className="card" aria-labelledby="reminders-title">
        <h2 id="reminders-title">提醒</h2>
        <p className="hint">到点用系统通知提醒你。这件事已经做了就不提醒，每件事每天最多提醒一次。关掉窗口后软件会留在托盘里，提醒才会继续。</p>
        <form onSubmit={save}>
          <label className="day-check">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            开启提醒
          </label>
          <div className="field-row">
            <div className="field">
              <label htmlFor="remind-plan">今天还没排计划时，提醒的时间</label>
              <input id="remind-plan" type="time" value={plan} onChange={(e) => setPlan(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="remind-review">今天还没复盘时，提醒的时间</label>
              <input id="remind-review" type="time" value={review} onChange={(e) => setReview(e.target.value)} />
            </div>
          </div>
          <p className="hint">时间留空，就不提醒那一项。</p>
          <div className="actions">
            <button type="submit" className="primary" disabled={act.busy}>保存提醒</button>
          </div>
        </form>
      </section>

      <section className="card" aria-labelledby="autostart-title">
        <h2 id="autostart-title">开机自启</h2>
        {startup.supported ? (
          <label className="day-check">
            <input type="checkbox" checked={startup.enabled} disabled={act.busy} onChange={(e) => void toggleStartup(e.target.checked)} />
            开机后自动启动，只留在托盘，不弹出窗口
          </label>
        ) : (
          <p className="hint">现在是开发模式，不能设置开机自启。装好的版本里才有这个开关。</p>
        )}
      </section>
    </>
  )
}
