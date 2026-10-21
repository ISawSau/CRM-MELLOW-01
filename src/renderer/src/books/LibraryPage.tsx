import { useMemo, useState } from 'react'
import { BOOK_ENTITY, FINISHED_FRACTION, type BookProgress } from '@shared/books'
import type { RecordRow } from '@shared/data/records'
import { t, tn } from '@shared/i18n'
import { DataPage } from '../data/DataPage'
import { FileThumb } from '../data/files'
import { useFields, useRecords } from '../data/hooks'
import { RecordPanel } from '../data/RecordPanel'
import { IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'
import { durationLabel, percentLabel } from './format'
import { useBookProgress, useBooksEvents, useReaderUrl, useReadingStats } from './hooks'
import { addBooks, bookFieldIds, bookFile } from './import'
import { ReadingGoalEditor } from './ReadingStats'
import { Reader, type ReaderBook } from './Reader'

type Tab = 'leyendo' | 'por-leer' | 'leido' | 'todos' | 'lista'
const TABS: { id: Tab; label: string }[] = [
  { id: 'leyendo', label: 'Leyendo' },
  { id: 'por-leer', label: 'Por leer' },
  { id: 'leido', label: 'Leídos' },
  { id: 'todos', label: 'Todos' },
  { id: 'lista', label: 'Lista' },
]
const NO_SORT = [{ fieldId: 'updatedAt', dir: 'desc' as const }]

function toBook(
  r: RecordRow,
  f: Record<string, string>,
  progress: Map<string, BookProgress>,
): ReaderBook | null {
  const file = bookFile(r, f['archivo'])
  if (!file) return null
  const author = f['autor'] ? r.values[f['autor']] : undefined
  const state = f['estado'] ? r.values[f['estado']] : undefined
  return {
    id: r.id,
    title: r.title || file.name,
    author: typeof author === 'string' && author ? author : null,
    file,
    state: typeof state === 'string' ? state : null,
    progress: progress.get(r.id) ?? null,
  }
}

function BookCard({
  book,
  onRead,
  onDetails,
}: {
  book: ReaderBook
  onRead: () => void
  onDetails: () => void
}) {
  const fraction = book.progress?.fraction ?? 0
  return (
    <li className="book-card" data-testid="book-card">
      <button
        type="button"
        className="book-open"
        onClick={onRead}
        aria-label={t('Leer {title}', { title: book.title })}
      >
        <span className="book-cover">
          <FileThumb file={book.file} className="book-cover-img" />
          <span className="book-cover-title" aria-hidden="true">
            {book.title}
          </span>
        </span>
        {book.progress && (
          <span className="book-bar" aria-hidden="true">
            <span style={{ width: `${Math.round(fraction * 100)}%` }} />
          </span>
        )}
      </button>
      <span className="book-meta">
        <span className="book-title">{book.title}</span>
        {book.author && <span className="faint book-author">{book.author}</span>}
        <span className="faint num book-pct">
          {book.state === 'leido'
            ? t('Leído')
            : book.progress
              ? percentLabel(fraction)
              : t('Sin empezar')}
        </span>
      </span>
      <button
        type="button"
        className="icon-btn book-more"
        onClick={onDetails}
        aria-label={t('Ficha de {title}', { title: book.title })}
        data-testid="book-details"
      >
        ⋯
      </button>
    </li>
  )
}

/**
 * Biblioteca (fase 15, D-123): estantería con portadas, «seguir leyendo», tu racha y el
 * objetivo del año. Tocar un libro lo abre en el lector; ⋯ abre su ficha (estado,
 * valoración, notas…). «Lista» muestra los libros con las vistas del motor de datos.
 */
export function LibraryPage({
  openRecordId,
  onOpenRecord,
}: {
  openRecordId: string | null
  onOpenRecord: (id: string | null) => void
}) {
  useBooksEvents()
  const toast = useToast()
  const fields = useFields(BOOK_ENTITY)
  const records = useRecords(BOOK_ENTITY, { filters: [], match: 'all', sorts: NO_SORT })
  const progress = useBookProgress()
  const stats = useReadingStats()
  const readerUrl = useReaderUrl()
  const [tab, setTab] = useState<Tab>('leyendo')
  const [reading, setReading] = useState<ReaderBook | null>(null)
  const [adding, setAdding] = useState<string | null>(null)

  const f = useMemo(() => bookFieldIds(fields.data ?? []), [fields.data])
  const books = useMemo(() => {
    const p = new Map((progress.data ?? []).map((x) => [x.recordId, x]))
    return (records.data ?? [])
      .map((r) => toBook(r, f, p))
      .filter((b): b is ReaderBook => b !== null)
  }, [records.data, progress.data, f])

  // Seguir leyendo: el último que has abierto y no has terminado.
  const current = useMemo(
    () =>
      [...books]
        .filter((b) => b.progress && b.progress.fraction < FINISHED_FRACTION && b.state !== 'leido')
        .sort((a, b) => (b.progress!.updatedAt > a.progress!.updatedAt ? 1 : -1))[0] ?? null,
    [books],
  )
  const shown =
    tab === 'todos' || tab === 'lista'
      ? books
      : books.filter((b) => (b.state ?? 'por-leer') === tab)
  const effectiveTab: Tab =
    tab === 'leyendo' && shown.length === 0 && books.length > 0 && !current ? 'todos' : tab

  const add = async () => {
    if (!readerUrl.data) return
    try {
      const r = await addBooks(readerUrl.data, (name) => setAdding(name))
      // Un solo aviso con todo (los avisos se sustituyen unos a otros).
      const parts: string[] = []
      if (r.added.length) parts.push(tn(r.added.length, 'Libro añadido.', '{n} libros añadidos.'))
      if (r.duplicated.length)
        parts.push(
          tn(
            r.duplicated.length,
            'Ya estaba en la biblioteca.',
            '{n} ya estaban en la biblioteca.',
          ),
        )
      if (r.skipped.length)
        parts.push(
          t('No es un libro: {names}. Formatos: PDF, EPUB, MOBI, AZW3, FB2 y CBZ.', {
            names: r.skipped.join(', '),
          }),
        )
      if (parts.length) toast.show(parts.join(' '), r.skipped.length ? 'error' : 'info')
      if (r.added.length && tab === 'leyendo' && !current) setTab('por-leer')
    } catch (e) {
      toast.show(e instanceof IpcCallError ? e.message : t('No se ha podido añadir.'), 'error')
    } finally {
      setAdding(null)
    }
  }

  const tabs = (
    <div className="tabs library-tabs" role="tablist" aria-label={t('Biblioteca')}>
      {TABS.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          aria-selected={effectiveTab === x.id}
          onClick={() => setTab(x.id)}
          data-testid={`library-tab-${x.id}`}
        >
          {t(x.label)}
          {x.id !== 'lista' && x.id !== 'todos' && (
            <span className="faint num">
              {' '}
              {books.filter((b) => (b.state ?? 'por-leer') === x.id).length}
            </span>
          )}
        </button>
      ))}
    </div>
  )

  const reader = reading && (
    <Reader key={reading.id} book={reading} onClose={() => setReading(null)} />
  )

  if (tab === 'lista')
    return (
      <div className="library-list" data-testid="page-biblioteca">
        <div className="library-switch">{tabs}</div>
        <DataPage
          entity={BOOK_ENTITY}
          num="04"
          openRecordId={openRecordId}
          onOpenRecord={onOpenRecord}
        />
        {reader}
      </div>
    )

  const s = stats.data
  return (
    <div className="data-page" data-testid="page-biblioteca">
      <div className="page library">
        <div className="section-head">
          <span className="eyebrow">
            <span className="num">04</span> {t('biblioteca')}
          </span>
          <h1 className="title">{t('Biblioteca')}</h1>
          <div className="form-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void add()}
              disabled={adding !== null || !readerUrl.data}
              data-testid="add-books"
            >
              {adding ? t('Añadiendo «{name}»…', { name: adding }) : t('+ Añadir libros')}
            </button>
          </div>
        </div>

        {s && (
          <div className="library-stats" data-testid="reading-stats">
            <span>
              <strong className="num">{s.streak}</strong>{' '}
              {tn(s.streak, 'día seguido', 'días seguidos')}
            </span>
            <span>
              {t('Hoy')}: <strong className="num">{durationLabel(s.today.seconds)}</strong>
            </span>
            <ReadingGoalEditor stats={s} />
          </div>
        )}

        {current && (
          <section className="library-current" data-testid="continue-reading">
            <button type="button" className="book-open" onClick={() => setReading(current)}>
              <span className="book-cover">
                <FileThumb file={current.file} className="book-cover-img" />
                <span className="book-cover-title" aria-hidden="true">
                  {current.title}
                </span>
              </span>
            </button>
            <div className="library-current-info">
              <span className="eyebrow">{t('seguir leyendo')}</span>
              <strong>{current.title}</strong>
              {current.author && <span className="faint">{current.author}</span>}
              {current.progress?.chapter && (
                <span className="faint">{current.progress.chapter}</span>
              )}
              <span className="book-bar" aria-hidden="true">
                <span
                  style={{ width: `${Math.round((current.progress?.fraction ?? 0) * 100)}%` }}
                />
              </span>
              <span className="faint num">{percentLabel(current.progress?.fraction ?? 0)}</span>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setReading(current)}
                data-testid="continue-button"
              >
                {t('Seguir leyendo')}
              </button>
            </div>
          </section>
        )}

        {tabs}

        {records.isSuccess && books.length === 0 ? (
          <div className="empty">
            <h2>{t('Tu biblioteca está vacía')}</h2>
            <p className="muted">
              {t(
                'Añade libros en PDF, EPUB, MOBI, AZW3, FB2 o CBZ (sin DRM). Se guardan cifrados en la bóveda y se sincronizan con tus otros equipos, también el móvil.',
              )}
            </p>
          </div>
        ) : (
          <ul className="book-grid" data-testid="book-grid">
            {(effectiveTab === tab ? shown : books).map((b) => (
              <BookCard
                key={b.id}
                book={b}
                onRead={() => setReading(b)}
                onDetails={() => onOpenRecord(b.id)}
              />
            ))}
          </ul>
        )}
      </div>
      {openRecordId && fields.data && (
        <RecordPanel
          id={openRecordId}
          fields={fields.data}
          onClose={() => onOpenRecord(null)}
          onOpen={onOpenRecord}
        />
      )}
      {reader}
    </div>
  )
}
