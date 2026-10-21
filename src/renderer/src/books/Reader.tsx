import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FINISHED_FRACTION,
  READER_FONTS,
  READER_THEMES,
  bookFormat,
  isDarkReaderTheme,
  type BookProgress,
  type ReaderPrefs,
} from '@shared/books'
import type { FileRef } from '@shared/data/fields'
import { t } from '@shared/i18n'
import type { FrameLocation, ReaderTocItem } from '@shared/reader-messages'
import { call } from '../lib/ipc'
import { isMobile } from '../lib/platform'
import { useToast } from '../ui/Toast'
import { EbookPane } from './EbookPane'
import { durationLabel, percentLabel } from './format'
import { useReaderPrefs, useReaderUrl, useReadingStats } from './hooks'
import type { PaneEvents, PaneHandle } from './panes'
import { PdfPane } from './PdfPane'
import { ReadingTracker } from './session'
import { frameStyle, readerColors } from './style'

export interface ReaderBook {
  id: string
  title: string
  author: string | null
  file: FileRef
  state: string | null
  progress: BookProgress | null
}

const THEME_LABELS: Record<ReaderPrefs['theme'], string> = {
  app: 'Como la app',
  papel: 'Papel',
  sepia: 'Sepia',
  noche: 'Noche',
  negro: 'Negro',
}
const FONT_LABELS: Record<ReaderPrefs['font'], string> = {
  libro: 'La del libro',
  serif: 'Con remates',
  sans: 'Sin remates',
}
const MARGIN_LABELS = ['Estrechos', 'Normales', 'Anchos', 'Muy anchos']

/** Minutos que se tarda en leer cada «página» si aún no hay ritmo propio. */
const DEFAULT_MIN_PER_PAGE = { pdf: 1.5, ebook: 1.1 }

function TocList({
  items,
  current,
  onGo,
}: {
  items: ReaderTocItem[]
  current: string | null
  onGo: (href: string) => void
}) {
  return (
    <ul className="reader-toc-list">
      {items.map((i, n) => (
        <li key={`${i.href}-${n}`}>
          <button
            type="button"
            className="reader-toc-item"
            aria-current={i.label === current ? 'true' : undefined}
            disabled={!i.href}
            onClick={() => onGo(i.href)}
          >
            {i.label || t('(sin título)')}
          </button>
          {i.subitems?.length ? <TocList items={i.subitems} current={current} onGo={onGo} /> : null}
        </li>
      ))}
    </ul>
  )
}

function Stepper({
  label,
  value,
  onDown,
  onUp,
  testId,
}: {
  label: string
  value: string
  onDown: () => void
  onUp: () => void
  testId: string
}) {
  return (
    <div className="reader-row">
      <span>{label}</span>
      <span className="reader-stepper">
        <button type="button" className="icon-btn" aria-label={t('Menos')} onClick={onDown}>
          −
        </button>
        <span className="num" data-testid={testId}>
          {value}
        </span>
        <button type="button" className="icon-btn" aria-label={t('Más')} onClick={onUp}>
          +
        </button>
      </span>
    </div>
  )
}

/**
 * Lector a pantalla completa (D-123), pensado primero para el móvil: toca a los lados para
 * pasar página (o desliza), en el centro para ver u ocultar los controles; en el ordenador,
 * también con las flechas. Guarda por dónde vas y el rato de lectura.
 */
