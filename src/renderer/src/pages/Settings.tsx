import ModelForm from '../components/ModelForm'
import { ErrorNote } from '../components/Notices'
import PersonaEditor from '../components/PersonaEditor'
import ProfileForm from '../components/ProfileForm'
import SettingsGeneral from '../components/SettingsGeneral'
import UsagePanel from '../components/UsagePanel'
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

      <section className="card" aria-labelledby="model-title">
        <h2 id="model-title">管家的模型接口</h2>
        <p className="hint">填一个你有 API 的大模型就行，OpenAI 兼容的和 Anthropic 的都支持。</p>
        <ModelForm />
      </section>

      <section className="card" aria-labelledby="persona-title">
        <h2 id="persona-title">管家的人格</h2>
        <p className="hint">说话风格、督促方式、检验规则、不许做的事，都可以按你喜欢的改。</p>
        <PersonaEditor />
      </section>

      <section className="card" aria-labelledby="usage-title">
        <h2 id="usage-title">本周用量</h2>
        <UsagePanel />
      </section>
    </div>
  )
}
