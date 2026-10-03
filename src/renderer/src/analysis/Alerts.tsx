import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { Alert, AnalysisFilter } from '@shared/analysis'
import { formatDateTime, formatNumber, parseNumberEs } from '@shared/format'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { isoToEs, useMetaStatus } from '../meta/meta'
import { useAllAccounts } from '../platforms/platforms'
import { formatMetric } from '../meta/metrics'
import { MetricSelect, useMetricKit } from './kit'

const KEY = ['data', 'analysis', 'alerts']

function scopeKey(s: AnalysisFilter): string {
  return s.type === 'client' ? `client:${s.id}` : s.type === 'account' ? `account:${s.id}` : 'all'
}

function AlertDialog({
  alert,
  onSave,
  onClose,
}: {
  alert: Alert | null
  onSave: (a: Alert) => void
  onClose: () => void
}) {
  const kit = useMetricKit()
  const accounts = useAllAccounts()
  const clients = useQuery({
    queryKey: ['data', 'meta', 'clients'],
    queryFn: () => call('data:query', { entity: 'cliente' }),
  })
  const [a, setA] = useState<Alert>(
    () =>
      alert ?? {
        id: `a-${Date.now().toString(36)}`,
        name: '',
        scope: { type: 'all' },
        metric: 'cpa',
        op: 'gt',
        threshold: 30,
        windowDays: 3,
        enabled: true,
      },
  )
  const [threshold, setThreshold] = useState(formatNumber(a.threshold))
  const set = (patch: Partial<Alert>) => setA((x) => ({ ...x, ...patch }))
  const value = parseNumberEs(threshold)
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="alert-t"
        data-testid="alert-dialog"
      >
        <h2 id="alert-t">{alert ? 'Editar alerta' : 'Nueva alerta'}</h2>
        <div className="field">
          <label htmlFor="al-name">Nombre</label>
          <input
            id="al-name"
            className="input"
            maxLength={80}
            placeholder="CPA alto en Acme"
            value={a.name}
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="al-scope">Datos de</label>
          <select
            id="al-scope"
            className="input"
            value={scopeKey(a.scope)}
            onChange={(e) => {
              const [type, id] = e.target.value.split(':') as [string, string]
              set({
                scope:
                  type === 'client'
                    ? { type: 'client', id }
                    : type === 'account'
                      ? { type: 'account', id }
                      : { type: 'all' },
              })
            }}
          >
            <option value="all">Todas las cuentas</option>
            <optgroup label="Clientes">
              {(clients.data ?? []).map((c) => (
                <option key={c.id} value={`client:${c.id}`}>
                  {c.title}
                </option>
              ))}
            </optgroup>
            <optgroup label="Cuentas">
              {accounts.map((x) => (
                <option key={x.id} value={`account:${x.id}`}>
                  {x.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="field-row">
          <MetricSelect
            id="al-metric"
            value={a.metric}
            defs={kit.defs}
            onChange={(metric) => set({ metric })}
          />
          <div className="field">
            <label htmlFor="al-op">Avisar si es</label>
            <select
              id="al-op"
              className="input"
              value={a.op}
              onChange={(e) => set({ op: e.target.value as Alert['op'] })}
            >
              <option value="gt">mayor que</option>
              <option value="lt">menor que</option>
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="al-threshold">Umbral</label>
            <input
              id="al-threshold"
              className="input num"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
            {value === null && (
              <p className="hint danger-text">Escribe un número, p. ej. 30 o 1,5.</p>
            )}
          </div>
          <div className="field">
            <label htmlFor="al-window">En los últimos</label>
            <select
              id="al-window"
              className="input"
              value={a.windowDays}
              onChange={(e) => set({ windowDays: Number(e.target.value) })}
            >
              {[1, 2, 3, 5, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '1 día' : `${d} días`}
                </option>
              ))}
            </select>
            <p className="hint">Días completos, sin contar hoy.</p>
          </div>
        </div>
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!a.name.trim() || value === null}
            onClick={() => onSave({ ...a, name: a.name.trim(), threshold: value ?? 0 })}
          >
            Guardar
          </button>
        </div>
      </div>
    </>
  )
}

