import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FetchLike } from './remote'
import { AppError } from '@shared/errors'
import type { GoogleLoginStatus } from '@shared/google'
import { getLocale, t } from '@shared/i18n'

/**
 * OAuth 2.0 para apps de escritorio (documentación oficial de Google, «OAuth 2.0 for
 * Desktop Apps»): redirección a una dirección de bucle local http://127.0.0.1:puerto,
 * PKCE con S256 y el permiso mínimo `drive.file`.
 *
 * El id de cliente y su secreto los crea el usuario en su propio proyecto de Google
 * Cloud (gratis) y se guardan en la base de datos cifrada, nunca en el código.
 */

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
/** Solo lectura del correo (fase 10, D-078). */
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
/**
 * Tiempo para iniciar sesión en el navegador (elegir cuenta, segundo paso de verificación…).
 */
const LOGIN_TIMEOUT_MS = 10 * 60_000
/**
 * Android 15 corta la red a las apps en segundo plano (cambio para todas las apps): si el
 * canje del código falla por la red, se repite un rato (D-117). Con el servicio en primer
 * plano de Android (D-118) no debería hacer falta, pero queda como red de seguridad.
 */
const EXCHANGE_RETRY_MS = 3 * 60_000
const EXCHANGE_RETRY_DELAY_MS = 2_000
/** Cada intento de canje: una red que no contesta no puede dejarlo colgado. */
const EXCHANGE_TIMEOUT_MS = 20_000
const REFRESH_TIMEOUT_MS = 30_000

export interface GoogleClient {
  clientId: string
  clientSecret: string
}

export interface GoogleTokens {
  refreshToken: string
  accessToken: string
  /** Momento (ms) en que caduca el token de acceso. */
  expiresAt: number
}

const b64url = (b: Buffer) => b.toString('base64url')

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const PAGE = (
  title: string,
  text: string,
  back: string | null,
) => `<!doctype html><html lang="${getLocale()}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><body style="font-family:sans-serif;background:#0d0908;color:#fdf6ee;display:grid;place-items:center;min-height:100vh;margin:0;padding:0 16px">
<div style="max-width:420px"><h1 style="font-size:20px">${esc(title)}</h1><p>${esc(text)}</p>${
  back
    ? `<p><a href="${esc(back)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#f2a65a;color:#0d0908;font-weight:600;text-decoration:none">${esc(t('Volver a CRM Mellow'))}</a></p>`
    : ''
}</div></body></html>`

/**
 * Los fallos al conectar con Google llegan a la interfaz con su mensaje (D-115): un
 * `Error` corriente se mostraría solo como «Ha ocurrido un error inesperado».
 */
export function asGoogleError(e: unknown): AppError {
  if (e instanceof AppError) return e
  const detail = describeNetError(e)
  const code = (e as { cause?: { code?: unknown } } | null)?.cause?.code
  const offline =
    typeof code === 'string' && OFFLINE_CODES.has(code)
      ? t(
          'No se ha podido llegar a Google. Comprueba la conexión a internet y que CRM Mellow tiene permiso para usar la red (en GrapheneOS: Ajustes → Apps → CRM Mellow → Permisos → Red).',
        )
      : ''
  return new AppError(
    'GOOGLE_ERROR',
    undefined,
    [offline, detail].filter(Boolean).join(' ') || undefined,
  )
}

/** Fallos de red de `fetch` que significan «sin conexión» (sin DNS, sin ruta, rechazada…). */
const OFFLINE_CODES = new Set([
  'ENOTFOUND',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
])

/**
 * Mensaje de un fallo con su causa: `fetch` solo dice «fetch failed» y el motivo real
 * (sin DNS, conexión rechazada, certificado…) va en `cause` (D-116).
 */
