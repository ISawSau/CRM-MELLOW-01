import {
  BOOK_ENTITY,
  bookProgressSchema,
  readerPrefsSchema,
  readingGoalSchema,
  readingSessionSchema,
  type BookProgress,
  type BookProgressInput,
  type BookStats,
  type ReaderPrefs,
  type ReadingDay,
  type ReadingGoal,
  type ReadingSession,
  type ReadingStats,
} from '@shared/books'
import { localDateOf, shiftDate, todayIn } from '@shared/data/dates'
import type { FileRef } from '@shared/data/fields'
import { AppError } from '@shared/errors'
import type { SqliteDb } from '../db/connection'
import { CHANGES_KEY } from '../sync/sync-service'
import type { VaultService } from '../vault/vault-service'

/**
 * Biblioteca (fase 15, D-123): por dónde va cada libro, los ratos de lectura y sus
 * estadísticas. Los libros son registros de la entidad `libro` (motor de datos); esto
 * guarda lo que cambia con cada página, fuera del historial de cambios.
 */

const GOAL_KEY = 'books.goal'
const PREFS_KEY = (device: 'escritorio' | 'movil') => `books.prefs.${device}`
/** Un día cuenta para la racha con al menos un minuto de lectura. */
const STREAK_MIN_SECONDS = 60
const DAYS_SHOWN = 365

interface ProgressRow {
  record_id: string
  location: string
  fraction: number
  page: number | null
  pages: number | null
  chapter: string | null
  updated_at: string
}

export interface BooksServiceOptions {
  now?: () => Date
  onChange?: () => void
}

export class BooksService {
  constructor(
    private readonly vault: VaultService,
    private readonly opts: BooksServiceOptions = {},
  ) {}

  private get db(): SqliteDb {
    return this.vault.sqlite
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date()
  }

  private zone(): string {
    return this.vault.data.getProfile().timeZone
  }

  private read(key: string): unknown {
    const r = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return r ? JSON.parse(r.value) : undefined
  }

