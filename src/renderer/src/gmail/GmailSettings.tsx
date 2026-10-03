import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { useGmailStatus } from './gmail'

/** Ajustes → Gmail: conectar en solo lectura con el proyecto de Google del usuario. */
export function GmailSettings() {
  const qc = useQueryClient()
  const s = useGmailStatus()
  const [open, setOpen] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (p: Promise<unknown>) => {
    setBusy(true)
    setError(null)
    void p
      .then(() => {
        setOpen(false)
        void qc.invalidateQueries({ queryKey: ['data', 'gmail'] })
      })
      .catch((e: unknown) => setError(e instanceof IpcCallError ? e.message : 'No se pudo.'))
      .finally(() => setBusy(false))
  }
  const ownClient = !s?.hasClient || clientId.trim() !== ''

  return (
    <section className="settings-block" data-testid="gmail-settings">
      <div>
        <h2>Gmail</h2>
        <p className="desc">
          Muestra en la ficha de cada cliente y contacto los hilos de correo con sus direcciones.
          Solo lectura: la app no envía, borra ni guarda correo.
        </p>
      </div>
      <div className="settings-body settings-body-wide">
        <div className="sync-state">
          <span
            className={`marker marker-${s?.connected ? (s.error ? 'error' : 'ok') : 'off'}`}
            aria-hidden="true"
          />
          <span>
            <strong>{s?.connected ? s.email || 'Gmail conectado' : 'Sin conectar'}</strong>
            {s?.connected && <span className="muted"> · solo lectura</span>}
          </span>
        </div>
        {s?.error && <Alert>{s.error}</Alert>}
        {error && <Alert>{error}</Alert>}
        <div className="form-actions">
          {s?.connected ? (
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(call('gmail:disconnect'))}
            >
              Desconectar Gmail
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setOpen((o) => !o)}>
              Conectar Gmail…
            </button>
          )}
        </div>
        {open && !s?.connected && (
          <div className="google-form">
            <ol className="steps">
              <li>
                En tu proyecto de <strong>console.cloud.google.com</strong> (el mismo de Google
                Drive, si lo usas), entra en <strong>APIs y servicios → Biblioteca</strong> y activa{' '}
                <strong>Gmail API</strong>.
              </li>
              <li>
                En <strong>Google Auth Platform → Data Access</strong> añade el permiso{' '}
                <code>…/auth/gmail.readonly</code> (leer el correo).
              </li>
              <li>
                En <strong>Audience</strong> la app debe estar publicada (en producción). Al
                conectar, Google avisará de que la app no está verificada: es tu propia app, así que
                pulsa <strong>Configuración avanzada → Ir a …</strong>. Para uso personal (menos de
                100 usuarios) Google no exige verificarla, y publicada el acceso no caduca cada 7
                días.
              </li>
              <li>
                {s?.hasClient
                  ? 'Se usará el mismo ID de cliente que Google Drive. Si prefieres otro, escríbelo abajo.'
                  : 'Copia aquí el ID de cliente (tipo app de escritorio) y, si lo hay, el secreto.'}
              </li>
              <li>
                Pulsa <strong>Conectar</strong>: se abrirá tu navegador para dar permiso.
              </li>
            </ol>
            <div className="field">
              <label htmlFor="gm-id">ID de cliente{s?.hasClient ? ' (opcional)' : ''}</label>
              <input
                id="gm-id"
                className="input mono"
                value={clientId}
                placeholder="1234…apps.googleusercontent.com"
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="gm-secret">Secreto de cliente</label>
              <input
                id="gm-secret"
                className="input mono"
                type="password"
                autoComplete="off"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
              <p className="hint">Se guarda dentro de la base de datos cifrada de la bóveda.</p>
            </div>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || (ownClient && clientId.trim().length < 10)}
                onClick={() => run(call('gmail:connect', { clientId, clientSecret }))}
              >
                {busy ? 'Esperando a Google…' : 'Conectar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
