import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import {
  ACCOUNT_STATUS_LABELS,
  BREAKDOWN_KEYS,
  BREAKDOWNS,
  PERF_LEVELS,
  type AdAccountInfo,
  type BreakdownConfig,
} from '@shared/meta'
import { formatDateTime } from '@shared/format'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { isoToEs, useMetaAccounts } from './meta'

const errorText = (e: unknown) => (e instanceof IpcCallError ? e.message : 'No se pudo completar.')

function useClients() {
  return useQuery({
    queryKey: ['data', 'meta', 'clients'],
    queryFn: () => call('data:query', { entity: 'cliente' }),
  })
}

const LEVEL_LABELS = { campaign: 'Campañas', adset: 'Conjuntos', ad: 'Anuncios' } as const

/** Desgloses por nivel: cada uno multiplica el volumen y el tiempo de sincronización. */
function Breakdowns({ a }: { a: AdAccountInfo }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [cfg, setCfg] = useState<BreakdownConfig>(a.breakdowns)
  const [open, setOpen] = useState(false)
  const active = PERF_LEVELS.reduce((n, l) => n + a.breakdowns[l].length, 0)
  const changed = JSON.stringify(cfg) !== JSON.stringify(a.breakdowns)
  return (
    <details
      className="breakdowns"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>Desgloses{active ? ` (${active})` : ''}</summary>
      <p className="hint">
        Edad, sexo, país, plataforma, ubicación o dispositivo. Cada desglose multiplica el volumen
        de datos y el tiempo de sincronización: actívalos solo donde los vayas a mirar. Al
        activarlos se descargan también para todo el histórico.
      </p>
      <table className="breakdown-grid">
        <thead>
          <tr>
            <th />
            {BREAKDOWN_KEYS.map((b) => (
              <th key={b}>{BREAKDOWNS[b].label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERF_LEVELS.map((level) => (
            <tr key={level}>
              <th scope="row">{LEVEL_LABELS[level]}</th>
              {BREAKDOWN_KEYS.map((b) => (
                <td key={b}>
                  <input
                    type="checkbox"
                    aria-label={`${BREAKDOWNS[b].label} en ${LEVEL_LABELS[level].toLowerCase()}`}
                    checked={cfg[level].includes(b)}
                    onChange={(e) =>
                      setCfg({
                        ...cfg,
                        [level]: e.target.checked
                          ? [...cfg[level], b]
                          : cfg[level].filter((x) => x !== b),
                      })
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          disabled={!changed}
          onClick={() =>
            void call('meta:setBreakdowns', { id: a.id, config: cfg })
              .then((list) => {
                qc.setQueryData(['data', 'meta', 'accounts'], list)
                toast.show('Desgloses guardados.')
              })
              .catch((e: unknown) => toast.show(errorText(e), 'error'))
          }
        >
          Guardar desgloses
        </button>
      </div>
    </details>
  )
}

function AccountRow({
  a,
  clients,
  onUpdate,
}: {
  a: AdAccountInfo
  clients: { id: string; title: string }[]
  onUpdate: (patch: { enabled?: boolean; clientId?: string | null }) => void
}) {
  const toast = useToast()
  const pct = a.history ? Math.round((a.history.done / Math.max(1, a.history.total)) * 100) : 0
  return (
    <li className="account-item" data-testid="meta-account" data-enabled={a.enabled}>
      <div className="account-main">
        <label className="check">
          <input
            type="checkbox"
            checked={a.enabled}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            aria-label={`Sincronizar ${a.name}`}
          />
          <span>
            <strong>{a.name}</strong>
            <span className="faint mono"> {a.id.replace('act_', '')}</span>
          </span>
        </label>
        <span className="faint">
          {[
            a.currency,
            a.timezone,
            a.status !== null ? (ACCOUNT_STATUS_LABELS[a.status] ?? `estado ${a.status}`) : null,
            a.business,
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <div className="field account-client">
        <label htmlFor={`client-${a.id}`}>Cliente</label>
        <select
          id={`client-${a.id}`}
          className="input"
          value={a.clientId ?? ''}
          onChange={(e) => onUpdate({ clientId: e.target.value || null })}
        >
          <option value="">Sin asignar</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>
      {a.enabled && (
        <div className="account-sync">
          <span className="muted">
            {a.dataFrom
              ? `Datos del ${isoToEs(a.dataFrom)} al ${isoToEs(a.dataUntil)}`
              : 'Aún sin datos'}
            {a.lastSyncAt && ` · sincronizada ${formatDateTime(new Date(a.lastSyncAt))}`}
          </span>
          {a.history && (
            <span className="account-history" data-testid="meta-history">
              <span className="bar" aria-hidden="true">
                <span className="bar-fill" data-color="azul" style={{ width: `${pct}%` }} />
              </span>
              <span className="faint num">
                Histórico: {a.history.done} de {a.history.total} trozos
              </span>
            </span>
          )}
          {a.historyDone && <span className="faint">Histórico completo</span>}
          {a.history && a.history.failed > 0 && (
            <button
              type="button"
              className="btn"
              onClick={() =>
                void call('meta:retryHistory', { id: a.id }).catch((e: unknown) =>
                  toast.show(errorText(e), 'error'),
                )
              }
            >
              Reintentar {a.history.failed} trozos fallidos
            </button>
          )}
          {a.lastError && <span className="danger-text">{a.lastError}</span>}
          <Breakdowns a={a} />
        </div>
      )}
    </li>
  )
}

export function MetaAccounts() {
  const qc = useQueryClient()
  const toast = useToast()
  const accounts = useMetaAccounts()
  const clients = useClients()
  const [confirm, setConfirm] = useState(false)
  // Solo se aplica la respuesta del último cambio (las anteriores llegarían viejas).
  const seq = useRef(0)
  const set = (data: AdAccountInfo[]) => qc.setQueryData(['data', 'meta', 'accounts'], data)
  const list = accounts.data ?? []
  return (
    <div className="meta-accounts">
      <p className="muted">
        Elige qué cuentas sincronizar y asígnalas a un cliente. Al activar una cuenta se descargan
        los últimos 30 días y después, en segundo plano, todo el histórico que permite Meta (37
        meses). Si cierras la app, sigue donde lo dejó.
      </p>
      <ul className="account-list" data-testid="meta-accounts">
        {list.map((a) => (
          <AccountRow
            key={a.id}
            a={a}
            clients={(clients.data ?? []).map((c) => ({ id: c.id, title: c.title }))}
            onUpdate={(patch) => {
              // Se ve al momento; si falla, se vuelve a leer la lista.
              // Una recarga en curso traería la lista de antes de este cambio.
              void qc.cancelQueries({ queryKey: ['data', 'meta', 'accounts'] })
              set(list.map((x) => (x.id === a.id ? { ...x, ...patch } : x)))
              const n = ++seq.current
              void call('meta:updateAccount', { id: a.id, ...patch })
                .then((data) => {
                  if (n === seq.current) set(data)
                })
                .catch((e: unknown) => {
                  void qc.invalidateQueries({ queryKey: ['data', 'meta', 'accounts'] })
                  toast.show(errorText(e), 'error')
                })
            }}
          />
        ))}
        {list.length === 0 && (
          <li className="faint">
            El token no da acceso a ninguna cuenta. Asígnalas al usuario del sistema en el Business
            Manager.
          </li>
        )}
      </ul>
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            void call('meta:refreshAccounts')
              .then(set)
              .catch((e: unknown) => toast.show(errorText(e), 'error'))
          }
        >
          Actualizar la lista de cuentas
        </button>
        <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
          Desconectar
        </button>
      </div>
      {confirm && (
        <>
          <div className="overlay" onClick={() => setConfirm(false)} />
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="meta-off">
            <h2 id="meta-off">¿Desconectar Meta?</h2>
            <p className="muted">
              Se borra el token de la bóveda y se deja de sincronizar. Los datos ya descargados se
              quedan y puedes volver a conectar cuando quieras.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => setConfirm(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  setConfirm(false)
                  void call('meta:disconnect').catch((e: unknown) =>
                    toast.show(errorText(e), 'error'),
                  )
                }}
              >
                Desconectar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
