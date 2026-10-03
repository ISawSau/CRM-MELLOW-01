import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { Dashboard, Widget } from '@shared/analysis'
import { t } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { NameDialog } from '../ui/NameDialog'
import { WidgetDialog, WidgetView } from './Widget'

const KEY = ['data', 'analysis', 'dashboards']

/** Dashboards de widgets configurables, global y por cliente (SPEC §7.13). */
export function Dashboards() {
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: KEY, queryFn: () => call('analysis:dashboards') })
  const clients = useQuery({
    queryKey: ['data', 'meta', 'clients'],
    queryFn: () => call('data:query', { entity: 'cliente' }),
  })
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [widget, setWidget] = useState<Widget | 'new' | null>(null)
  const [naming, setNaming] = useState(false)
  const dashboards = list.data ?? []
  const current = dashboards.find((d) => d.id === currentId) ?? dashboards[0]
  if (!current) return null

  const save = (next: Dashboard[]) => {
    void qc.cancelQueries({ queryKey: KEY })
    qc.setQueryData(KEY, next)
    void call('analysis:setDashboards', { dashboards: next })
      .then((d) => qc.setQueryData(KEY, d))
      .catch((e: unknown) => {
        void qc.invalidateQueries({ queryKey: KEY })
        toast.show(e instanceof IpcCallError ? e.message : t('No se pudo guardar.'), 'error')
      })
  }
  const update = (d: Dashboard) => save(dashboards.map((x) => (x.id === d.id ? d : x)))
  const move = (i: number, dir: -1 | 1) => {
    const ws = [...current.widgets]
    const j = i + dir
    if (j < 0 || j >= ws.length) return
    ;[ws[i], ws[j]] = [ws[j]!, ws[i]!]
    update({ ...current, widgets: ws })
  }
  const filter = current.clientId
    ? ({ type: 'client', id: current.clientId } as const)
    : ({ type: 'all' } as const)

  return (
    <div className="dashboards" data-testid="dashboards">
      <div className="meta-toolbar">
        <div className="field">
          <label htmlFor="dash">{t('Dashboard')}</label>
          <select
            id="dash"
            className="input"
            value={current.id}
            onChange={(e) => setCurrentId(e.target.value)}
          >
            {dashboards.map((d) => (
              <option key={d.id} value={d.id}>
                {t(d.name)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="dash-client">{t('Datos de')}</label>
          <select
            id="dash-client"
            className="input"
            value={current.clientId ?? ''}
            disabled={!editing}
            onChange={(e) => update({ ...current, clientId: e.target.value || null })}
          >
            <option value="">{t('Todas las cuentas')}</option>
            {(clients.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <span className="form-actions">
          {editing ? (
            <>
              <button type="button" className="btn" onClick={() => setWidget('new')}>
                {t('+ Widget')}
              </button>
              {dashboards.length > 1 && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    save(dashboards.filter((d) => d.id !== current.id))
                    setCurrentId(null)
                    setEditing(false)
                  }}
                >
                  {t('Borrar dashboard')}
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={() => setEditing(false)}>
                {t('Listo')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setNaming(true)}>
                {t('Nuevo dashboard')}
              </button>
              <button type="button" className="btn" onClick={() => setEditing(true)}>
                {t('Editar')}
              </button>
            </>
          )}
        </span>
      </div>
      <div className="widget-grid">
        {current.widgets.map((w, i) => (
          <div key={w.id} className="widget-cell" data-size={w.size}>
            <WidgetView
              w={w}
              filter={filter}
              onEdit={editing ? () => setWidget(w) : null}
              onRemove={
                editing
                  ? () =>
                      update({ ...current, widgets: current.widgets.filter((x) => x.id !== w.id) })
                  : null
              }
            />
            {editing && (
              <div className="widget-move">
                <button
                  type="button"
                  className="btn-link"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  {t('← Antes')}
                </button>
                <button
                  type="button"
                  className="btn-link"
                  disabled={i === current.widgets.length - 1}
                  onClick={() => move(i, 1)}
                >
                  {t('Después →')}
                </button>
              </div>
            )}
          </div>
        ))}
        {current.widgets.length === 0 && (
          <p className="faint">{t('Este dashboard está vacío. Pulsa Editar → + Widget.')}</p>
        )}
      </div>
      {widget && (
        <WidgetDialog
          widget={widget === 'new' ? null : widget}
          onClose={() => setWidget(null)}
          onSave={(w) => {
            const exists = current.widgets.some((x) => x.id === w.id)
            update({
              ...current,
              widgets: exists
                ? current.widgets.map((x) => (x.id === w.id ? w : x))
                : [...current.widgets, w],
            })
            setWidget(null)
          }}
        />
      )}
      {naming && (
        <NameDialog
          title={t('Nuevo dashboard')}
          label={t('Nombre del dashboard')}
          onCancel={() => setNaming(false)}
          onSubmit={(name) => {
            const id = `d-${Date.now().toString(36)}`
            save([...dashboards, { id, name, clientId: null, widgets: [] }])
            setCurrentId(id)
            setEditing(true)
            setNaming(false)
          }}
        />
      )}
    </div>
  )
}
