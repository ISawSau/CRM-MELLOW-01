import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { BackupEntry } from '@shared/ipc'
import { formatBytes } from '@shared/files'
import { formatDateTime } from '@shared/format'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useToast } from '../ui/Toast'
import { syncSummary, useSyncStatus } from './sync'

const REASONS: Record<string, string> = {
  automatica: 'Automática',
  manual: 'Manual',
  'antes-de-sincronizar': 'Antes de sincronizar',
  'antes-de-restaurar': 'Antes de restaurar',
  'antes-de-rotar-clave': 'Antes de rotar la clave',
  'conflicto-nube': 'Versión de la nube (conflicto)',
}

function reasonLabel(r: string): string {
  if (REASONS[r]) return REASONS[r]
  if (r.startsWith('antes-de-migrar')) return 'Antes de actualizar la app'
  if (r.startsWith('automatica')) return 'Automática'
  return r
}

function errorText(e: unknown): string {
  return e instanceof IpcCallError ? e.message : 'No se pudo completar.'
}

function GoogleForm({ onDone }: { onDone: () => void }) {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="google-form">
      <ol className="steps">
        <li>
          Entra en <strong>console.cloud.google.com</strong> con tu cuenta de Google y crea un
          proyecto (gratis), por ejemplo «CRM Mellow».
        </li>
        <li>
          En <strong>APIs y servicios → Biblioteca</strong>, busca y activa{' '}
          <strong>Google Drive API</strong>.
        </li>
        <li>
          Abre <strong>Google Auth Platform</strong>: en <strong>Branding</strong> pon un nombre y
          tu email; en <strong>Audience</strong> elige <strong>External</strong> (externo); en{' '}
          <strong>Data Access</strong> añade el permiso <code>…/auth/drive.file</code>.
        </li>
        <li>
          En <strong>Audience</strong>, pulsa <strong>Publish app</strong> (publicar, en
          producción). Con solo ese permiso Google no pide verificación y el acceso no caduca cada 7
          días, como pasa en modo de pruebas.
        </li>
        <li>
          En <strong>Clients → Create client</strong>, tipo <strong>Desktop app</strong> (app de
          escritorio). Copia aquí el ID de cliente y, si Google te lo muestra, el secreto.
        </li>
        <li>
          Pulsa <strong>Conectar</strong>: se abrirá tu navegador para dar permiso. La app solo
          podrá ver los archivos que ella misma cree en tu Drive.
        </li>
      </ol>
      <div className="field">
        <label htmlFor="g-id">ID de cliente</label>
        <input
          id="g-id"
          className="input mono"
          value={clientId}
          placeholder="1234…apps.googleusercontent.com"
          onChange={(e) => setClientId(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="g-secret">Secreto de cliente</label>
        <input
          id="g-secret"
          className="input mono"
          type="password"
          autoComplete="off"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
        <p className="hint">Se guarda dentro de la base de datos cifrada de la bóveda.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || clientId.trim().length < 10}
          onClick={() => {
            setBusy(true)
            setError(null)
            void call('sync:connectDrive', { clientId, clientSecret })
              .then(onDone)
              .catch((e: unknown) => setError(errorText(e)))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Esperando a Google…' : 'Conectar'}
        </button>
      </div>
    </div>
  )
}

function Backups() {
  const qc = useQueryClient()
  const toast = useToast()
  const list = useQuery({ queryKey: ['backups'], queryFn: () => call('backups:list') })
  const cfg = useQuery({ queryKey: ['backups-config'], queryFn: () => call('backups:config') })
  const [confirm, setConfirm] = useState<BackupEntry | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['backups'] })
  const setCfg = (patch: Partial<NonNullable<typeof cfg.data>>) => {
    if (!cfg.data) return
    void call('backups:setConfig', { ...cfg.data, ...patch })
      .then(() => qc.invalidateQueries({ queryKey: ['backups-config'] }))
      .catch((e: unknown) => toast.show(errorText(e), 'error'))
  }
  return (
    <>
      {cfg.data && (
        <div className="field-row">
          <div className="field">
            <label htmlFor="bk-days">Copia automática cada</label>
            <select
              id="bk-days"
              className="input"
              value={cfg.data.intervalDays}
              onChange={(e) => setCfg({ intervalDays: Number(e.target.value) })}
            >
              {[1, 2, 3, 5, 7, 14, 30].map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '1 día' : `${d} días`}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bk-keep">Conservar las últimas</label>
            <select
              id="bk-keep"
              className="input"
              value={cfg.data.keepLast}
              onChange={(e) => setCfg({ keepLast: Number(e.target.value) })}
            >
              {[3, 5, 10, 20, 30].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {cfg.data && (
        <label className="check">
          <input
            type="checkbox"
            checked={cfg.data.keepMonthly}
            onChange={(e) => setCfg({ keepMonthly: e.target.checked })}
          />
          <span>Y además una por mes</span>
        </label>
      )}
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          data-testid="backup-now"
          onClick={() =>
            void call('backups:create')
              .then(() => {
                toast.show('Copia de seguridad hecha.')
                return refresh()
              })
              .catch((e: unknown) => toast.show(errorText(e), 'error'))
          }
        >
          Hacer una copia ahora
        </button>
      </div>
      <ul className="backup-list" data-testid="backup-list">
        {(list.data ?? []).map((b) => (
          <li key={b.name} className="backup-item">
            <span className="num">{formatDateTime(new Date(b.date))}</span>
            <span className="muted">{reasonLabel(b.reason)}</span>
            <span className="faint num">{b.size !== null ? formatBytes(b.size) : '—'}</span>
            <span className="faint">
              {[b.local ? 'aquí' : null, b.remote ? 'en el destino' : null]
                .filter(Boolean)
                .join(' y ')}
            </span>
            <button type="button" className="btn" onClick={() => setConfirm(b)}>
              Restaurar
            </button>
          </li>
        ))}
        {list.data?.length === 0 && <li className="faint">Aún no hay copias.</li>}
      </ul>
      {confirm && (
        <>
          <div className="overlay" onClick={() => setConfirm(null)} />
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="restore-t">
            <h2 id="restore-t">¿Restaurar esta copia?</h2>
            <p className="muted">
              La bóveda volverá al {formatDateTime(new Date(confirm.date))}. Lo de ahora se guarda
              antes como copia, así que no pierdes nada. Si la copia es de una contraseña anterior,
              la bóveda se bloqueará y tendrás que entrar con aquella contraseña.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                autoFocus
                onClick={() => setConfirm(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                data-testid="confirm-restore"
                onClick={() => {
                  const name = confirm.name
                  setConfirm(null)
                  void call('backups:restore', { name })
                    .then((r) => {
                      toast.show(
                        r === 'reopened'
                          ? 'Copia restaurada.'
                          : 'Copia restaurada: entra con su contraseña.',
                      )
                      return qc.invalidateQueries()
                    })
                    .catch((e: unknown) => toast.show(errorText(e), 'error'))
                }}
              >
                Restaurar
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

/** Ajustes → Sincronización y copias (SPEC §4). */
export function SyncSettings() {
  const s = useSyncStatus()
  const toast = useToast()
  const [google, setGoogle] = useState(false)
  const summary = syncSummary(s)
  const run = (p: Promise<unknown>) =>
    void p.catch((e: unknown) => toast.show(errorText(e), 'error'))
  return (
    <section className="settings-block" data-testid="sync-settings">
      <div>
        <h2>Sincronización y copias</h2>
        <p className="desc">
          Para usar la bóveda en varios equipos. Todo se sube ya cifrado: ni Google ni nadie ve tus
          datos. Se sincroniza al abrir, al bloquear o cerrar, cada media hora si hay cambios y con
          el botón de la barra de estado.
        </p>
      </div>
      <div className="settings-body settings-body-wide">
        <div className="sync-state">
          <span className={`marker marker-${summary.tone}`} aria-hidden="true" />
          <span>
            <strong>{s?.kind ? s.label : 'Sin destino'}</strong>
            <span className="muted"> · {summary.text}</span>
          </span>
        </div>
        {s?.error && <Alert>{s.error}</Alert>}
        <div className="form-actions">
          {s?.kind ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => run(call('sync:now'))}
              >
                Sincronizar ahora
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => run(call('sync:disconnect'))}
              >
                Desconectar
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => setGoogle((g) => !g)}>
                Conectar Google Drive…
              </button>
              <button
                type="button"
                className="btn"
                data-testid="sync-folder"
                onClick={() => run(call('sync:pickFolder'))}
              >
                Usar una carpeta…
              </button>
            </>
          )}
        </div>
        {!s?.kind && (
          <p className="hint">
            «Usar una carpeta» sirve para un USB, un disco de red o una carpeta que ya sincroniza
            otro programa.
          </p>
        )}
        {google && !s?.kind && <GoogleForm onDone={() => setGoogle(false)} />}
        <h3 className="panel-subtitle">Copias de seguridad</h3>
        <Backups />
      </div>
    </section>
  )
}
