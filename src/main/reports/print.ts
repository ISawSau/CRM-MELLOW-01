import { BrowserWindow, session, type Session } from 'electron'
import { randomBytes } from 'node:crypto'

/**
 * Imprime un HTML a PDF con el motor de Chromium (printToPDF). La ventana es oculta, sin
 * JavaScript, con una sesión propia solo en memoria y sin red: solo puede cargar el
 * documento que se le da, servido desde `informe://` (D-076).
 */

const SCHEME = 'informe'
const pending = new Map<string, string>()
let ses: Session | null = null

function reportSession(): Session {
  if (ses) return ses
  const s = session.fromPartition('informes', { cache: false })
  s.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
  s.setPermissionCheckHandler(() => false)
  s.on('will-download', (e) => e.preventDefault())
  s.webRequest.onBeforeRequest((details, cb) => {
    const ok = details.url.startsWith(`${SCHEME}://`) || details.url.startsWith('data:')
    cb({ cancel: !ok })
  })
  s.protocol.handle(SCHEME, (request) => {
    const id = /^informe:\/\/doc\/([a-f0-9]{32})$/.exec(request.url)?.[1]
    const html = id ? pending.get(id) : undefined
    if (!html) return new Response('No encontrado', { status: 404 })
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:",
      },
    })
  })
  ses = s
  return s
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const id = randomBytes(16).toString('hex')
  pending.set(id, html)
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    webPreferences: {
      session: reportSession(),
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      devTools: false,
    },
  })
  try {
    await win.loadURL(`${SCHEME}://doc/${id}`)
    return await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#8a7d76;text-align:center;font-family:Arial,sans-serif"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    })
  } finally {
    pending.delete(id)
    win.destroy()
  }
}