export function describeNetError(e: unknown): string {
  if (!(e instanceof Error)) return e === undefined || e === null ? '' : String(e)
  const cause = (e as { cause?: unknown }).cause
  if (!(cause instanceof Error)) return e.message
  const code = (cause as { code?: unknown }).code
  const prefix = typeof code === 'string' && !cause.message.includes(code) ? code : ''
  const detail = [prefix, cause.message].filter(Boolean).join(': ')
  return detail && !e.message.includes(detail) ? `${e.message} (${detail})` : e.message
}

/**
 * Limpia el id y el secreto pegados (un teclado de móvil puede meter espacios al
 * autocorregir) y comprueba que el id tiene la forma de los de Google. Con un id mal
 * copiado Google solo responde «Error 401: invalid_client» en el navegador (D-112).
 */
export function cleanGoogleClient(client: GoogleClient): GoogleClient {
  const clientId = client.clientId.replace(/\s+/g, '')
  if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(clientId))
    throw new AppError(
      'GOOGLE_ERROR',
      undefined,
      t(
        'El id de cliente de Google no es válido: tiene que terminar en .apps.googleusercontent.com. Cópialo otra vez desde Google Cloud → Credenciales, del cliente de tipo «Aplicación de escritorio».',
      ),
    )
  return { clientId, clientSecret: client.clientSecret.replace(/\s+/g, '') }
}

const cancelled = () => new AppError('GOOGLE_ERROR', undefined, t('Has cancelado la conexión.'))

/**
 * Parámetros de la respuesta de Google en una dirección pegada por el usuario: la de la
 * barra del navegador (http://127.0.0.1:puerto/?code=…&state=…) o solo su parte final.
 * Null si no lleva ni código ni error.
 */
export function pastedParams(raw: string): URLSearchParams | null {
  const s = raw.trim()
  let params: URLSearchParams
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      const url = new URL(s)
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        return null
      params = url.searchParams
    } else {
      params = new URLSearchParams(s.includes('?') ? s.slice(s.indexOf('?') + 1) : s)
    }
  } catch {
    return null
  }
  return params.has('code') || params.has('error') ? params : null
}

interface PendingLogin {
  authUrl: string
  /** Respuesta de Google. Devuelve un mensaje si la dirección pegada no vale. */
  receive: (params: URLSearchParams, pasted: boolean) => string | null
  cancel: () => void
}

export interface GoogleLoginsOptions {
  /**
   * Mantiene viva la app mientras dura la conexión. En Android, un servicio en primer plano:
   * sin él, el sistema congela la app a los 10 s de pasar al navegador y le corta la red
   * (D-118). Devuelve la función que lo suelta.
   */
  hold?: (text: string) => () => void
  /** Enlace para volver a la app desde la página del navegador (Android). */
  returnUrl?: string | null
  onChange?: (status: GoogleLoginStatus) => void
}

/**
 * El inicio de sesión con Google en curso (D-118), uno a la vez. Si el navegador no
 * consigue volver a la app, el usuario pega aquí la dirección a la que Google le ha
 * llevado; también se puede cancelar o volver a abrir el navegador.
 */
export class GoogleLogins {
  private current: PendingLogin | null = null

  constructor(readonly options: GoogleLoginsOptions = {}) {}

  status(): GoogleLoginStatus {
    return { pending: this.current !== null, authUrl: this.current?.authUrl ?? null }
  }

  private emit(): void {
    this.options.onChange?.(this.status())
  }

  /** Lo usa connectGoogle. Un inicio de sesión nuevo cancela el anterior. */
  begin(login: PendingLogin): () => void {
    this.current?.cancel()
    this.current = login
    this.emit()
    return () => {
      if (this.current !== login) return
      this.current = null
      this.emit()
    }
  }

  paste(raw: string): GoogleLoginStatus {
    const login = this.current
    if (!login)
      throw new AppError(
        'INVALID_INPUT',
        undefined,
        t('No hay ninguna conexión con Google esperando respuesta. Vuelve a empezar.'),
      )
    const params = pastedParams(raw)
    if (!params)
      throw new AppError(
        'INVALID_INPUT',
        undefined,
        t(
          'Esa dirección no lleva la respuesta de Google. Copia la dirección completa de la barra del navegador, la que empieza por http://127.0.0.1',
        ),
      )
    const problem = login.receive(params, true)
    if (problem) throw new AppError('INVALID_INPUT', undefined, problem)
    return this.status()
  }

