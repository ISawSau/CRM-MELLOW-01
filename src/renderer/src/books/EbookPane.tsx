import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import type { FileRef } from '@shared/data/fields'
import type { FrameStyle } from '@shared/reader-messages'
import { fileUrl } from '../data/files'
import { ReaderFrame } from './frame'
import type { PaneEvents, PaneHandle } from './panes'

/** Ebook (EPUB, MOBI, AZW3, FB2, CBZ) en el marco aislado del lector (D-123). */
export function EbookPane({
  readerUrl,
  file,
  location,
  style,
  events,
  ref,
}: {
  readerUrl: string
  file: FileRef
  location: string | null
  style: FrameStyle
  events: PaneEvents
  ref: Ref<PaneHandle>
}) {
  const host = useRef<HTMLDivElement>(null)
  const frame = useRef<ReaderFrame | null>(null)
  const eventsRef = useRef(events)
  const styleRef = useRef(style)
  useEffect(() => {
    eventsRef.current = events
  })

  useImperativeHandle(ref, () => ({
    next: () => frame.current?.post({ type: 'go', to: 'right' }),
    prev: () => frame.current?.post({ type: 'go', to: 'left' }),
    goTo: (href) => frame.current?.post({ type: 'goTo', href }),
    goToFraction: (fraction) => frame.current?.post({ type: 'goToFraction', fraction }),
  }))

  // El libro se abre una vez; la apariencia se cambia sin volver a abrirlo.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const f = new ReaderFrame(readerUrl, el)
    frame.current = f
    let cancelled = false
    const off = f.on((m) => {
      const ev = eventsRef.current
      if (m.type === 'opened') ev.onOpened({ toc: m.toc, sectionFractions: m.sectionFractions })
      else if (m.type === 'relocate') {
        ev.onRelocate({
          cfi: m.cfi,
          fraction: m.fraction,
          chapter: m.chapter,
          page: m.page,
          pages: m.pages,
          screen: m.screen,
          sectionPage: m.sectionPage,
          sectionPages: m.sectionPages,
        })
      } else if (m.type === 'tap') ev.onTap(m.zone)
      else if (m.type === 'link') ev.onLink(m.href)
      else if (m.type === 'key' && m.key === 'Escape') ev.onEscape()
      else if (m.type === 'error') ev.onError(m.message)
    })
    void (async () => {
      try {
        const res = await fetch(fileUrl(file.id))
        if (!res.ok) throw new Error(String(res.status))
        const data = await res.arrayBuffer()
        await f.ready
        if (cancelled) return
        f.post({ type: 'open', name: file.name, data, location, style: styleRef.current }, [data])
        f.focus()
      } catch (e) {
        if (!cancelled) eventsRef.current.onError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
      off()
      f.destroy()
      frame.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readerUrl, file.id])

  useEffect(() => {
    styleRef.current = style
    frame.current?.post({ type: 'style', style })
  }, [style])

  return <div className="reader-host" ref={host} data-testid="reader-ebook" />
}
