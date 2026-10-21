import 'foliate-js/view.js'
// Solo tipos de @shared/books: así el marco no carga zod ni el resto de la app.
import type { BundledFont } from '@shared/books'
import { BUNDLED_FAMILY, dataUrlBytes, loadFontFaces } from '../books/fonts'
import type {
  BookInfo,
  FrameStyle,
  FromFrame,
  ReaderTocItem,
  ToFrame,
} from '@shared/reader-messages'

/**
 * Lector de ebooks dentro de su marco aislado (D-123): EPUB, MOBI, AZW3, FB2 y CBZ con
 * foliate-js. Este documento tiene otro origen que la app y su propia CSP; solo habla con
 * la ventana que lo contiene, por `postMessage`.
 */

interface Contributor {
  name?: unknown
}
interface FoliateBook {
  metadata?: { title?: unknown; author?: unknown; language?: unknown }
  toc?: ReaderTocItem[]
  dir?: string
  rendition?: { layout?: string }
  transformTarget?: EventTarget
  getCover?: () => Promise<Blob | null> | Blob | null
}
interface Paginator extends HTMLElement {
  setStyles?: (css: string) => void
  page?: number
  pages?: number
  getContents?: () => { doc: Document; index: number }[]
}
interface RelocateDetail {
  fraction: number
  cfi: string
  tocItem?: { label?: string } | null
  location?: { current: number; next: number; total: number }
}
interface FoliateView extends HTMLElement {
  book: FoliateBook
  renderer: Paginator
  open(file: File): Promise<void>
  init(o: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
  goTo(target: string): Promise<unknown>
  goToFraction(f: number): Promise<void>
  getSectionFractions(): number[]
  next(): Promise<void>
  prev(): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  close(): void
}

// Solo la app puede meter el lector en un marco (frame-ancestors); se le contesta a ella.
const parentOrigin = location.ancestorOrigins?.[0] ?? '*'
const send = (msg: FromFrame, transfer: Transferable[] = []) =>
  parent.postMessage(msg, parentOrigin, transfer)

const languageMap = (x: unknown): string | null => {
  if (!x) return null
  if (typeof x === 'string') return x
  if (typeof x === 'object') {
    const v = Object.values(x as Record<string, unknown>)[0]
    return typeof v === 'string' ? v : null
  }
  return null
}
const contributor = (x: unknown): string | null => {
  const one = (c: unknown) => (typeof c === 'string' ? c : languageMap((c as Contributor)?.name))
  if (Array.isArray(x)) {
    const names = x.map(one).filter((n): n is string => !!n)
    return names.length ? names.join(', ') : null
  }
  return one(x)
}

/**
 * Por si acaso (la CSP ya los bloquea): fuera scripts, marcos, objetos, formularios,
 * redirecciones y manejadores de eventos del contenido del libro.
 */
const DANGEROUS = 'script, iframe, frame, object, embed, base, form, meta[http-equiv]'
function sanitize(markup: string, type: string): string {
  const doc = new DOMParser().parseFromString(markup, type as DOMParserSupportedType)
  if (doc.querySelector('parsererror'))
    return markup.replace(/<script[\s\S]*?<\/script\s*>/gi, '').replace(/<script[^>]*\/>/gi, '')
  for (const el of doc.querySelectorAll(DANGEROUS)) el.remove()
  for (const el of doc.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on')) el.removeAttribute(attr.name)
      else if (/^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  }
  return type === 'text/html'
    ? `<!DOCTYPE html>${doc.documentElement.outerHTML}`
    : new XMLSerializer().serializeToString(doc)
}
const MARKUP = ['application/xhtml+xml', 'text/html', 'image/svg+xml']

/** Espacio entre letras y entre palabras, de normal a mucho más (D-124). */
const LETTER_SPACING = ['normal', '0.02em', '0.05em', '0.08em']
const WORD_SPACING = ['normal', '0.06em', '0.14em', '0.24em']

/**
 * Las letras que van dentro de la app, como @font-face de cada capítulo. Los capítulos son
 * documentos aparte, así que se les da una dirección blob: de este origen (la CSP del
 * marco solo deja cargar letras de blob: y data:).
 */
const fontFaces = new Map<BundledFont, string>()
async function loadFontCss(font: BundledFont): Promise<void> {
  if (fontFaces.has(font)) return
  const faces = await loadFontFaces(font)
  fontFaces.set(
    font,
    faces
      .map((f) => {
        const url = URL.createObjectURL(new Blob([dataUrlBytes(f.data)], { type: 'font/woff2' }))
        return `@font-face { font-family: "${BUNDLED_FAMILY[font]}"; src: url("${url}") format("woff2"); font-weight: ${f.weight}; font-style: ${f.style}; font-display: block; }`
      })
      .join('\n'),
  )
}

function css(s: FrameStyle): string {
  const font = s.fontFamily ? `font-family: ${s.fontFamily} !important;` : ''
  const faces = s.bundledFont ? (fontFaces.get(s.bundledFont) ?? '') : ''
  const spacing = Math.min(3, Math.max(0, Math.round(s.spacing || 0)))
  const text = 'body p, body li, body blockquote, body dd, body span, body div, body a'
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    ${faces}
    html {
      color-scheme: ${s.dark ? 'dark' : 'light'};
      color: ${s.fg} !important;
      background: transparent !important;
      font-size: ${s.fontSize}% !important;
    }
    body { background: transparent !important; color: inherit !important; ${font} }
    body * { color: inherit !important; background-color: transparent !important; }
    ${s.fontFamily ? `body p, body li, body div, body span, body blockquote { ${font} }` : ''}
    a:any-link, a:any-link * { color: ${s.link} !important; }
    p, li, blockquote, dd {
      line-height: ${s.lineHeight} !important;
      text-align: ${s.justify ? 'justify' : 'start'};
      hyphens: auto;
      widows: 2;
      orphans: 2;
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    pre { white-space: pre-wrap !important; }
    ${spacing ? `${text} { letter-spacing: ${LETTER_SPACING[spacing]} !important; word-spacing: ${WORD_SPACING[spacing]} !important; }` : ''}
    ${s.weight === 1 ? 'body, body * { -webkit-text-stroke: 0.025em currentColor; }' : ''}
    ${s.weight === 2 ? 'body, body * { font-weight: 700 !important; }' : ''}
    img, svg, video { max-width: 100%; height: auto; }
    aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"],
    aside[epub|type~="rearnote"] { display: none; }
  `
}

let view: FoliateView | null = null
let lastStyle: FrameStyle | null = null

function applyStyle(s: FrameStyle): void {
  lastStyle = s
  const bundled =
    s.bundledFont && Object.hasOwn(BUNDLED_FAMILY, s.bundledFont) ? s.bundledFont : null
  if (bundled && !fontFaces.has(bundled))
    // Se pinta ya con la letra de reserva y, al llegar la buena, otra vez.
    void loadFontCss(bundled).then(
      () => {
        if (lastStyle === s) applyStyle(s)
      },
      () => {},
    )
  document.documentElement.style.background = s.bg
  document.body.style.background = s.bg
  if (!view) return
  const r = view.renderer
  r.setAttribute('flow', s.flow)
  r.setAttribute('gap', `${s.gap}%`)
  r.setAttribute('margin', '32px')
  r.setAttribute('max-inline-size', '720px')
  r.setAttribute('max-column-count', String(s.maxColumns))
  r.setAttribute('animated', '')
  r.setStyles?.(css(s))
}

/** Toques en el libro: tercio izquierdo, centro o derecho de la pantalla. */
function watchTaps(doc: Document): void {
  let start: { x: number; y: number; t: number } | null = null
  doc.addEventListener('pointerdown', (e) => {
    start = { x: e.screenX, y: e.screenY, t: Date.now() }
  })
  doc.addEventListener('pointerup', (e) => {
    if (!start) return
    const moved = Math.hypot(e.screenX - start.x, e.screenY - start.y)
    const long = Date.now() - start.t > 600
    start = null
    if (moved > 12 || long) return
    if ((e.target as Element | null)?.closest?.('a[href]')) return
    if (doc.getSelection()?.toString()) return
    const frame = doc.defaultView?.frameElement as HTMLElement | null
    const x = (frame?.getBoundingClientRect().left ?? 0) + e.clientX
    const third = innerWidth / 3
    send({ type: 'tap', zone: x < third ? 'left' : x > innerWidth - third ? 'right' : 'center' })
  })
  doc.addEventListener('keydown', (e) => onKey(e))
}

function onKey(e: KeyboardEvent): void {
  if (!view) return
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
    e.preventDefault()
    void (e.key === 'PageUp' ? view.prev() : view.goLeft())
  } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
    e.preventDefault()
    void (e.key === 'ArrowRight' ? view.goRight() : view.next())
  } else if (e.key === 'Escape') send({ type: 'key', key: 'Escape' })
}

/** Cerrar un libro (foliate falla si aún no ha pintado nada: da igual). */
function closeView(v: FoliateView | null): void {
  if (!v) return
  try {
    v.close()
  } catch {
    // Sin capítulo cargado no hay nada que cerrar.
  }
  v.remove()
}

async function makeView(name: string, data: ArrayBuffer): Promise<FoliateView> {
  closeView(view)
  const v = document.createElement('foliate-view') as FoliateView
  document.body.append(v)
  await v.open(new File([data], name))
  // Antes de cargar ningún capítulo.
  v.book.transformTarget?.addEventListener('data', (ev) => {
    const detail = (ev as CustomEvent<{ data: unknown; type: string }>).detail
    if (!MARKUP.includes(detail.type)) return
    detail.data = Promise.resolve(detail.data).then((d) =>
      typeof d === 'string' ? sanitize(d, detail.type) : d,
    )
  })
  view = v
  return v
}

async function open(msg: Extract<ToFrame, { type: 'open' }>): Promise<void> {
  const v = await makeView(msg.name, msg.data)
  v.addEventListener('load', (e) => watchTaps((e as CustomEvent<{ doc: Document }>).detail.doc))
  v.addEventListener('relocate', (e) => {
    const d = (e as CustomEvent<RelocateDetail>).detail
    const page = v.renderer.page
    const pages = v.renderer.pages
    send({
      type: 'relocate',
      cfi: d.cfi,
      fraction: Math.min(1, Math.max(0, d.fraction ?? 0)),
      chapter: d.tocItem?.label?.trim() || null,
      page: (d.location?.current ?? 0) + 1,
      pages: d.location?.total ?? 0,
      // El paginador cuenta una página de relleno a cada lado.
      sectionPage: typeof page === 'number' && typeof pages === 'number' && pages > 2 ? page : null,
      sectionPages: typeof pages === 'number' && pages > 2 ? pages - 2 : null,
    })
  })
  // Enlaces a webs: los abre la app fuera (si son https); los internos, el lector.
  v.addEventListener('external-link', (e) => {
    e.preventDefault()
    send({ type: 'link', href: String((e as CustomEvent<{ href: string }>).detail.href) })
  })
  applyStyle(msg.style)
  await v.init({ lastLocation: msg.location, showTextStart: !msg.location })
  send({
    type: 'opened',
    toc: (v.book.toc ?? []).map(function toc(i: ReaderTocItem): ReaderTocItem {
      return {
        label: String(i.label ?? '').trim(),
        href: String(i.href ?? ''),
        ...(i.subitems?.length ? { subitems: i.subitems.map(toc) } : {}),
      }
    }),
    sectionFractions: v.getSectionFractions(),
    dir: v.book.dir === 'rtl' ? 'rtl' : 'ltr',
    fixedLayout: v.book.rendition?.layout === 'pre-paginated',
  })
}

async function inspect(msg: Extract<ToFrame, { type: 'inspect' }>): Promise<void> {
  const v = await makeView(msg.name, msg.data)
  const m = v.book.metadata ?? {}
  const blob = await Promise.resolve(v.book.getCover?.() ?? null).catch(() => null)
  const cover = blob ? await blob.arrayBuffer() : null
  const info: BookInfo = {
    title: languageMap(m.title),
    author: contributor(m.author),
    language: Array.isArray(m.language) ? languageMap(m.language[0]) : languageMap(m.language),
    cover,
    coverType: blob?.type || null,
  }
  closeView(v)
  view = null
  send({ type: 'inspected', ...info }, cover ? [cover] : [])
}

addEventListener('message', (e: MessageEvent<ToFrame>) => {
  if (e.source !== parent || (parentOrigin !== '*' && e.origin !== parentOrigin)) return
  const msg = e.data
  const fail = (err: unknown) =>
    send({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  switch (msg?.type) {
    case 'open':
      open(msg).catch(fail)
      break
    case 'inspect':
      inspect(msg).catch(fail)
      break
    case 'style':
      applyStyle(msg.style)
      break
    case 'go':
      if (!view) return
      void (msg.to === 'next'
        ? view.next()
        : msg.to === 'prev'
          ? view.prev()
          : msg.to === 'left'
            ? view.goLeft()
            : view.goRight())
      break
    case 'goTo':
      void view?.goTo(msg.href)
      break
    case 'goToFraction':
      void view?.goToFraction(msg.fraction)
      break
  }
})
addEventListener('keydown', onKey)
document.documentElement.style.cssText = 'height:100%;margin:0'
document.body.style.cssText = 'height:100%;margin:0;overflow:hidden'
const sheet = new CSSStyleSheet()
sheet.replaceSync('foliate-view { display: block; height: 100%; }')
document.adoptedStyleSheets = [sheet]
send({ type: 'ready' })
