import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatDateTime } from '@shared/format'
import { t, tn } from '@shared/i18n'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { isoToEs } from '../meta/meta'
import { useLinkedInStatus } from './platforms'

/** Conexión de solo lectura con la API de publicidad de LinkedIn. */
export function LinkedInConnection() {
  const qc = useQueryClient()
  const s = useLinkedInStatus().data
  const [mode, setMode] = useState<'oauth' | 'token'>('oauth')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = (p: Promise<unknown>) => {
    setBusy(true)
    setError(null)
    void p
      .then(() => qc.invalidateQueries({ queryKey: ['data'] }))
      .catch((e: unknown) => setError(e instanceof IpcCallError ? e.message : t('No se pudo.')))
      .finally(() => setBusy(false))
  }

  if (!s) return null
  return (
    <div className="tool" data-testid="linkedin-connection">
      <div className="sync-state">
        <span
          className={`marker marker-${s.connected ? (s.error ? 'error' : 'ok') : 'off'}`}
          aria-hidden="true"
        />
        <span>
          <strong>{s.connected ? t('LinkedIn conectado') : t('Sin conectar')}</strong>
          {s.connected && s.expiresAt && (
            <span className="muted">
              {' '}
              {t('· solo lectura · el acceso caduca el {date}', {
                date: isoToEs(s.expiresAt.slice(0, 10)),
              })}
              {s.daysLeft !== null && s.daysLeft >= 0
                ? ' ' + tn(s.daysLeft, '(queda {n} día)', '(quedan {n} días)')
                : ''}
            </span>
          )}
        </span>
      </div>
      {s.connected && s.daysLeft !== null && s.daysLeft >= 0 && s.daysLeft < 7 && (
        <Alert>
          {t(
            'LinkedIn da accesos de 60 días: vuelve a conectar antes de que caduque para no perder días.',
          )}
        </Alert>
      )}
      {(s.error || error) && <Alert>{error ?? s.error}</Alert>}
      {s.connected ? (
        <>
          <p className="muted">
            {s.phase === 'syncing'
              ? t('Descargando campañas y métricas…')
              : s.lastSyncAt
                ? t('Última sincronización: {date}.', {
                    date: formatDateTime(new Date(s.lastSyncAt)),
                  })
                : t('Activa las cuentas en la pestaña Cuentas para empezar a descargar.')}
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || s.phase === 'syncing'}
              onClick={() => run(call('linkedin:sync'))}
            >
              {t('Sincronizar ahora')}
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() => run(call('linkedin:disconnect'))}
            >
              {t('Desconectar')}
            </button>
          </div>
        </>
      ) : (
        <div className="google-form">
          <ol className="steps">
            <li>
              {t('En')} <strong>linkedin.com/developers</strong>{' '}
              {t('crea una app (gratis) asociada a la página de tu empresa.')}
            </li>
            <li>
              {t('En')} <strong>Products</strong> {t('solicita')} <strong>Advertising API</strong>.{' '}
              {t(
                'LinkedIn revisa la solicitud; con el nivel de desarrollo ya puedes leer las cuentas que administras.',
              )}
            </li>
            <li>
              {t('En')} <strong>Auth</strong> {t('añade la dirección de vuelta')}{' '}
              <code>http://localhost:53135/linkedin</code>{' '}
              {t('y copia el ID y el secreto de cliente. La app solo pide')} <code>r_ads</code>{' '}
              {t('y')} <code>r_ads_reporting</code> {t('(lectura).')}
            </li>
            <li>
              {t(
                'LinkedIn da accesos de 60 días: cuando caduque, vuelve a conectar. Mientras tanto (o sin aprobación) puedes importar los CSV de Campaign Manager.',
              )}
            </li>
          </ol>
          <div className="segmented" role="group" aria-label={t('Cómo conectar')}>
            <button type="button" aria-pressed={mode === 'oauth'} onClick={() => setMode('oauth')}>
              {t('Iniciar sesión')}
            </button>
            <button type="button" aria-pressed={mode === 'token'} onClick={() => setMode('token')}>
              {t('Pegar un token')}
            </button>
          </div>
          {mode === 'oauth' ? (
            <>
              <div className="field">
                <label htmlFor="li-id">{t('ID de cliente')}</label>
                <input
                  id="li-id"
                  className="input mono"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="li-secret">{t('Secreto de cliente')}</label>
                <input
                  id="li-secret"
                  className="input mono"
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
                <p className="hint">
                  {t('Se guarda dentro de la base de datos cifrada de la bóveda.')}
                </p>
              </div>
            </>
          ) : (
            <div className="field">
              <label htmlFor="li-token">{t('Token de acceso')}</label>
              <input
                id="li-token"
                className="input mono"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <p className="hint">
                {t('Genéralo en el portal de desarrolladores (OAuth token tools) con los permisos')}{' '}
                <code>r_ads</code> {t('y')} <code>r_ads_reporting</code>. {t('Dura 60 días.')}
              </p>
            </div>
          )}
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                busy ||
                (mode === 'oauth'
                  ? clientId.trim().length < 4 || clientSecret.trim().length < 4
                  : token.trim().length < 10)
              }
              onClick={() =>
                run(
                  call(
                    'linkedin:connect',
                    mode === 'oauth' ? { clientId, clientSecret, token: '' } : { token },
                  ),
                )
              }
            >
              {busy ? t('Conectando…') : t('Conectar')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
