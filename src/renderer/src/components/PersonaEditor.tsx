import { useState, type FormEvent } from 'react'
import { joinPersona, PERSONA_SECTIONS, splitPersona, type PersonaSections } from '../../../shared/persona'
import { useAction } from '../hooks/useAction'
import { useSnapshot } from '../hooks/useSnapshot'
import { ErrorNote } from './Notices'

/** 管家人格：四栏分别改；标题被改乱了就整篇改 */
export default function PersonaEditor() {
  const { data, error } = useSnapshot('persona:get')
  const { data: presets } = useSnapshot('persona:presets')
  if (error) return <ErrorNote message={error} />
  if (!data || !presets) return <p className="hint">加载中…</p>
  return <PersonaFields initialMarkdown={data.markdown} initialSections={data.sections} presets={presets} />
}

function PersonaFields({
  initialMarkdown,
  initialSections,
  presets,
}: {
  initialMarkdown: string
  initialSections: PersonaSections | null
  presets: Array<{ id: string; name: string; markdown: string }>
}) {
  const [sections, setSections] = useState<PersonaSections | null>(initialSections)
  const [raw, setRaw] = useState(initialMarkdown)
  const [preset, setPreset] = useState('')
  const act = useAction()

  function applyPreset(): void {
    const chosen = presets.find((p) => p.id === preset)
    if (!chosen) return
    setSections(splitPersona(chosen.markdown))
    setRaw(chosen.markdown)
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    void act.run(() => window.butler.invoke('persona:save', { markdown: sections ? joinPersona(sections) : raw }))
  }

  return (
    <form onSubmit={save}>
      <div className="inline-form">
        <select aria-label="套用预设" value={preset} onChange={(e) => setPreset(e.target.value)}>
          <option value="">套用一套预设…</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" disabled={!preset} onClick={applyPreset}>
          填入编辑框
        </button>
        <span className="hint">填进来以后还要点下面的“保存人格”才算数。</span>
      </div>

      {sections ? (
        PERSONA_SECTIONS.map((title) => (
          <div className="field" key={title}>
            <label htmlFor={`persona-${title}`}>{title}</label>
            <textarea id={`persona-${title}`} rows={4} value={sections[title]} onChange={(e) => setSections({ ...sections, [title]: e.target.value })} />
          </div>
        ))
      ) : (
        <div className="field">
          <p className="hint">管家人格.md 的标题被改动过，没法按四栏拆开，所以按整篇编辑。</p>
          <label htmlFor="persona-raw">整篇人格</label>
          <textarea id="persona-raw" rows={14} value={raw} onChange={(e) => setRaw(e.target.value)} />
        </div>
      )}

      <ErrorNote message={act.error} />
      <div className="actions">
        <button type="submit" className="primary" disabled={act.busy}>
          保存人格
        </button>
      </div>
    </form>
  )
}