export function Reader({ book, onClose }: { book: ReaderBook; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const readerUrl = useReaderUrl()
  const stats = useReadingStats()
  const [prefs, setPrefs] = useReaderPrefs()
  const format = bookFormat(book.file.name)
  const [chrome, setChrome] = useState(true)
  const [panel, setPanel] = useState<null | 'toc' | 'ajustes'>(null)
  const [loc, setLoc] = useState<FrameLocation | null>(null)
  const [toc, setToc] = useState<ReaderTocItem[]>([])
  const [ticks, setTicks] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [finishedAsked, setFinishedAsked] = useState(book.state === 'leido')
  const [wide, setWide] = useState(() => window.innerWidth >= 900)
  const pane = useRef<PaneHandle>(null)
  const tracker = useRef<ReadingTracker | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastLoc = useRef<FrameLocation | null>(null)
  // La posición con la que se abrió (no cambia mientras se lee).
  const [start] = useState(() => book.progress)

  const saveProgress = useCallback(
    (l: FrameLocation) =>
      call('books:setProgress', {
        recordId: book.id,
        location: l.cfi,
        fraction: l.fraction,
        page: l.page || null,
        pages: l.pages || null,
        chapter: l.chapter?.slice(0, 300) ?? null,
      })
        .then(() => qc.invalidateQueries({ queryKey: ['books', 'progress'] }))
        .catch(() => {}),
    [book.id, qc],
  )

  // Abrir: estado «Leyendo», modo lectura del sistema y el rato de lectura.
  useEffect(() => {
    void call('books:open', { recordId: book.id }).catch(() => {})
    const tr = new ReadingTracker(book.id)
    tracker.current = tr
    const onResize = () => setWide(window.innerWidth >= 900)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (lastLoc.current) void saveProgress(lastLoc.current)
      void tr.stop().then(() => qc.invalidateQueries({ queryKey: ['books'] }))
      tracker.current = null
    }
  }, [book.id, qc, saveProgress])

  useEffect(() => {
    void call('books:readingMode', { on: true, volumeKeys: prefs.volumeKeys }).catch(() => {})
  }, [prefs.volumeKeys])
  useEffect(
    () => () => void call('books:readingMode', { on: false, volumeKeys: false }).catch(() => {}),
    [],
  )

  const next = useCallback(() => {
    tracker.current?.touch()
    pane.current?.next()
  }, [])
  const prev = useCallback(() => {
    tracker.current?.touch()
    pane.current?.prev()
  }, [])
  // En el móvil, al pasar página tocando o con el volumen los controles se apartan (como en
  // un lector de ebooks); tocar el centro los vuelve a mostrar. En el ordenador se quedan.
  const turn = useCallback(
    (dir: 1 | -1) => {
      if (isMobile()) setChrome(false)
      if (dir === 1) next()
      else prev()
    },
    [next, prev],
  )

  // Teclado (ordenador), Escape y «atrás» de Android, botones de volumen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (panel) setPanel(null)
        else onClose()
      } else if (!panel && (e.key === 'ArrowRight' || e.key === 'PageDown')) {
        e.preventDefault()
        turn(1)
      } else if (!panel && (e.key === 'ArrowLeft' || e.key === 'PageUp')) {
        e.preventDefault()
        turn(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    const w = window as { __crmVolume?: (key: 'up' | 'down') => boolean }
    w.__crmVolume = (key) => {
      if (!prefs.volumeKeys || panel) return false
      turn(key === 'down' ? 1 : -1)
      return true
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      delete w.__crmVolume
    }
  }, [panel, onClose, turn, prefs.volumeKeys])

  const events: PaneEvents = {
    onOpened: ({ toc: items, sectionFractions }) => {
      setToc(items)
      setTicks(sectionFractions)
    },
    onRelocate: (l) => {
      setLoc(l)
      lastLoc.current = l
      tracker.current?.moved(l.fraction)
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => void saveProgress(l), 1500)
    },
    onTap: (zone) => {
      tracker.current?.touch()
      if (panel) setPanel(null)
      else if (zone === 'center') setChrome((c) => !c)
      else turn(zone === 'right' ? 1 : -1)
    },
    onError: (message) => setError(message),
    onLink: (href) => {
      // Como los enlaces de las notas: el sistema lo abre fuera (solo https).
      if (/^https:\/\//i.test(href)) window.open(href, '_blank', 'noreferrer')
    },
    onEscape: () => onClose(),
  }

  const style = useMemo(() => frameStyle(prefs, wide), [prefs, wide])
  const colors = readerColors(prefs)
  const dark = isDarkReaderTheme(prefs.theme, colors.dark)

  // Tiempo que queda, con tu ritmo en este libro (o uno de serie hasta tenerlo).
  const remaining = useMemo(() => {
    if (!loc) return null
    const rate = stats.data?.books.find((b) => b.recordId === book.id)?.fractionPerHour
    const perPage = DEFAULT_MIN_PER_PAGE[format] * 60
    const secondsFor = (fraction: number) =>
      rate ? (fraction / rate) * 3600 : loc.pages ? fraction * loc.pages * perPage : null
    const book_ = secondsFor(Math.max(0, 1 - loc.fraction))
    const end = ticks.find((f) => f > loc.fraction + 1e-6) ?? 1
    const chapter = format === 'ebook' ? secondsFor(Math.max(0, end - loc.fraction)) : null
    return { book: book_, chapter }
  }, [loc, stats.data, book.id, format, ticks])

  const finished = !!loc && loc.fraction >= FINISHED_FRACTION && !finishedAsked
  const markFinished = async () => {
    setFinishedAsked(true)
    try {
      await call('books:finish', { recordId: book.id })
      toast.show(t('Marcado como leído.'))
    } catch {
      toast.show(t('No se ha podido guardar.'), 'error')
    }
  }

  const sizeStep = (d: number) =>
    setPrefs({ fontSize: Math.min(250, Math.max(60, prefs.fontSize + d)) })
  const lineStep = (d: number) =>
    setPrefs({
      lineHeight: Math.min(2.4, Math.max(1, Math.round((prefs.lineHeight + d) * 10) / 10)),
    })

  const pageText = loc
    ? format === 'pdf'
      ? t('Página {page} de {pages}', { page: loc.page, pages: loc.pages })
      : loc.pages
        ? t('Posición {page} de {pages}', { page: loc.page, pages: loc.pages })
        : ''
    : ''

  return (
    <div
      className="reader"
      role="dialog"
      aria-modal="true"
      aria-label={book.title}
      data-testid="reader"
      data-theme-dark={dark}
      data-chrome={chrome}
      style={{ background: colors.bg, color: colors.fg }}
    >
      <div className="reader-body">
        {error ? (
          <div className="reader-error" role="alert">
            <p>{t('No se ha podido abrir el libro.')}</p>
            <p className="faint">{error}</p>
            <button type="button" className="btn" onClick={onClose}>
              {t('Volver a la biblioteca')}
            </button>
          </div>
        ) : format === 'pdf' ? (
          <PdfPane
            ref={pane}
            file={book.file}
            initialPage={start ? Number(start.location) || null : null}
            mode={prefs.flow}
            invert={dark && prefs.pdfInvert}
            events={events}
          />
        ) : readerUrl.data ? (
          <EbookPane
            ref={pane}
            readerUrl={readerUrl.data}
            file={book.file}
            location={start?.location ?? null}
            style={style}
            events={events}
          />
        ) : null}
        {prefs.dim > 0 && (
          <div className="reader-dim" style={{ opacity: prefs.dim / 100 }} aria-hidden="true" />
        )}
      </div>

      <header className="reader-top" data-visible={chrome}>
        <button
          type="button"
          className="icon-btn"
          onClick={onClose}
          aria-label={t('Cerrar el libro')}
          data-testid="reader-close"
        >
          ←
        </button>
        <div className="reader-title">
          <strong>{book.title}</strong>
          {loc?.chapter && <span className="faint">{loc.chapter}</span>}
        </div>
        {toc.length > 0 && (
          <button
            type="button"
            className="icon-btn"
            aria-label={t('Índice')}
            data-testid="reader-toc"
            onClick={() => setPanel(panel === 'toc' ? null : 'toc')}
          >
            ☰
          </button>
        )}
        <button
          type="button"
          className="icon-btn reader-aa"
          aria-label={t('Apariencia')}
          data-testid="reader-settings"
          onClick={() => setPanel(panel === 'ajustes' ? null : 'ajustes')}
        >
          Aa
        </button>
      </header>

      <footer className="reader-bottom" data-visible={chrome}>
        <input
          type="range"
          className="reader-slider"
          min={0}
          max={1000}
          value={Math.round((loc?.fraction ?? 0) * 1000)}
          aria-label={t('Avance del libro')}
          onChange={(e) => {
            tracker.current?.touch()
            pane.current?.goToFraction(Number(e.target.value) / 1000)
          }}
          data-testid="reader-slider"
        />
        <div className="reader-status">
          <span data-testid="reader-page">{pageText}</span>
          <span className="num" data-testid="reader-percent">
            {loc ? percentLabel(loc.fraction) : ''}
          </span>
        </div>
        {remaining && (
          <div className="reader-status faint" data-testid="reader-left">
            {remaining.chapter !== null && (
              <span>
                {t('Capítulo: quedan {time}', { time: durationLabel(remaining.chapter) })}
              </span>
            )}
            {remaining.book !== null && (
              <span>{t('Libro: quedan {time}', { time: durationLabel(remaining.book) })}</span>
            )}
          </div>
        )}
        {!isMobile() && (
          <div className="reader-nav">
            <button type="button" className="btn" onClick={prev} data-testid="reader-prev">
              {t('Anterior')}
            </button>
            <button type="button" className="btn" onClick={next} data-testid="reader-next">
              {t('Siguiente')}
            </button>
          </div>
        )}
      </footer>

      {finished && (
        <div className="reader-finished" role="status" data-testid="reader-finished">
          <span>{t('¿Lo has terminado?')}</span>
          <button type="button" className="btn btn-primary" onClick={() => void markFinished()}>
            {t('Marcar como leído')}
          </button>
          <button type="button" className="btn btn-link" onClick={() => setFinishedAsked(true)}>
            {t('Todavía no')}
          </button>
        </div>
      )}

      {panel && (
        <>
          <div className="reader-scrim" onClick={() => setPanel(null)} aria-hidden="true" />
          <section
            className="reader-sheet"
            role="dialog"
            aria-label={panel === 'toc' ? t('Índice') : t('Apariencia')}
            data-testid={panel === 'toc' ? 'reader-toc-panel' : 'reader-settings-panel'}
          >
            <div className="reader-sheet-head">
              <h2>{panel === 'toc' ? t('Índice') : t('Apariencia')}</h2>
              <button
                type="button"
                className="icon-btn"
                aria-label={t('Cerrar')}
                onClick={() => setPanel(null)}
              >
                ×
              </button>
            </div>
            {panel === 'toc' ? (
              <TocList
                items={toc}
                current={loc?.chapter ?? null}
                onGo={(href) => {
                  pane.current?.goTo(href)
                  setPanel(null)
                }}
              />
            ) : (
              <div className="reader-settings">
                <div className="reader-themes" role="radiogroup" aria-label={t('Tema')}>
                  {READER_THEMES.map((th) => (
                    <button
                      key={th}
                      type="button"
                      role="radio"
                      aria-checked={prefs.theme === th}
                      className="reader-theme"
                      data-theme={th}
                      data-testid={`reader-theme-${th}`}
                      onClick={() => setPrefs({ theme: th })}
                    >
                      {t(THEME_LABELS[th])}
                    </button>
                  ))}
                </div>
                {format === 'ebook' && (
                  <>
                    <div className="segmented" role="radiogroup" aria-label={t('Tipo de letra')}>
                      {READER_FONTS.map((f) => (
                        <button
                          key={f}
                          type="button"
                          role="radio"
                          aria-checked={prefs.font === f}
                          onClick={() => setPrefs({ font: f })}
                        >
                          {t(FONT_LABELS[f])}
                        </button>
                      ))}
                    </div>
                    <Stepper
                      label={t('Tamaño')}
                      value={`${prefs.fontSize} %`}
                      onDown={() => sizeStep(-10)}
                      onUp={() => sizeStep(10)}
                      testId="reader-font-size"
                    />
                    <Stepper
                      label={t('Interlineado')}
                      value={String(prefs.lineHeight).replace('.', ',')}
                      onDown={() => lineStep(-0.1)}
                      onUp={() => lineStep(0.1)}
                      testId="reader-line-height"
                    />
                    <div className="reader-row">
                      <span>{t('Márgenes')}</span>
                      <select
                        className="input"
                        value={prefs.margin}
                        onChange={(e) => setPrefs({ margin: Number(e.target.value) })}
                        aria-label={t('Márgenes')}
                      >
                        {MARGIN_LABELS.map((l, i) => (
                          <option key={l} value={i}>
                            {t(l)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={prefs.justify}
                        onChange={(e) => setPrefs({ justify: e.target.checked })}
                      />
                      <span>{t('Texto justificado')}</span>
                    </label>
                  </>
                )}
                <div className="segmented" role="radiogroup" aria-label={t('Pasar página')}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={prefs.flow === 'paginado'}
                    onClick={() => setPrefs({ flow: 'paginado' })}
                    data-testid="reader-flow-paginado"
                  >
                    {t('Página a página')}
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={prefs.flow === 'continuo'}
                    onClick={() => setPrefs({ flow: 'continuo' })}
                    data-testid="reader-flow-continuo"
                  >
                    {t('Continuo')}
                  </button>
                </div>
                {format === 'ebook' && wide && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={prefs.spread}
                      onChange={(e) => setPrefs({ spread: e.target.checked })}
                    />
                    <span>{t('Dos páginas si caben')}</span>
                  </label>
                )}
                {format === 'pdf' && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={prefs.pdfInvert}
                      onChange={(e) => setPrefs({ pdfInvert: e.target.checked })}
                    />
                    <span>{t('Invertir los colores del PDF con los temas oscuros')}</span>
                  </label>
                )}
                <div className="reader-row">
                  <span>{t('Atenuar')}</span>
                  <input
                    type="range"
                    min={0}
                    max={70}
                    step={5}
                    value={prefs.dim}
                    aria-label={t('Atenuar')}
                    onChange={(e) => setPrefs({ dim: Number(e.target.value) })}
                  />
                </div>
                {isMobile() && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={prefs.volumeKeys}
                      onChange={(e) => setPrefs({ volumeKeys: e.target.checked })}
                    />
                    <span>{t('Pasar página con los botones de volumen')}</span>
                  </label>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
