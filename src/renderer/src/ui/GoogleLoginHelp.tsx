import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { GoogleLoginStatus } from '@shared/google'
import { t } from '@shared/i18n'
import { useAction } from '../lib/hooks'
import { call, subscribe } from '../lib/ipc'
import { Alert } from './Alert'

const KEY = ['google', 'login']

/**
 * Ayuda mientras se espera a Google (D-118): volver a abrir la página de Google y, si el
 * navegador no consigue volver a la app, pegar la dirección a la que Google le ha llevado
 * (la de la barra del navegador, http://127.0.0.1:…). Solo se ve con un inicio de sesión
 * en curso.
 */
export function GoogleLoginHelp() {
  const qc = useQueryClient()
  const login = useQuery({
    queryKey: KEY,
    queryFn: () => call('google:login'),
    refetchOnMount: 'always',
    // Por si se pierde un evento (la app de Android vuelve de segundo plano).
    refetchInterval: 2_000,
  })
  useEffect(
    () => subscribe('google:changed', (s: GoogleLoginStatus) => qc.setQueryData(KEY, s)),
    [qc],
  )
  const [url, setUrl] = useState('')
  const paste = useAction(async () => {
    qc.setQueryData(KEY, await call('google:paste', { url }))
    setUrl('')
  })
  const s = login.isFetchedAfterMount ? login.data : undefined
  if (!s?.pending) return null
  const submit = () => {
    if (url.trim() && !paste.pending) void paste.run()
  }
  return (
    <div className="google-help" data-testid="google-help">
      {s.authUrl && (
        <a className="btn" href={s.authUrl} target="_blank" rel="noreferrer">
          {t('Abrir otra vez la página de Google')}
        </a>
      )}
      <details>
        <summary>{t('¿El navegador no vuelve a CRM Mellow?')}</summary>
        <p className="muted">
          {t(
            'Al terminar en Google, el navegador va a una dirección que empieza por http://127.0.0.1 (puede que diga que no se puede abrir la página). Cópiala entera de la barra de direcciones y pégala aquí.',
          )}
        </p>
        <div className="google-help-paste">
          <input
            className="input mono"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            aria-label={t('Dirección del navegador')}
            placeholder="http://127.0.0.1:…/?state=…&code=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            data-testid="google-paste"
          />
          <button
            type="button"
            className="btn"
            disabled={!url.trim() || paste.pending}
            onClick={submit}
            data-testid="google-paste-submit"
          >
            {t('Usar esta dirección')}
          </button>
        </div>
        {paste.error && <Alert>{paste.error.message}</Alert>}
      </details>
    </div>
  )
}