  private write(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), this.now().toISOString())
  }

  /** Cambio que cuenta para la sincronización entre equipos. */
  private touched(): void {
    const n = this.read(CHANGES_KEY)
    this.write(CHANGES_KEY, (typeof n === 'number' ? n : 0) + 1)
  }

  private requireBook(recordId: string): void {
    const r = this.db
      .prepare('SELECT entity FROM records WHERE id = ? AND deleted_at IS NULL')
      .get(recordId) as { entity: string } | undefined
    if (r?.entity !== BOOK_ENTITY) throw new AppError('INVALID_INPUT')
  }

  // --- Posición -----------------------------------------------------------------------

  private toProgress(r: ProgressRow): BookProgress {
    return {
      recordId: r.record_id,
      location: r.location,
      fraction: r.fraction,
      page: r.page,
      pages: r.pages,
      chapter: r.chapter,
      updatedAt: r.updated_at,
    }
  }

  progress(recordId: string): BookProgress | null {
    const r = this.db.prepare('SELECT * FROM book_progress WHERE record_id = ?').get(recordId) as
      ProgressRow | undefined
    return r ? this.toProgress(r) : null
  }

  allProgress(): BookProgress[] {
    const rows = this.db.prepare('SELECT * FROM book_progress').all() as ProgressRow[]
    return rows.map((r) => this.toProgress(r))
  }

  setProgress(input: BookProgressInput): BookProgress {
    const p = bookProgressSchema.parse(input)
    this.requireBook(p.recordId)
    const at = this.now().toISOString()
    this.db
      .prepare(
        `INSERT INTO book_progress (record_id, location, fraction, page, pages, chapter, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(record_id) DO UPDATE SET location = excluded.location,
           fraction = excluded.fraction, page = excluded.page, pages = excluded.pages,
           chapter = excluded.chapter, updated_at = excluded.updated_at`,
      )
      .run(p.recordId, p.location, p.fraction, p.page, p.pages, p.chapter, at)
    this.touched()
    this.opts.onChange?.()
    return { ...p, updatedAt: at }
  }

  /**
   * Al abrir un libro «Por leer» (o sin estado) pasa a «Leyendo» con la fecha de hoy.
   * Devuelve por dónde iba.
   */
  open(recordId: string): BookProgress | null {
    this.requireBook(recordId)
    const fields = this.fieldIds()
    const rec = this.vault.data.get(recordId)
    const state = rec.values[fields.estado]
    const patch: Record<string, unknown> = {}
    if (state === undefined || state === null || state === 'por-leer')
      patch[fields.estado] = 'leyendo'
    if (!rec.values[fields.empezado]) patch[fields.empezado] = todayIn(this.zone(), this.now())
    if (Object.keys(patch).length) this.vault.data.update(recordId, patch)
    return this.progress(recordId)
  }

  /** Terminado: estado «Leído» y la fecha de hoy (si no la tenía). */
  finish(recordId: string): void {
    this.requireBook(recordId)
    const fields = this.fieldIds()
    const rec = this.vault.data.get(recordId)
    const patch: Record<string, unknown> = { [fields.estado]: 'leido' }
    if (!rec.values[fields.terminado]) patch[fields.terminado] = todayIn(this.zone(), this.now())
    this.vault.data.update(recordId, patch)
  }

  private fieldIds(): Record<'estado' | 'empezado' | 'terminado' | 'archivo', string> {
    const byKey = new Map(this.vault.data.listFields(BOOK_ENTITY).map((f) => [f.key, f.id]))
    const get = (k: string) => {
      const id = byKey.get(k)
      if (!id) throw new AppError('INVALID_INPUT')
      return id
    }
    return {
      estado: get('estado'),
      empezado: get('empezado'),
      terminado: get('terminado'),
      archivo: get('archivo'),
    }
  }

  /**
   * Archivos de los libros (fuera de la papelera). En el móvil se bajan siempre aunque
   * pasen del límite de descarga automática: son para leerlos allí.
   */
  bookFileIds(): Set<string> {
    let archivo: string
    try {
      archivo = this.fieldIds().archivo
    } catch {
      return new Set()
    }
    const rows = this.db
      .prepare(`SELECT data FROM records WHERE entity = ? AND deleted_at IS NULL`)
      .all(BOOK_ENTITY) as { data: string }[]
    const ids = new Set<string>()
    for (const r of rows) {
      const files = (JSON.parse(r.data) as Record<string, unknown>)[archivo]
      if (Array.isArray(files)) for (const f of files as FileRef[]) ids.add(f.id)
    }
    return ids
  }

  // --- Ratos de lectura ----------------------------------------------------------------

  /** Guarda (o actualiza, mismo id) un rato de lectura. */
  saveSession(input: ReadingSession): void {
    const s = readingSessionSchema.parse(input)
    this.requireBook(s.recordId)
    if (Date.parse(s.endedAt) < Date.parse(s.startedAt)) throw new AppError('INVALID_INPUT')
    const day = localDateOf(s.startedAt, this.zone())
    this.db
      .prepare(
        `INSERT INTO reading_sessions (id, record_id, day, started_at, ended_at, seconds,
           from_fraction, to_fraction, pages)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET ended_at = excluded.ended_at, seconds = excluded.seconds,
           to_fraction = excluded.to_fraction, pages = excluded.pages
         WHERE reading_sessions.record_id = excluded.record_id`,
      )
      .run(
        s.id,
        s.recordId,
        day,
        s.startedAt,
        s.endedAt,
        s.seconds,
        s.fromFraction,
        s.toFraction,
        s.pages,
      )
    this.touched()
    this.opts.onChange?.()
  }

  // --- Objetivo y apariencia ------------------------------------------------------------

  goal(): ReadingGoal {
    const r = readingGoalSchema.safeParse(this.read(GOAL_KEY))
    return r.success ? r.data : { booksPerYear: null }
  }

  setGoal(goal: ReadingGoal): ReadingGoal {
    const g = readingGoalSchema.parse(goal)
    this.write(GOAL_KEY, g)
    this.touched()
    this.opts.onChange?.()
    return g
  }

  /** La apariencia se guarda por tipo de equipo: el móvil y el ordenador no se leen igual. */
  prefs(device: 'escritorio' | 'movil'): ReaderPrefs {
    const r = readerPrefsSchema.safeParse(this.read(PREFS_KEY(device)) ?? {})
    return r.success ? r.data : readerPrefsSchema.parse({})
  }

  setPrefs(device: 'escritorio' | 'movil', prefs: ReaderPrefs): ReaderPrefs {
    const p = readerPrefsSchema.parse(prefs)
    this.write(PREFS_KEY(device), p)
    this.touched()
    return p
  }

  // --- Estadísticas ------------------------------------------------------------------

  stats(): ReadingStats {
    const tz = this.zone()
    const today = todayIn(tz, this.now())
    const first = shiftDate(today, -(DAYS_SHOWN - 1))
    const perDay = new Map(
      (
        this.db
          .prepare(
            `SELECT day, SUM(seconds) AS seconds, SUM(pages) AS pages FROM reading_sessions
             GROUP BY day`,
          )
          .all() as { day: string; seconds: number; pages: number }[]
      ).map((r) => [r.day, r]),
    )
    const days: ReadingDay[] = []
    for (let d = first; d <= today; d = shiftDate(d, 1)) {
      const r = perDay.get(d)
      days.push({ day: d, seconds: r?.seconds ?? 0, pages: r?.pages ?? 0 })
    }

    // Racha: días seguidos con lectura hasta hoy (o hasta ayer si hoy aún no has leído).
    const read = (d: string) => (perDay.get(d)?.seconds ?? 0) >= STREAK_MIN_SECONDS
    let streak = 0
    let d = read(today) ? today : shiftDate(today, -1)
    while (read(d)) {
      streak++
      d = shiftDate(d, -1)
    }
    let bestStreak = 0
    let run = 0
    let prev: string | null = null
    for (const day of [...perDay.keys()].filter(read).sort()) {
      run = prev && shiftDate(prev, 1) === day ? run + 1 : 1
      bestStreak = Math.max(bestStreak, run)
      prev = day
    }

    const books: BookStats[] = (
      this.db
        .prepare(
          `SELECT record_id, SUM(seconds) AS seconds, COUNT(*) AS n,
             SUM(MAX(to_fraction - from_fraction, 0)) AS advanced
           FROM reading_sessions GROUP BY record_id`,
        )
        .all() as { record_id: string; seconds: number; n: number; advanced: number }[]
    ).map((r) => ({
      recordId: r.record_id,
      seconds: r.seconds,
      sessions: r.n,
      // Con menos de 5 minutos leídos no hay ritmo fiable.
      fractionPerHour: r.seconds >= 300 && r.advanced > 0 ? r.advanced / (r.seconds / 3600) : null,
    }))

    const finishedByYear: Record<string, number> = {}
    let terminado: string | null
    try {
      terminado = this.fieldIds().terminado
    } catch {
      terminado = null
    }
    if (terminado) {
      const rows = this.db
        .prepare(`SELECT data FROM records WHERE entity = ? AND deleted_at IS NULL`)
        .all(BOOK_ENTITY) as { data: string }[]
      for (const r of rows) {
        const v = (JSON.parse(r.data) as Record<string, unknown>)[terminado]
        if (typeof v === 'string' && /^\d{4}-/.test(v)) {
          const y = v.slice(0, 4)
          finishedByYear[y] = (finishedByYear[y] ?? 0) + 1
        }
      }
    }
    const year = Number(today.slice(0, 4))
    const total = this.db
      .prepare('SELECT COALESCE(SUM(seconds), 0) AS s FROM reading_sessions')
      .get() as { s: number }

    return {
      today: days.at(-1)!,
      streak,
      bestStreak: Math.max(bestStreak, streak),
      days,
      finishedByYear,
      year: { year, finished: finishedByYear[String(year)] ?? 0, goal: this.goal().booksPerYear },
      totalSeconds: total.s,
      books,
    }
  }
}
