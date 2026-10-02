import { app, protocol, shell, type Session } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, join, normalize, relative } from 'node:path'

/**
 * Endurecimiento de Electron (CLAUDE.md y la guía oficial de seguridad de Electron).
 * Todo lo que el renderer puede hacer pasa por aquí o por el contrato IPC.
 */

export const APP_SCHEME = 'app'
export const APP_HOST = 'crm'
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}

/** Debe llamarse antes de `app.whenReady()`. */
export function registerPrivilegedScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ])
}

/**
 * CSP. En producción no se permite nada externo: ni scripts inline, ni eval, ni
 * conexiones de red (la red solo la usa el proceso principal).
 * En desarrollo se permite el servidor de Vite y su recarga en caliente.
 */
export function contentSecurityPolicy(devServerUrl?: string): string {
  const dev = devServerUrl ? new URL(devServerUrl) : null
  const self = dev ? `'self' ${dev.origin}` : "'self'"
  const directives = [
    "default-src 'none'",
    // El preámbulo de React Refresh es un script inline: solo en desarrollo.
    `script-src ${self}${dev ? " 'unsafe-inline'" : ''}`,
    // Vite inyecta los estilos con <style> en desarrollo.
    `style-src ${self}${dev ? " 'unsafe-inline'" : ''}`,
    `img-src ${self} data: blob:`,
    `font-src ${self}`,
    `connect-src ${self}${dev ? ` ws://${dev.host}` : ''}`,
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "worker-src 'none'",
  ]
  return directives.join('; ')
}

/**
 * Sirve la interfaz desde `app://crm/` en lugar de `file://` (recomendación oficial:
 * así `file://` no tiene privilegios y la CSP se aplica con cabecera).
 */
export function registerAppProtocol(ses: Session, rendererDir: string): void {
  const root = normalize(rendererDir)
  const csp = contentSecurityPolicy()
  ses.protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response('No encontrado', { status: 404 })
    let pathname: string
    try {
      pathname = decodeURIComponent(url.pathname)
    } catch {
      return new Response('No encontrado', { status: 404 })
    }
    const file = normalize(join(root, pathname === '/' ? 'index.html' : pathname))
    const rel = relative(root, file)
    // Nada fuera de la carpeta de la interfaz (evita ../../ y rutas absolutas).
    if (rel.startsWith('..') || isAbsolute(rel))
      return new Response('No encontrado', { status: 404 })
    // Lectura directa del disco: net.fetch pasaría por la sesión por defecto, que
    // tiene bloqueada toda la red.
    let body: Buffer
    try {
      body = await readFile(file)
    } catch {
      return new Response('No encontrado', { status: 404 })
    }
    const type = MIME_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream'
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    })
  })
}

/** ¿La URL pertenece a la propia interfaz? */
export function isAppUrl(raw: string, devServerUrl?: string): boolean {
  try {
    const url = new URL(raw)
    if (url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST) return true
    if (devServerUrl && url.origin === new URL(devServerUrl).origin) return true
    return false
  } catch {
    return false
  }
}

/** Solo se abren en el navegador del sistema enlaces https y mailto. */
export function openExternalSafely(raw: string): void {
  try {
    const url = new URL(raw)
    if (url.protocol === 'https:' || url.protocol === 'mailto:')
      void shell.openExternal(url.toString())
  } catch {
    // URL no válida: se ignora.
  }
}

/**
 * El corrector ortográfico de Chromium descarga diccionarios de Google en cuanto se
 * crea una sesión, y esa descarga no pasa por webRequest. Se desactiva en el mismo
 * momento de crear cada sesión.
 */
export function disableSpellcheckOnEverySession(): void {
  app.on('session-created', (ses) => {
    ses.setSpellCheckerEnabled(false)
    ses.setSpellCheckerLanguages([])
  })
}

export function hardenSession(ses: Session, devServerUrl?: string): void {
  // Ningún permiso del navegador (cámara, micro, notificaciones, geolocalización, USB…).
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  ses.setDevicePermissionHandler(() => false)
  ses.on('will-download', (event) => event.preventDefault())
  ses.setSpellCheckerEnabled(false)

  // El renderer no sale a la red: solo puede pedir recursos de la propia app.
  const dev = devServerUrl ? new URL(devServerUrl) : null
  ses.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url)
    const allowed =
      (url.protocol === `${APP_SCHEME}:` && url.host === APP_HOST) ||
      url.protocol === 'devtools:' ||
      url.protocol === 'data:' ||
      url.protocol === 'blob:' ||
      (dev !== null &&
        (url.origin === dev.origin || (url.protocol === 'ws:' && url.host === dev.host)))
    callback({ cancel: !allowed })
  })

  // En desarrollo la interfaz viene del servidor de Vite: se le añade la CSP por cabecera.
  if (devServerUrl) {
    const csp = contentSecurityPolicy(devServerUrl)
    ses.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
      })
    })
  }
}

/** Reglas para cualquier webContents que se cree (ventanas, devtools…). */
export function hardenWebContents(devServerUrl?: string): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      openExternalSafely(url)
      return { action: 'deny' }
    })
    const blockNavigation = (event: Electron.Event, url: string) => {
      if (!isAppUrl(url, devServerUrl)) {
        event.preventDefault()
        openExternalSafely(url)
      }
    }
    contents.on('will-navigate', blockNavigation)
    contents.on('will-redirect', blockNavigation)
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })
}

/**
 * En la app empaquetada, se niega a arrancar con opciones de depuración remota.
 * (Los fuses ya desactivan --inspect y NODE_OPTIONS; esto cubre los de Chromium.)
 */
export function refuseDebugSwitches(): boolean {
  if (!app.isPackaged) return false
  const forbidden = ['remote-debugging-port', 'remote-debugging-pipe', 'inspect', 'inspect-brk']
  return forbidden.some((s) => app.commandLine.hasSwitch(s))
}
