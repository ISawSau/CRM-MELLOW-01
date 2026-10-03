import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { PLATFORMS, type PlatformAccount } from '@shared/platforms'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { isoToEs } from '../meta/meta'
import { useClients } from '../tools/kit'
import { ImportCsv } from './ImportCsv'
import { LinkedInConnection } from './LinkedInConnection'
import { usePlatformAccounts } from './platforms'

type Tab = 'cuentas' | 'importar' | 'linkedin'

/** LinkedIn y X (SPEC §7.4, fase 11). */
export function PlatformsPage({ num }: { num: string }) {
  const accounts = usePlatformAccounts().data ?? []
  const [tab, setTab] = useState<Tab>(accounts.length ? 'cuentas' : 'importar')
  return (
    <div className="page page-wide" data-testid="page-plataformas">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">{num}</span> media buying
        </span>
        <h1 className="title">LinkedIn y X</h1>
        <p className="muted">
          Las cuentas de LinkedIn y X entran en Análisis, Facturación e Informes junto a las de
          Meta. LinkedIn se puede conectar por su API (gratis, con aprobación de LinkedIn) o con los
          CSV de Campaign Manager; X, con los CSV de X Ads (su API es de pago).
        </p>
      </div>
      <div className="tabs" role="tablist" aria-label="Otras plataformas">
        {(
          [
            ['cuentas', 'Cuentas'],
            ['importar', 'Importar CSV'],
            ['linkedin', 'API de LinkedIn'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-testid={`platforms-tab-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'cuentas' && <Accounts onImport={() => setTab('importar')} />}
      {tab === 'importar' && <ImportCsv onDone={() => setTab('cuentas')} />}
      {tab === 'linkedin' && <LinkedInConnection />}
    </div>
  )
}

function Accounts({ onImport }: { onImport: () => void }) {
  const q = usePlatformAccounts()
  const qc = useQueryClient()
  const toast = useToast()
  const clients = useClients()
  const [confirm, setConfirm] = useState<PlatformAccount | null>(null)
  const key = ['data', 'platforms', 'accounts']
  const run = (p: Promise<PlatformAccount[]>) =>
    p
      .then((list) => {
        qc.setQueryData(key, list)
        void qc.invalidateQueries({ queryKey: ['data'] })
      })
      .catch((e: unknown) =>
        toast.show(e instanceof IpcCallError ? e.message : 'No se pudo guardar.', 'error'),
      )
  const accounts = q.data ?? []
  if (!accounts.length)
    return (
      <div className="empty">
        <h2>Sin cuentas todavía</h2>
        <p className="muted">
          Importa un CSV de LinkedIn Campaign Manager o de X Ads, o conecta la API de LinkedIn.
        </p>
        <button type="button" className="btn btn-primary" onClick={onImport}>
          Importar un CSV
        </button>
      </div>
    )
  return (
    <>
      <div className="meta-table-scroll">
        <table className="meta-table" data-testid="platform-accounts">
          <thead>
            <tr>
              <th>Plataforma</th>
              <th>Cuenta</th>
              <th>Datos</th>
              <th>Cliente</th>
              <th>En Análisis</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  {PLATFORMS[a.platform]}
                  <span className="faint"> · {a.source === 'api' ? 'API' : 'CSV'}</span>
                </td>
                <td>
                  <strong>{a.name}</strong>
                  <span className="faint"> · {a.currency}</span>
                  {a.lastError && <div className="danger-text">{a.lastError}</div>}
                </td>
                <td className="num">
                  {a.dataFrom ? `${isoToEs(a.dataFrom)} – ${isoToEs(a.dataUntil)}` : '—'}
                </td>
                <td>
                  <select
                    className="input"
                    aria-label={`Cliente de ${a.name}`}
                    value={a.clientId ?? ''}
                    onChange={(e) =>
                      void run(
                        call('platforms:updateAccount', {
                          id: a.id,
                          clientId: e.target.value || null,
                        }),
                      )
                    }
                  >
                    <option value="">Sin cliente</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Usar ${a.name}`}
                    checked={a.enabled}
                    onChange={(e) =>
                      void run(
                        call('platforms:updateAccount', { id: a.id, enabled: e.target.checked }),
                      )
                    }
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Borrar ${a.name}`}
                    onClick={() => setConfirm(a)}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Las cuentas de la API de LinkedIn se descargan al activarlas y cada tres horas. Las de CSV
        se actualizan importando el archivo de nuevo (sustituye los días que trae).
      </p>
      {confirm && (
        <>
          <div className="overlay" onClick={() => setConfirm(null)} />
          <div className="dialog" role="dialog" aria-label="Borrar cuenta">
            <h2>¿Borrar «{confirm.name}»?</h2>
            <p className="muted">
              Se borran la cuenta y todas sus métricas de la bóveda. Si es de la API, volverá a
              aparecer al reconectar LinkedIn, sin activar.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  void run(call('platforms:deleteAccount', { id: confirm.id }))
                  setConfirm(null)
                }}
              >
                Borrar cuenta y datos
              </button>
              <button type="button" className="btn" onClick={() => setConfirm(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
