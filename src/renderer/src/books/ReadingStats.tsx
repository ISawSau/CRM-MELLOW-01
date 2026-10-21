import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { BOOK_ENTITY, FINISHED_FRACTION, type ReadingStats } from '@shared/books'
import { t, tn } from '@shared/i18n'
import { FileThumb } from '../data/files'
import { useFields, useRecords } from '../data/hooks'
import { call } from '../lib/ipc'
import { dayLabel, durationLabel, percentLabel } from './format'
import { useBookProgress, useBooksEvents, useReadingStats } from './hooks'
import { bookFieldIds, bookFile } from './import'
import { Reader, type ReaderBook } from './Reader'

/** «3 de 24 libros en 2026», editable. */
export function ReadingGoalEditor({ stats }: { stats: ReadingStats }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const { year, finished, goal } = stats.year
  const save = async () => {
    const n = Number(value)
    await call('books:setGoal', {
      booksPerYear: Number.isInteger(n) && n > 0 ? Math.min(1000, n) : null,
    }).catch(() => {})
    await qc.invalidateQueries({ queryKey: ['books', 'stats'] })
    setEditing(false)
  }
  if (editing)
    return (
      <form
        className="reading-goal-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <label htmlFor="reading-goal">{t('Libros en {year}', { year })}</label>
        <input
          id="reading-goal"
          className="input"
          type="number"
          min={0}
          max={1000}
          inputMode="numeric"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          data-testid="reading-goal-input"
        />
        <button type="submit" className="btn" data-testid="reading-goal-save">
          {t('Guardar')}
        </button>
      </form>
    )
  return (
    <button
      type="button"
      className="btn-link reading-goal"
      onClick={() => {
        setValue(goal ? String(goal) : '')
        setEditing(true)
      }}
      data-testid="reading-goal"
    >
      {goal
        ? t('{finished} de {goal} libros en {year}', { finished, goal, year })
        : tn(
            finished,
            '{n} libro leído en {year} · poner objetivo',
            '{n} libros leídos en {year} · poner objetivo',
            { year },
          )}
    </button>
  )
}

/** Últimos 7 días: barras del tiempo leído cada día. */
export function WeekBars({ stats }: { stats: ReadingStats }) {
  const week = stats.days.slice(-7)
  const max = Math.max(...week.map((d) => d.seconds), 60)
  return (
    <div className="week-bars" role="img" aria-label={t('Tiempo leído los últimos 7 días')}>
      {week.map((d) => (
        <span
          key={d.day}
          className="week-bar"
          title={`${dayLabel(d.day)}: ${durationLabel(d.seconds)}`}
        >
          <span
            className="week-bar-fill"
            style={{ height: `${Math.round((d.seconds / max) * 100)}%` }}
          />
        </span>
      ))}
    </div>
  )
}

/** Tarjeta de Inicio: el libro que estás leyendo, tu racha y el objetivo (D-123). */
export function ReadingCard({ onNavigate }: { onNavigate: (section: string) => void }) {
  useBooksEvents()
  const stats = useReadingStats()
  const progress = useBookProgress()
  const fields = useFields(BOOK_ENTITY)
  const records = useRecords(BOOK_ENTITY, { filters: [], match: 'all', sorts: [] })
  const [reading, setReading] = useState<ReaderBook | null>(null)

  const current = useMemo(() => {
    const f = bookFieldIds(fields.data ?? [])
    const byId = new Map((records.data ?? []).map((r) => [r.id, r]))
    const p = [...(progress.data ?? [])]
      .filter((x) => x.fraction < FINISHED_FRACTION)
      .sort((a, b) => (b.updatedAt > a.updatedAt ? 1 : -1))
    for (const x of p) {
      const r = byId.get(x.recordId)
      const file = r ? bookFile(r, f['archivo']) : null
      const state = r && f['estado'] ? r.values[f['estado']] : null
      if (!r || !file || state === 'leido') continue
      const author = f['autor'] ? r.values[f['autor']] : null
      return {
        id: r.id,
        title: r.title || file.name,
        author: typeof author === 'string' ? author : null,
        file,
        state: typeof state === 'string' ? state : null,
        progress: x,
      } satisfies ReaderBook
    }
    return null
  }, [fields.data, records.data, progress.data])

  const s = stats.data
  return (
    <section className="home-card reading-card" data-testid="home-reading">
      <div className="home-card-head">
        <h2 className="home-card-title">{t('Lectura')}</h2>
        <button type="button" className="btn-link" onClick={() => onNavigate('biblioteca')}>
          {t('Ir a la biblioteca →')}
        </button>
      </div>
      {current ? (
        <div className="reading-card-book">
          <button type="button" className="book-open" onClick={() => setReading(current)}>
            <span className="book-cover book-cover-sm">
              <FileThumb file={current.file} className="book-cover-img" />
            </span>
          </button>
          <div className="reading-card-info">
            <strong>{current.title}</strong>
            {current.author && <span className="faint">{current.author}</span>}
            <span className="book-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((current.progress?.fraction ?? 0) * 100)}%` }} />
            </span>
            <span className="faint num">{percentLabel(current.progress?.fraction ?? 0)}</span>
            <button
              type="button"
              className="btn"
              onClick={() => setReading(current)}
              data-testid="home-continue"
            >
              {t('Seguir leyendo')}
            </button>
          </div>
        </div>
      ) : (
        <p className="muted">{t('Abre un libro de la Biblioteca y aquí lo tendrás a mano.')}</p>
      )}
      {s && (
        <div className="reading-card-stats">
          <span>
            <strong className="num">{s.streak}</strong>{' '}
            {tn(s.streak, 'día seguido', 'días seguidos')}
          </span>
          <span>
            {t('Hoy')}: <strong className="num">{durationLabel(s.today.seconds)}</strong>
          </span>
          <WeekBars stats={s} />
          <ReadingGoalEditor stats={s} />
        </div>
      )}
      {reading && <Reader key={reading.id} book={reading} onClose={() => setReading(null)} />}
    </section>
  )
}
