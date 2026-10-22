import ProfileForm from '../components/ProfileForm'
import { ErrorNote } from '../components/Notices'
import SettingsGeneral from '../components/SettingsGeneral'
import { useAction } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'

export default function Settings() {
  const { data, error } = useSnapshot('settings:get')
  const act = useAction()

  if (error) return <ErrorNote message={error} />
  if (!data) return <p className="hint">加载中…</p>

  return (
    <div>
      <h1>设置</h1>
      <ErrorNote message={act.error} />

      <section className="card" aria-labelledby="workspace-title">
        <h2 id="workspace-title">工作区</h2>
        <p>{data.workspaceRoot}</p>
        <p className="hint">所有数据都在这个文件夹里。data 文件夹是程序读写的原始数据，其余 .md 是自动生成给你看的。</p>
      </section>

      <SettingsGeneral settings={data.settings} act={act} />
      <ProfileForm profile={data.profile} act={act} />
    </div>
  )
}
