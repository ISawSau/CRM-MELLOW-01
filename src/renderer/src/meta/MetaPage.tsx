import { useState } from 'react'
import { formatDateTime } from '@shared/format'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'
import { MetaAccounts } from './MetaAccounts'
import { MetaCreatives } from './MetaCreatives'
import { MetaPerformance } from './MetaPerformance'
import { MetaSettingsPanel } from './MetaSettings'
import { useMetaStatus } from './meta'

const errorText = (e: unknown) => (e instanceof IpcCallError ? e.message : 'No se pudo completar.')

function ConnectForm() {
  const [token, setToken] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="meta-connect" data-testid="meta-connect">
      <h2>Conectar con Meta (solo lectura)</h2>
      <p className="muted">
        La app solo lee: nunca pausa anuncios ni cambia presupuestos. El token se guarda dentro de
        la base de datos cifrada de la bóveda.
      </p>
      <ol className="steps">
        <li>
          En <strong>developers.facebook.com</strong> crea una app de tipo{' '}
          <strong>Empresa (Business)</strong> vinculada a tu Business Manager (gratis).
        </li>
        <li>
          En <strong>Configuración del negocio → Usuarios → Usuarios del sistema</strong>, crea un
          usuario del sistema y asígnale las cuentas publicitarias con permiso para{' '}
          <strong>ver rendimiento</strong>.
        </li>
        <li>
          Pulsa <strong>Generar token</strong>, elige tu app, caducidad <strong>Nunca</strong> y
          marca solo el permiso <code>ads_read</code>.
        </li>
        <li>Copia el token y pégalo aquí.</li>
      </ol>
      <div className="field">
        <label htmlFor="meta-token">Token del usuario del sistema</label>
        <input
          id="meta-token"
          className="input mono"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="meta-secret">Clave secreta de la app (opcional)</label>
        <input
          id="meta-secret"
          className="input mono"
          type="password"
          autoComplete="off"
          value={appSecret}
          onChange={(e) => setAppSecret(e.target.value)}
        />
        <p className="hint">
          Solo si tu app tiene activado «Requerir la clave secreta de la app» (appsecret_proof).
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || token.trim().length < 20}
          onClick={() => {
            setBusy(true)
            setError(null)
            void call('meta:connect', { token: token.trim(), appSecret: appSecret.trim() })
              .then(() => {
                setToken('')
                setAppSecret('')
              })
              .catch((e: unknown) => setError(errorText(e)))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Comprobando…' : 'Conectar'}
        </button>
      </div>
    </div>
  )
}

type Tab = 'rendimiento' | 'creatividades' | 'cuentas' | 'ajustes'

/** Campañas: Meta en solo lectura (SPEC §7.3, fase 6). */
export function MetaPage({ num }: { num: string }) {
  const status = useMetaStatus()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('rendimiento')
  return (
    <div className="page page-wide" data-testid="page-campanas">
      <div className="section-head">
        <span className="eyebrow">
          <span className="num">{num}</span> media buying
        </span>
        <h1 className="title">Campañas</h1>
        <p className="muted">
          Cuentas publicitarias de Meta, en solo lectura.
          {status?.connected && status.user && <> Conectado como {status.user}.</>}
          {status?.lastSyncAt && (
            <> Última sincronización: {formatDateTime(new Date(status.lastSyncAt))}.</>
          )}
        </p>
      </div>
      {!status ? null : !status.connected ? (
        <ConnectForm />
      ) : (
        <>
          <div className="meta-bar">
            <div className="tabs" role="tablist" aria-label="Campañas">
              {(
                [
                  ['rendimiento', 'Rendimiento'],
                  ['creatividades', 'Creatividades'],
                  ['cuentas', 'Cuentas'],
                  ['ajustes', 'Ajustes'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  data-testid={`meta-tab-${id}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="meta-sync" data-testid="meta-sync-state">
              {status.progress ? (
                <>
                  <span className="muted">{status.progress.label}</span>
                  {status.progress.total > 1 && (
                    <span className="num faint">
                      {status.progress.done}/{status.progress.total}
                    </span>
                  )}
                </>
              ) : status.phase === 'syncing' ? (
                <span className="muted">Sincronizando…</span>
              ) : null}
              <button
                type="button"
                className="btn"
                disabled={status.phase === 'syncing'}
                data-testid="meta-sync-now"
                onClick={() =>
                  void call('meta:syncNow').catch((e: unknown) => toast.show(errorText(e), 'error'))
                }
              >
                Sincronizar ahora
              </button>
            </span>
          </div>
          {status.error && <Alert>{status.error}</Alert>}
          {tab === 'rendimiento' && <MetaPerformance onAccounts={() => setTab('cuentas')} />}
          {tab === 'creatividades' && <MetaCreatives />}
          {tab === 'cuentas' && <MetaAccounts />}
          {tab === 'ajustes' && <MetaSettingsPanel status={status} />}
        </>
      )}
    </div>
  )
}