  cancel(): GoogleLoginStatus {
    this.current?.cancel()
    return this.status()
  }
}

export interface ConnectOptions {
  scope?: string
  authUrl?: string
  tokenUrl?: string
  /** Tiempo para iniciar sesión (por defecto 10 minutos). */
  timeoutMs?: number
  retryMs?: number
  retryDelayMs?: number
  logins?: GoogleLogins
  /** Google ha devuelto el código: empieza el canje. */
  onCode?: () => void
  signal?: AbortSignal
}

/** Mensaje claro para los errores del canje (documentación de OAuth 2.0 de Google). */
function tokenError(json: { error?: string; error_description?: string }): string {
  switch (json.error) {
    case 'invalid_client':
      return t(
        'Google no reconoce el id o el secreto del cliente. Cópialos otra vez desde Google Cloud → Credenciales (cliente de tipo «Aplicación de escritorio»).',
      )
    case 'invalid_grant':
      return t(
        'Google ha rechazado el código de acceso (caduca en pocos minutos y solo vale una vez). Vuelve a intentarlo.',
      )
    case 'unauthorized_client':
      return t(
        'Este cliente de Google no se puede usar así: tiene que ser de tipo «Aplicación de escritorio».',
      )
    default:
      return json.error_description ?? json.error ?? t('Google no ha dado acceso.')
  }
}

/**
 * Abre el navegador del sistema para conectar con Google y espera la respuesta en
 * un puerto local (o pegada por el usuario, D-118). Devuelve los tokens.
 */
export async function connectGoogle(
  client: GoogleClient,
  openBrowser: (url: string) => void,
  http: FetchLike = fetch,
  opts: ConnectOptions = {},
): Promise<GoogleTokens> {
  client = cleanGoogleClient(client)
  if (opts.signal?.aborted) throw cancelled()
  const release = opts.logins?.options.hold?.(t('Conectando con Google…')) ?? (() => {})
  try {
    return await login(client, openBrowser, http, opts)
  } finally {
    release()
  }
}