/** Alertas: solo avisan dentro de la app (SPEC §1 y §7.13). */
export function Alerts() {
  const qc = useQueryClient()
  const toast = useToast()
  const kit = useMetricKit()
  const currency = useMetaStatus()?.settings.displayCurrency ?? 'EUR'
  const alerts = useQuery({ queryKey: KEY, queryFn: () => call('analysis:alerts') })
  const values = useQuery({
    queryKey: ['data', 'analysis', 'alert-values'],
    queryFn: () => call('analysis:alertValues'),
  })
  const events = useQuery({
    queryKey: ['data', 'analysis', 'events'],
    queryFn: () => call('analysis:events'),
  })
  const [editing, setEditing] = useState<Alert | 'new' | null>(null)
  const list = alerts.data ?? []
  const unseen = (events.data ?? []).some((e) => !e.seen)

  // Al ver los avisos, se marcan como vistos.
  useEffect(() => {
    if (unseen) void call('analysis:markSeen')
  }, [unseen])

  const save = (next: Alert[]) =>
    void call('analysis:setAlerts', { alerts: next })
      .then((a) => {
        qc.setQueryData(KEY, a)
        return qc.invalidateQueries({ queryKey: ['data', 'analysis'] })
      })
      .catch((e: unknown) =>
        toast.show(e instanceof IpcCallError ? e.message : 'No se pudo guardar.', 'error'),
      )

  return (
    <div className="meta-perf" data-testid="alerts">
      <p className="muted">
        Las alertas se comprueban después de cada sincronización con Meta y solo avisan dentro de la
        app: en la barra lateral, en Inicio y aquí.
      </p>
      <ul className="alert-list" data-testid="alert-list">
        {list.map((a) => {
          const d = kit.defs.get(a.metric)
          const v = values.data?.[a.id] ?? null
          const hit = v !== null && (a.op === 'gt' ? v > a.threshold : v < a.threshold)
          return (
            <li key={a.id} className="alert-item" data-hit={a.enabled && hit}>
              <label className="check">
                <input
                  type="checkbox"
                  checked={a.enabled}
                  aria-label={`Activar ${a.name}`}
                  onChange={(e) =>
                    save(list.map((x) => (x.id === a.id ? { ...x, enabled: e.target.checked } : x)))
                  }
                />
                <strong>{a.name}</strong>
              </label>
              <span className="muted">
                {d?.label ?? a.metric} {a.op === 'gt' ? '>' : '<'}{' '}
                {formatMetric(a.threshold, d, currency)} · últimos {a.windowDays}{' '}
                {a.windowDays === 1 ? 'día' : 'días'}
              </span>
              <span className={hit ? 'danger-text num' : 'faint num'}>
                ahora: {v === null ? '—' : formatMetric(v, d, currency)}
              </span>
              <span className="form-actions">
                <button type="button" className="btn" onClick={() => setEditing(a)}>
                  Editar
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => save(list.filter((x) => x.id !== a.id))}
                >
                  Borrar
                </button>
              </span>
            </li>
          )
        })}
        {list.length === 0 && (
          <li className="faint">
            Aún no hay alertas. Ejemplo: «CPA mayor que 30 en los últimos 3 días».
          </li>
        )}
      </ul>
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          + Alerta
        </button>
      </div>

      <h3 className="panel-subtitle">Avisos</h3>
      <ul className="event-list" data-testid="alert-events">
        {(events.data ?? []).map((e) => {
          const d = kit.defs.get(e.metric)
          return (
            <li key={e.id} data-seen={e.seen}>
              <span className="marker marker-error" aria-hidden="true" />
              <strong>{e.name}</strong>
              <span className="num">
                {d?.label ?? e.metric}: {formatMetric(e.value, d, currency)} (
                {e.op === 'gt' ? 'más de' : 'menos de'} {formatMetric(e.threshold, d, currency)})
              </span>
              <span className="faint num">
                del {isoToEs(e.since)} al {isoToEs(e.until)} ·{' '}
                {formatDateTime(new Date(e.createdAt))}
              </span>
            </li>
          )
        })}
        {events.data?.length === 0 && <li className="faint">Ningún aviso.</li>}
      </ul>

      {editing && (
        <AlertDialog
          alert={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            const exists = list.some((x) => x.id === a.id)
            save(exists ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a])
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}
