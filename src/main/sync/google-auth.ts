import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FetchLike } from './remote'

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
const LOGIN_TIMEOUT_MS = 5 * 60_000

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

const PAGE = (title: string, text: string) => `<!doctype html><html lang="es"><meta charset="utf-8">
<title>${title}</title><body style="font-family:sans-serif;background:#0d0908;color:#fdf6ee;display:grid;place-items:center;height:100vh;margin:0">
<div style="max-width:420px"><h1 style="font-size:20px">${title}</h1><p>${text}</p></div></body></html>`

/**
 * Abre el navegador del sistema para conectar con Google y espera la respuesta en
 * un puerto local. Devuelve los tokens.
 */
export async function connectGoogle(
  client: GoogleClient,
  openBrowser: (url: string) => void,
  http: FetchLike = fetch,
): Promise<GoogleTokens> {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))

  let server: Server | null = null
  const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    const timer = setTimeout(() => {
      server?.close()
      reject(new Error('Se agotó el tiempo para conectar con Google.'))
    }, LOGIN_TIMEOUT_MS)
    let redirect = ''
    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== '/') {
        res.writeHead(404).end()
        return
      }
      const err = url.searchParams.get('error')
      const got = url.searchParams.get('code')
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      if (err || !got || url.searchParams.get('state') !== state) {
        res.end(PAGE('No se ha conectado', 'Vuelve a CRM Mellow e inténtalo de nuevo.'))
        clearTimeout(timer)
        server?.close()
        reject(
          new Error(
            err === 'access_denied'
              ? 'Has cancelado la conexión.'
              : 'Respuesta de Google no válida.',
          ),
        )
        return
      }
      res.end(PAGE('Conectado', 'Ya puedes cerrar esta pestaña y volver a CRM Mellow.'))
      clearTimeout(timer)
      server?.close()
      resolve({ code: got, redirect })
    })
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`
      const params = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirect,
        response_type: 'code',
        scope: DRIVE_SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        // Token de actualización para sincronizar sin volver a pedir permiso.
        access_type: 'offline',
        prompt: 'consent',
      })
      openBrowser(`${AUTH_URL}?${params}`)
    })
    server.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
  })

  const res = await http(TOKEN_URL, {
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
  })
  const json = (await res.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    error_description?: string
  }
  if (!res.ok || !json.access_token || !json.refresh_token)
    throw new Error(json.error_description ?? 'Google no ha dado acceso.')
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
}

/** Renueva el token de acceso con el de actualización. */
export async function refreshAccess(
  client: GoogleClient,
  refreshToken: string,
  http: FetchLike = fetch,
): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await http(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const json = (await res.json()) as {
    access_token?: string
    expires_in?: number
    error?: string
  }
  if (!res.ok || !json.access_token)
    throw new Error(
      json.error === 'invalid_grant'
        ? 'Google ha retirado el acceso: vuelve a conectar Google Drive en Ajustes.'
        : 'No se pudo renovar el acceso a Google Drive.',
    )
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
  }
}