async function login(
  client: GoogleClient,
  openBrowser: (url: string) => void,
  http: FetchLike,
  opts: ConnectOptions,
): Promise<GoogleTokens> {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))
  const back = opts.logins?.options.returnUrl ?? null

  const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    let server: Server | null = null
    let redirect = ''
    let settled = false
    let succeeded = false
    let end = () => {}
    const finish = (error: AppError | null, got = '') => {
      if (settled) return
      settled = true
      succeeded = !error
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      server?.close()
      end()
      if (error) reject(error)
      else resolve({ code: got, redirect })
    }
    const timer = setTimeout(
      () =>
        finish(
          new AppError(
            'GOOGLE_ERROR',
            undefined,
            t(
              'Se agotó el tiempo para conectar con Google. Si Google mostró un error en el navegador (por ejemplo «invalid_client»), revisa el id de cliente.',
            ),
          ),
        ),
      opts.timeoutMs ?? LOGIN_TIMEOUT_MS,
    )
    const onAbort = () => finish(cancelled())
    opts.signal?.addEventListener('abort', onAbort)

    /** Respuesta de Google, del navegador o pegada por el usuario. */
    const receive = (params: URLSearchParams, pasted: boolean): string | null => {
      if (settled) return t('Esta conexión con Google ya ha terminado.')
      const error = params.get('error')
      const got = params.get('code')
      if (error) {
        finish(
          new AppError(
            'GOOGLE_ERROR',
            undefined,
            error === 'access_denied'
              ? t('Has cancelado la conexión.')
              : t('Google ha respondido con un error: {error}.', { error }),
          ),
        )
        return null
      }
      if (!got || params.get('state') !== state) {
        // Pegada: puede ser de un intento anterior; se sigue esperando la buena.
        if (pasted)
          return t(
            'Esa dirección es de otro intento de conexión. Copia la de este intento o vuelve a empezar.',
          )
        finish(new AppError('GOOGLE_ERROR', undefined, t('Respuesta de Google no válida.')))
        return null
      }
      finish(null, got)
      return null
    }

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      // Si ya había terminado (dirección pegada antes, o cancelado), se dice cómo acabó.
      if (!settled) receive(url.searchParams, false)
      const ok =
        succeeded && url.searchParams.get('state') === state && url.searchParams.has('code')
      res.end(
        ok
          ? PAGE(
              t('Conectado'),
              t('Vuelve a CRM Mellow para terminar. Ya puedes cerrar esta pestaña.'),
              back,
            )
          : PAGE(t('No se ha conectado'), t('Vuelve a CRM Mellow e inténtalo de nuevo.'), back),
      )
    })
    server.on('error', (e) => finish(asGoogleError(e)))
    server.listen(0, '127.0.0.1', () => {
      if (settled) return
      redirect = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: opts.scope ?? DRIVE_SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        // Token de actualización para sincronizar sin volver a pedir permiso.
        access_type: 'offline',
        // Siempre se elige la cuenta: el navegador puede tener abierta otra de Google.
        prompt: 'select_account consent',
      })
      const authUrl = `${opts.authUrl ?? AUTH_URL}?${params}`
      end = opts.logins?.begin({ authUrl, receive, cancel: () => finish(cancelled()) }) ?? end
      openBrowser(authUrl)
    })
  })

  opts.onCode?.()
  const exchange = () =>
    http(opts.tokenUrl ?? TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code.code,
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: code.redirect,
      }),
      signal: opts.signal
        ? AbortSignal.any([opts.signal, AbortSignal.timeout(EXCHANGE_TIMEOUT_MS)])
        : AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
    })
  const res = await retryNetwork(
    exchange,
    opts.retryMs ?? EXCHANGE_RETRY_MS,
    opts.retryDelayMs ?? EXCHANGE_RETRY_DELAY_MS,
    opts.signal,
  )
  let json: {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error?: string
    error_description?: string
  }
  try {
    json = (await res.json()) as typeof json
  } catch {
    throw new AppError(
      'GOOGLE_ERROR',
      undefined,
      t('Google ha respondido algo que no se entiende (HTTP {status}).', { status: res.status }),
    )
  }
  if (!res.ok || !json.access_token || !json.refresh_token)
    throw new AppError('GOOGLE_ERROR', undefined, tokenError(json))
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
}

/**
 * Repite `run` mientras falle la red (sin respuesta de Google) y no pase `windowMs`. Una
 * respuesta, aunque sea un error, no se repite: el código de Google solo vale una vez.
 */
async function retryNetwork<T>(
  run: () => Promise<T>,
  windowMs: number,
  delayMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const until = Date.now() + windowMs
  for (;;) {
    if (signal?.aborted) throw cancelled()
    try {
      return await run()
    } catch (e) {
      if (signal?.aborted) throw cancelled()
      if (e instanceof AppError || Date.now() + delayMs > until) throw e
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }
}

/** Renueva el token de acceso con el de actualización. */
export async function refreshAccess(
  client: GoogleClient,
  refreshToken: string,
  http: FetchLike = fetch,
  opts: { service?: string; tokenUrl?: string } = {},
): Promise<{ accessToken: string; expiresAt: number }> {
  const service = opts.service ?? 'Google Drive'
  const res = await http(opts.tokenUrl ?? TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
  })
  const json = (await res.json()) as {
    access_token?: string
    expires_in?: number
    error?: string
  }
  if (!res.ok || !json.access_token)
    throw new AppError(
      'GOOGLE_ERROR',
      undefined,
      json.error === 'invalid_grant'
        ? t('Google ha retirado el acceso: vuelve a conectar {service} en Ajustes.', { service })
        : t('No se pudo renovar el acceso a {service}.', { service }),
    )
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
}
