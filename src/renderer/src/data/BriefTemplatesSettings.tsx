import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  SECTION_KIND_LABELS,
  SECTION_KINDS,
  type BriefTemplate,
  type SectionKind,
} from '@shared/data/brief-templates'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`

function Editor({ initial }: { initial: BriefTemplate[] }) {
  const [list, setList] = useState(initial)
  const [selected, setSelected] = useState(initial[0]?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  const toast = useToast()
  const t = list.find((x) => x.id === selected) ?? null
  const update = (patch: Partial<BriefTemplate>) =>
    setList((l) => l.map((x) => (x.id === selected ? { ...x, ...patch } : x)))
  const sections = t?.sections ?? []
  const setSection = (i: number, patch: Partial<BriefTemplate['sections'][number]>) =>
    update({ sections: sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const move = (i: number, d: number) => {
    const j = i + d
    if (j < 0 || j >= sections.length) return
    const next = [...sections]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    update({ sections: next })
  }

  const save = async () => {
    setError(null)
    try {
      const saved = await call('briefs:setTemplates', { templates: list })
      qc.setQueryData(['data', 'brief-templates'], saved)
      toast.show('Plantillas guardadas.')
    } catch (e) {
      setError(
        e instanceof IpcCallError ? e.message : 'Revisa que ninguna sección quede sin título.',
      )
    }
  }

  return (
    <div className="form">
      <div className="template-tabs" role="tablist" aria-label="Plantillas">
        {list.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === selected}
            onClick={() => setSelected(x.id)}
          >
            {x.name || 'Sin nombre'}
          </button>
        ))}
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            const n: BriefTemplate = {
              id: newId('plantilla'),
              name: 'Nueva plantilla',
              sections: [{ id: newId('s'), title: 'Objetivo', kind: 'text', hint: '' }],
            }
            setList((l) => [...l, n])
            setSelected(n.id)
          }}
        >
          + Plantilla
        </button>
      </div>
      {t && (
        <>
          <div className="field">
            <label htmlFor="tpl-name">Nombre de la plantilla</label>
            <input
              id="tpl-name"
              className="input"
              maxLength={80}
              value={t.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          </div>
          <ul className="template-sections">
            {sections.map((s, i) => (
              <li key={s.id} className="template-section">
                <input
                  className="input"
                  aria-label="Título de la sección"
                  maxLength={120}
                  value={s.title}
                  onChange={(e) => setSection(i, { title: e.target.value })}
                />
                <select
                  className="input"
                  aria-label="Tipo de sección"
                  value={s.kind}
                  onChange={(e) => setSection(i, { kind: e.target.value as SectionKind })}
                >
                  {SECTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SECTION_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
                <input
                  className="input template-hint"
                  aria-label="Indicación"
                  placeholder="Indicación para quien rellena el brief"
                  maxLength={300}
                  value={s.hint}
                  onChange={(e) => setSection(i, { hint: e.target.value })}
                />
                <span className="menu-move">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Subir sección"
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Bajar sección"
                    disabled={i === sections.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Quitar ${s.title}`}
                    onClick={() => update({ sections: sections.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              onClick={() =>
                update({
                  sections: [
                    ...sections,
                    { id: newId('s'), title: 'Sección', kind: 'text', hint: '' },
                  ],
                })
              }
            >
              + Sección
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                const rest = list.filter((x) => x.id !== t.id)
                setList(rest)
                setSelected(rest[0]?.id ?? null)
              }}
            >
              Eliminar plantilla
            </button>
          </div>
        </>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          Guardar plantillas
        </button>
      </div>
      <p className="hint">
        Los archivos y los enlaces a creatividades llegan en la fase 4; de momento esas secciones
        quedan como texto.
      </p>
    </div>
  )
}

/** Ajustes → Plantillas de brief (SPEC §7.7). */
export function BriefTemplatesSettings() {
  const templates = useQuery({
    queryKey: ['data', 'brief-templates'],
    queryFn: () => call('briefs:templates'),
  })
  return (
    <section className="settings-block" data-testid="brief-templates">
      <div>
        <h2>Plantillas de brief</h2>
        <p className="desc">
          Secciones con las que empieza un brief creado «desde plantilla». Cámbialas cuando tengas
          tu estructura definitiva.
        </p>
      </div>
      <div className="settings-body settings-body-wide">
        {templates.data && <Editor key={JSON.stringify(templates.data)} initial={templates.data} />}
      </div>
    </section>
  )
}
