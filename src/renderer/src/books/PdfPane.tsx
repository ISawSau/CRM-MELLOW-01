import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { t } from '@shared/i18n'
import type { FileRef } from '@shared/data/fields'
import type { ReaderTocItem } from '@shared/reader-messages'
import { openPdf, pdfOutline, renderPdfPage } from './pdf'
import type { PaneEvents, PaneHandle } from './panes'

/**
 * PDF de la biblioteca (D-123). Página a página (ajustada a la pantalla, con pellizco para
 * ampliar) o en continuo (desplazando, pintando solo las páginas cercanas).
 */

/** Cuánto se recorta de cada lado de la página según «Recortar márgenes». */
const CROP = [0, 0.04, 0.07, 0.1]

interface Flat {
  label: string
  page: number
}
function flatten(items: ReaderTocItem[], out: Flat[] = []): Flat[] {
  for (const i of items) {
    const page = Number(i.href)
    if (page > 0) out.push({ label: i.label, page })
    if (i.subitems) flatten(i.subitems, out)
  }
  return out
}

export function PdfPane({
  file,
  initialPage,
  mode,
  invert,
  enhance,
  crop,
  events,
  ref,
}: {
  file: FileRef
  initialPage: number | null
  mode: 'paginado' | 'continuo'
  invert: boolean
  /** Realzar el texto de un escaneado (D-124). */
  enhance: 'no' | 'nitido' | 'contraste'
  /** Recortar márgenes: 0 nada … 3 mucho (D-124). */
  crop: number
  events: PaneEvents
  ref: Ref<PaneHandle>
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(Math.max(1, initialPage ?? 1))
  const [zoom, setZoom] = useState(1)
  const chapters = useRef<Flat[]>([])
  const eventsRef = useRef(events)
  useEffect(() => {
    eventsRef.current = events
  })
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const pageRef = useRef(page)
  const numPages = doc?.numPages ?? 0

  // --- Abrir ---------------------------------------------------------------------
  useEffect(() => {
    let closed = false
    let close: (() => Promise<void>) | null = null
    openPdf(file.id, file.size).then(
      async (p) => {
        close = p.close
        if (closed) return void p.close()
        const toc = await pdfOutline(p.doc)
        chapters.current = flatten(toc)
        setDoc(p.doc)
        setPage((n) => Math.min(Math.max(1, n), p.doc.numPages))
        eventsRef.current.onOpened({
          toc,
          sectionFractions: chapters.current.map((c) => (c.page - 1) / p.doc.numPages),
        })
      },
      (e: unknown) => {
        if (!closed) eventsRef.current.onError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      closed = true
      void close?.()
    }
  }, [file.id, file.size])

  // --- Avisar de la página ------------------------------------------------------------
  useEffect(() => {
    pageRef.current = page
    if (!numPages) return
    const chapter = [...chapters.current].reverse().find((c) => c.page <= page)?.label ?? null
    eventsRef.current.onRelocate({
      cfi: String(page),
      fraction: numPages ? page / numPages : 0,
      chapter,
      page,
      pages: numPages,
      screen: true,
      sectionPage: null,
      sectionPages: null,
    })
  }, [page, numPages])

  const go = (n: number) => setPage((p) => Math.min(Math.max(1, p + n), numPages || 1))
  const screen = (dir: 1 | -1) => {
    const el = list.current
    if (el) el.scrollBy({ top: dir * el.clientHeight * 0.9, behavior: 'smooth' })
  }
  const scrollToPage = (n: number) =>
    list.current
      ?.querySelector<HTMLElement>(`[data-page="${n}"]`)
      ?.scrollIntoView({ block: 'start' })

  useImperativeHandle(ref, () => ({
    next: () => (mode === 'continuo' ? screen(1) : go(1)),
    prev: () => (mode === 'continuo' ? screen(-1) : go(-1)),
    goTo: (href) => {
      const n = Math.min(Math.max(1, Number(href) || 1), numPages || 1)
      if (mode === 'continuo') scrollToPage(n)
      else setPage(n)
    },
    goToFraction: (f) => {
      const n = Math.min(Math.max(1, Math.round(f * numPages)), numPages || 1)
      if (mode === 'continuo') scrollToPage(n)
      else setPage(n)
    },
  }))

  // --- Página a página ---------------------------------------------------------------
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || mode !== 'paginado' || !size.w || !stage.current) return
    let stale = false
    const canvas = document.createElement('canvas')
    canvas.className = 'pdf-page'
    const pad = 12
    renderPdfPage(
      doc,
      page,
      canvas,
      (size.w - pad * 2) * zoom,
      zoom === 1 ? size.h - pad * 2 : null,
      CROP[crop] ?? 0,
    ).then(
      () => {
        if (stale || !stage.current) return
        stage.current.replaceChildren(canvas)
      },
      () => {},
    )
    return () => {
      stale = true
    }
  }, [doc, page, size, zoom, mode, crop])

  // Toques, deslizar y pellizcar (página a página).
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<{ x: number; y: number; t: number; dist: number | null } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...pointers.current.values()]
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      dist: pts.length === 2 ? Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y) : null,
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    const pts = [...pointers.current.values()]
    if (g?.dist && pts.length === 2 && stage.current) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
      stage.current.style.transform = `scale(${d / g.dist})`
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current
    const pts = [...pointers.current.values()]
    pointers.current.delete(e.pointerId)
    if (!g) return
    if (g.dist && pts.length === 2) {
      const d = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y)
      if (stage.current) stage.current.style.transform = ''
      setZoom((z) => Math.min(4, Math.max(1, Math.round(z * (d / g.dist!) * 4) / 4)))
      gesture.current = null
      return
    }
    if (pointers.current.size > 0) return
    gesture.current = null
    const dx = e.clientX - g.x
    const dy = e.clientY - g.y
    if (
      mode === 'paginado' &&
      zoom === 1 &&
      Math.abs(dx) > 60 &&
      Math.abs(dx) > Math.abs(dy) * 1.5
    ) {
      go(dx < 0 ? 1 : -1)
      return
    }
    if (Math.hypot(dx, dy) > 12 || Date.now() - g.t > 600) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const third = rect.width / 3
    eventsRef.current.onTap(x < third ? 'left' : x > rect.width - third ? 'right' : 'center')
  }

  // --- Continuo ----------------------------------------------------------------------
  const [ratio, setRatio] = useState(1.414)
  useEffect(() => {
    if (!doc) return
    void doc.getPage(1).then((p) => {
      const v = p.getViewport({ scale: 1 })
      setRatio(v.height / v.width)
    })
  }, [doc])

  useEffect(() => {
    const el = list.current
    if (!doc || mode !== 'continuo' || !el) return
    const cropFraction = CROP[crop] ?? 0
    const rendered = new Map<number, HTMLCanvasElement>()
    const render = (n: number, slot: HTMLElement) => {
      if (rendered.has(n)) return
      const canvas = document.createElement('canvas')
      canvas.className = 'pdf-page'
      rendered.set(n, canvas)
      void renderPdfPage(doc, n, canvas, slot.clientWidth, null, cropFraction).then(
        () => {
          if (rendered.get(n) === canvas) slot.replaceChildren(canvas)
        },
        () => rendered.delete(n),
      )
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const slot = en.target as HTMLElement
          const n = Number(slot.dataset['page'])
          if (en.isIntersecting) render(n, slot)
          else if (rendered.has(n)) {
            // Lejos de la pantalla: fuera de la memoria.
            rendered.delete(n)
            slot.replaceChildren()
          }
        }
      },
      { root: el, rootMargin: '150% 0px' },
    )
    for (const slot of el.querySelectorAll('[data-page]')) io.observe(slot)
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const mid = el.getBoundingClientRect().top + el.clientHeight * 0.3
        for (const slot of el.querySelectorAll<HTMLElement>('[data-page]')) {
          const r = slot.getBoundingClientRect()
          if (r.top <= mid && r.bottom > mid) {
            const n = Number(slot.dataset['page'])
            if (n !== pageRef.current) setPage(n)
            break
          }
        }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // Al entrar en continuo, a la página en la que se estaba.
    el.querySelector<HTMLElement>(`[data-page="${pageRef.current}"]`)?.scrollIntoView({
      block: 'start',
    })
    return () => {
      io.disconnect()
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [doc, mode, ratio, crop])

  return (
    <div
      className="reader-host pdf-host"
      data-invert={invert}
      data-enhance={enhance}
      data-mode={mode}
      data-zoomed={zoom > 1}
      data-testid="reader-pdf"
      ref={box}
    >
      {!doc && <p className="reader-loading">{t('Abriendo el libro…')}</p>}
      {mode === 'paginado' ? (
        <div
          className="pdf-stage-wrap"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
          onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
        >
          <div className="pdf-stage" ref={stage} />
        </div>
      ) : (
        <div
          className="pdf-list"
          ref={list}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={(e) => pointers.current.delete(e.pointerId)}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div
              key={i}
              className="pdf-slot"
              data-page={i + 1}
              style={{ aspectRatio: `1 / ${ratio}` }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
