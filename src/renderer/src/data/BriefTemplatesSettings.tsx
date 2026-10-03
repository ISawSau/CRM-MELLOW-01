import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  SECTION_KIND_LABELS,
  SECTION_KINDS,
  type BriefTemplate,
  type SectionKind,
} from '@shared/data/brief-templates'
import { t } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'

const newId = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`
const days = (v: string): number | null =>
  v.trim() === '' ? null : Math.min(365, Math.max(0, Math.round(Number(v) || 0)))

function Editor({ initial }: { initial: BriefTemplate[] }) {
  const [list, setList] = useState(initial)
  const [selected, setSelected] = useState(initial[0]?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const qc = useQueryClient()
  const toast = useToast()
  const tpl = list.find((x) => x.id === selected) ?? null
  const update = (patch: Partial<BriefTemplate>) =>
    setList((l) => l.map((x) => (x.id === selected ? { ...x, ...patch } : x)))
  const sections = tpl?.sections ?? []
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
      toast.show(t('Plantillas guardadas.'))
    } catch (e) {
      setError(
        e instanceof IpcCallError ? e.message : t('Revisa que ninguna sección quede sin título.'),
      )
    }
  }

  return (
    <div className="form">
      <div className="template-tabs" role="tablist" aria-label={t('Plantillas')}>
        {list.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={x.id === selected}
            onClick={() => setSelected(x.id)}
          >
            {x.name || t('Sin nombre')}
          </button>
        ))}
        <button
          type="button"
          className="btn-link"
          onClick={() => {
            const n: BriefTemplate = {
              id: newId('plantilla'),
              name: t('Nueva plantilla'),
              sections: [{ id: newId('s'), title: t('Objetivo'), kind: 'text', hint: '' }],
              dueDays: null,
              tasks: [],
            }
            setList((l) => [...l, n])
            setSelected(n.id)
          }}
        >
          + {t('Plantilla')}
        </button>
      </div>
      {tpl && (
        <>
          <div className="tool-options">
            <div className="field">
              <label htmlFor="tpl-name">{t('Nombre de la plantilla')}</label>
              <input
                id="tpl-name"
                className="input"
                maxLength={80}
                value={tpl.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="tpl-due">{t('Entrega a los (días)')}</label>
              <input
                id="tpl-due"
                className="input num"
                type="number"
                min={0}
                max={365}
                placeholder={t('Sin fecha')}
                value={tpl.dueDays ?? ''}
                onChange={(e) => update({ dueDays: days(e.target.value) })}
              />
            </div>
          </div>
          <h3 className="panel-subtitle">{t('Secciones')}</h3>
          <ul className="template-sections">
            {sections.map((s, i) => (
              <li key={s.id} className="template-section">
                <input
                  className="input"
                  aria-label={t('Título de la sección')}
                  maxLength={120}
                  value={s.title}
                  onChange={(e) => setSection(i, { title: e.target.value })}
                />
                <select
                  className="input"
                  aria-label={t('Tipo de sección')}
                  value={s.kind}
                  onChange={(e) => setSection(i, { kind: e.target.value as SectionKind })}
                >
                  {SECTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(SECTION_KIND_LABELS[k])}
                    </option>
                  ))}
                </select>
                <input
                  className="input template-hint"
                  aria-label={t('Indicación')}
                  placeholder={t('Indicación para quien rellena el brief')}
                  maxLength={300}
                  value={s.hint}
                  onChange={(e) => setSection(i, { hint: e.target.value })}
                />
                <span className="menu-move">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Subir sección')}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Bajar sección')}
                    disabled={i === sections.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Quitar {title}', { title: s.title })}
                    onClick={() => update({ sections: sections.filter((_, j) => j !== i) })}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <h3 className="panel-subtitle">{t('Tareas que se crean con el brief')}</h3>
          {tpl.tasks.length === 0 && (
            <p className="faint">{t('Ninguna. Se crean enlazadas al brief y a su cliente.')}</p>
          )}
          <ul className="template-sections">
            {tpl.tasks.map((k, i) => (
              <li key={k.id} className="template-task">
                <input
                  className="input"
                  aria-label={t('Tarea')}
                  maxLength={200}
                  value={k.title}
                  onChange={(e) =>
                    update({
                      tasks: tpl.tasks.map((x, j) =>
                        j === i ? { ...x, title: e.target.value } : x,
                      ),
                    })
                  }
                />
                <label className="template-task-due">
                  <span className="faint">{t('para el día')}</span>
                  <input
                    className="input num"
                    type="number"
                    aria-label={t('Días para «{title}»', { title: k.title })}
                    min={0}
                    max={365}
                    placeholder="—"
                    value={k.dueDays ?? ''}
                    onChange={(e) =>
                      update({
                        tasks: tpl.tasks.map((x, j) =>
                          j === i ? { ...x, dueDays: days(e.target.value) } : x,
                        ),
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('Quitar la tarea {title}', { title: k.title })}
                  onClick={() => update({ tasks: tpl.tasks.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              disabled={tpl.tasks.length >= 30}
              onClick={() =>
                update({
                  tasks: [...tpl.tasks, { id: newId('t'), title: t('Nueva tarea'), dueDays: null }],
                })
              }
            >
              + {t('Tarea')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                update({
                  sections: [
                    ...sections,
                    { id: newId('s'), title: t('Sección'), kind: 'text', hint: '' },
                  ],
                })
              }
            >
              + {t('Sección')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                const copy: BriefTemplate = {
                  ...tpl,
                  id: newId('plantilla'),
                  name: t('{name} (copia)', { name: tpl.name }).slice(0, 80),
                }
                setList((l) => [...l, copy])
                setSelected(copy.id)
              }}
            >
              {t('Duplicar')}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                const rest = list.filter((x) => x.id !== tpl.id)
                setList(rest)
                setSelected(rest[0]?.id ?? null)
              }}
            >
              {t('Eliminar plantilla')}
            </button>
          </div>
        </>
      )}
      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          {t('Guardar plantillas')}
        </button>
      </div>
      <p className="hint">
        {t(
          'Las secciones de enlaces y de archivos recuerdan dónde completarlas: en los campos «Creatividades» y «Archivos» del brief. Los días cuentan desde que se crea el brief. También puedes guardar un brief ya escrito como plantilla desde su ficha.',
        )}
      </p>
    </div>
  )
}

/** Plantillas de brief (SPEC §7.7), en los ajustes de la sección Briefs. */
export function BriefTemplatesPanel() {
  const templates = useQuery({
    queryKey: ['data', 'brief-templates'],
    queryFn: () => call('briefs:templates'),
  })
  return (
    <div data-testid="brief-templates">
      <p className="muted">
        {t(
          'Un brief creado «desde plantilla» empieza con estas secciones, su fecha de entrega y sus tareas ya enlazadas.',
        )}
      </p>
      {templates.data && <Editor key={JSON.stringify(templates.data)} initial={templates.data} />}
    </div>
  )
}
