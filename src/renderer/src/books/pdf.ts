import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { ReaderTocItem } from '@shared/reader-messages'
import { fileUrl } from '../data/files'
import { loadPdfJs } from '../tools/pdf'

/**
 * PDF de la biblioteca con pdf.js (D-123), en la propia interfaz: pdf.js no ejecuta el
 * JavaScript de los PDF. El archivo se lee por trozos (peticiones con Range al almacén
 * cifrado), así un PDF de cientos de MB no se carga entero en la memoria del móvil.
 */

const CHUNK = 256 * 1024

async function fetchRange(url: string, begin: number, end: number): Promise<Uint8Array> {
  const res = await fetch(url, { headers: { Range: `bytes=${begin}-${end - 1}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

export interface OpenPdf {
  doc: PDFDocumentProxy
  close: () => Promise<void>
}

export async function openPdf(fileId: string, size: number): Promise<OpenPdf> {
  const lib = await loadPdfJs()
  const url = fileUrl(fileId)
  const first = await fetchRange(url, 0, Math.min(size, CHUNK))
  const transport = new lib.PDFDataRangeTransport(size, first)
  transport.requestDataRange = (begin: number, end: number) => {
    fetchRange(url, begin, end).then(
      (chunk) => transport.onDataRange(begin, chunk),
      () => {},
    )
  }
  const task: PDFDocumentLoadingTask = lib.getDocument({
    range: transport,
    rangeChunkSize: CHUNK,
    disableAutoFetch: true,
    disableStream: true,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  const doc = await task.promise
  return { doc, close: () => task.destroy() }
}

/** Pinta una página en un canvas del ancho dado (en píxeles CSS). */
export async function renderPdfPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number | null,
  /** Parte de cada lado que se recorta (0–0,2): márgenes fuera, texto más grande (D-124). */
  crop = 0,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const keep = 1 - 2 * crop
  // Ajustar al ancho o, si se da el alto, a la página entera (lo que queda tras recortar).
  let scale = cssWidth / (base.width * keep)
  if (cssHeight !== null) scale = Math.min(scale, cssHeight / (base.height * keep))
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5)
  const viewport = page.getViewport({ scale: scale * dpr })
  canvas.width = Math.ceil(viewport.width * keep)
  canvas.height = Math.ceil(viewport.height * keep)
  const width = Math.round((viewport.width * keep) / dpr)
  const height = Math.round((viewport.height * keep) / dpr)
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({
    canvas,
    canvasContext: ctx,
    viewport,
    ...(crop > 0
      ? { transform: [1, 0, 0, 1, -viewport.width * crop, -viewport.height * crop] }
      : {}),
  }).promise
  page.cleanup()
  return { width, height }
}

/** Índice del PDF (marcadores), con el número de página de cada entrada. */
export async function pdfOutline(doc: PDFDocumentProxy): Promise<ReaderTocItem[]> {
  const outline = await doc.getOutline().catch(() => null)
  if (!outline) return []
  const pageOf = async (dest: unknown): Promise<number | null> => {
    try {
      const d = typeof dest === 'string' ? await doc.getDestination(dest) : dest
      if (!Array.isArray(d) || !d[0]) return null
      const ref = d[0] as { num: number; gen: number } | number
      return typeof ref === 'number' ? ref + 1 : (await doc.getPageIndex(ref)) + 1
    } catch {
      return null
    }
  }
  const walk = async (
    items: { title: string; dest: unknown; items?: unknown[] }[],
  ): Promise<ReaderTocItem[]> => {
    const out: ReaderTocItem[] = []
    for (const i of items.slice(0, 500)) {
      const page = await pageOf(i.dest)
      const sub = i.items?.length
        ? await walk(i.items as { title: string; dest: unknown; items?: unknown[] }[])
        : []
      out.push({
        label: String(i.title ?? '').trim(),
        href: page ? String(page) : '',
        ...(sub.length ? { subitems: sub } : {}),
      })
    }
    return out
  }
  return walk(outline as { title: string; dest: unknown; items?: unknown[] }[])
}

/** Título, autor, páginas y portada (la primera página) de un PDF que se añade. */
export async function inspectPdf(
  fileId: string,
  size: number,
): Promise<{ title: string | null; author: string | null; pages: number; cover: Blob | null }> {
  const { doc, close } = await openPdf(fileId, size)
  try {
    const meta = await doc.getMetadata().catch(() => null)
    const info = (meta?.info ?? {}) as { Title?: unknown; Author?: unknown }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null)
    const canvas = document.createElement('canvas')
    let cover: Blob | null = null
    try {
      await renderPdfPage(doc, 1, canvas, 480 / Math.min(window.devicePixelRatio || 1, 2.5), null)
      cover = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82))
    } catch {
      cover = null
    }
    return { title: str(info.Title), author: str(info.Author), pages: doc.numPages, cover }
  } finally {
    await close()
  }
}
