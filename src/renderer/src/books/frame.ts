import type { BookInfo, FromFrame, ToFrame } from '@shared/reader-messages'

/**
 * El marco aislado del lector de ebooks (D-123): otro origen con su propia CSP. Aquí solo
 * se le pasan el libro y la apariencia, y se escuchan sus mensajes (comprobando que vienen
 * de ese marco y de ese origen).
 */
export class ReaderFrame {
  readonly iframe: HTMLIFrameElement
  private readonly origin: string
  private readonly listeners = new Set<(m: FromFrame) => void>()
  private readonly onMessage: (e: MessageEvent) => void
  readonly ready: Promise<void>

  constructor(url: string, container: HTMLElement, hidden = false) {
    this.origin = new URL(url).origin
    const iframe = document.createElement('iframe')
    // Sus propios scripts sí (es el lector); nada más: ni ventanas, ni formularios, ni
    // navegar la app. allow-same-origin es su propio origen, no el de la app.
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    iframe.setAttribute('referrerpolicy', 'no-referrer')
    iframe.className = 'reader-frame'
    iframe.title = 'reader'
    if (hidden) iframe.setAttribute('aria-hidden', 'true')
    iframe.src = url
    this.iframe = iframe
    let resolveReady: () => void = () => {}
    this.ready = new Promise((r) => (resolveReady = r))
    this.onMessage = (e: MessageEvent) => {
      if (e.source !== iframe.contentWindow || e.origin !== this.origin) return
      const msg = e.data as FromFrame
      if (msg?.type === 'ready') resolveReady()
      for (const l of this.listeners) l(msg)
    }
    window.addEventListener('message', this.onMessage)
    container.append(iframe)
  }

  on(listener: (m: FromFrame) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  post(msg: ToFrame, transfer: Transferable[] = []): void {
    this.iframe.contentWindow?.postMessage(msg, this.origin, transfer)
  }

  focus(): void {
    this.iframe.contentWindow?.focus()
  }

  destroy(): void {
    window.removeEventListener('message', this.onMessage)
    this.listeners.clear()
    this.iframe.remove()
  }
}

/** Título, autor y portada de un ebook, leídos en un marco aislado invisible. */
export async function inspectEbook(
  url: string,
  name: string,
  data: ArrayBuffer,
): Promise<BookInfo> {
  const host = document.createElement('div')
  host.className = 'reader-inspect'
  document.body.append(host)
  const frame = new ReaderFrame(url, host, true)
  try {
    await withTimeout(frame.ready, 20_000)
    const info = new Promise<BookInfo>((resolve, reject) => {
      frame.on((m) => {
        if (m.type === 'inspected') {
          resolve({
            title: m.title,
            author: m.author,
            language: m.language,
            cover: m.cover,
            coverType: m.coverType,
          })
        } else if (m.type === 'error') reject(new Error(m.message))
      })
    })
    frame.post({ type: 'inspect', name, data }, [data])
    return await withTimeout(info, 60_000)
  } finally {
    frame.destroy()
    host.remove()
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}
