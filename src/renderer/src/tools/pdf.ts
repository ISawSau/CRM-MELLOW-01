import { t } from '@shared/i18n'
import { PDF_LEVELS, type PdfLevel } from '@shared/tools'

/**
 * PDF: unir, dividir y comprimir en la propia interfaz. pdf-lib (MIT) escribe los PDF;
 * para comprimir de verdad, pdf.js (Apache-2.0) pinta cada página y se guarda como
 * imagen JPEG (D-075). Las dos librerías se cargan solo al usarlas.
 */

export class PdfError extends Error {}

async function load(data: Uint8Array) {
  const { PDFDocument } = await import('pdf-lib')
  try {
    return await PDFDocument.load(data, { updateMetadata: false })
  } catch (e) {
    if (e instanceof Error && /encrypt/i.test(e.message))
      throw new PdfError(t('El PDF está protegido con contraseña: quítasela antes.'))
    throw new PdfError(t('El archivo no es un PDF válido.'))
  }
}

export async function pdfPageCount(data: Uint8Array): Promise<number> {
  return (await load(data)).getPageCount()
}

export async function mergePdfs(files: Uint8Array[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  for (const f of files) {
    const doc = await load(f)
    const pages = await out.copyPages(doc, doc.getPageIndices())
    for (const p of pages) out.addPage(p)
  }
  return out.save({ useObjectStreams: true })
}

export async function splitPdf(data: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const { PDFDocument } = await import('pdf-lib')
  const doc = await load(data)
  const result: Uint8Array[] = []
  for (const g of groups) {
    const out = await PDFDocument.create()
    for (const p of await out.copyPages(doc, g)) out.addPage(p)
    result.push(await out.save({ useObjectStreams: true }))
  }
  return result
}

type PdfJs = typeof import('pdfjs-dist')
let pdfjs: Promise<PdfJs> | null = null

/**
 * pdf.js en el hilo principal: la CSP no permite workers (worker-src 'none'), así que se
 * le da el «worker» como módulo ya cargado. pdf.js 6 no usa eval.
 */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= (async () => {
    const [lib, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.mjs'),
    ])
    ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker
    return lib
  })()
  return pdfjs
}

/** Pinta cada página con pdf.js (para comprimir y para la vista previa). */
export async function renderPages(
  data: Uint8Array,
  scale: number,
  onPage: (canvas: OffscreenCanvas, size: { width: number; height: number }) => Promise<void>,
  maxPages = Infinity,
): Promise<number> {
  const lib = await loadPdfJs()
  const task = lib.getDocument({
    // pdf.js se queda con el búfer: se le pasa una copia.
    data: data.slice(),
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  })
  const doc = await task.promise
  try {
    const n = Math.min(doc.numPages, maxPages)
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale })
      const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({
        canvas: canvas as unknown as HTMLCanvasElement,
        canvasContext: ctx as unknown as CanvasRenderingContext2D,
        viewport,
      }).promise
      await onPage(canvas, { width: base.width, height: base.height })
      page.cleanup()
    }
    return doc.numPages
  } finally {
    await task.destroy()
  }
}

export async function compressPdf(data: Uint8Array, level: PdfLevel): Promise<Uint8Array> {
  const { dpi, quality } = PDF_LEVELS[level]
  if (dpi === null) return (await load(data)).save({ useObjectStreams: true })
  await load(data) // mismo aviso si está cifrado o dañado
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  await renderPages(data, dpi / 72, async (canvas, size) => {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    const img = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()))
    out.addPage([size.width, size.height]).drawImage(img, {
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
    })
  })
  return out.save({ useObjectStreams: true })
}
