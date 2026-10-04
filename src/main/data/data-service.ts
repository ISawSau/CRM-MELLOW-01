import { randomUUID } from 'node:crypto'
import {
  briefDocFromTemplate,
  briefTemplatesSchema,
  DEFAULT_BRIEF_TEMPLATES,
  templateFromBriefDoc,
  type BriefTemplate,
} from '@shared/data/brief-templates'
import { shiftDate, todayIn } from '@shared/data/dates'
import {
  collectionEntity,
  collectionIdFor,
  collectionInputSchema,
  collectionsSchema,
  type Collection,
  type CollectionInput,
} from '@shared/data/collections'
import { ENTITIES, findEntity, type EntityDef } from '@shared/data/entities'
import {
  COMPUTED_TYPES,
  FIELD_TYPES,
  fieldConfigSchemas,
  fieldKeySchema,
  parseFieldConfig,
  parseValue,
  slugifyKey,
  UNAVAILABLE_TYPES,
  type ChecklistItem,
  type FieldDef,
  type FileRef,
  type FieldType,
  type RichText,
} from '@shared/data/fields'
import {
  describeRecurrence,
  nextOccurrence,
  recurrenceSchema,
  type Recurrence,
} from '@shared/data/recurrence'
import {
  formulaReferences,
  parseFormula,
  evaluate,
  FormulaError,
  type FormulaValue,
  type Node,
} from '@shared/data/formula'
import type {
  ComputedValue,
  DataChange,
  HistoryEntry,
  LinkRef,
  RecordRow,
  SearchHit,
  TrashItem,
  UndoState,
} from '@shared/data/records'
import { norm, richTextToPlain, words } from '@shared/data/text'
import {
  viewConfigSchema,
  VIEW_KINDS,
  type Filter,
  type Sort,
  type View,
  type ViewConfig,
  type ViewKind,
} from '@shared/data/views'
import { DEFAULT_TIME_ZONE } from '@shared/format'
import { mimeFromName, safeFileName } from '@shared/files'
import { DEFAULT_HOME_LAYOUT, homeLayoutSchema, type HomeLayout } from '@shared/home'
import { DEFAULT_PROFILE, profileSchema, type Profile } from '@shared/profile'
import {
  elapsedHours,
  runningTimerSchema,
  timerStartSchema,
  type RunningTimer,
  type TimerStart,
} from '@shared/timer'
import {
  DEFAULT_MAIL_TEMPLATES,
  mailTemplatesSchema,
  type MailTemplate,
} from '@shared/mail-templates'
import { AppError } from '@shared/errors'
import { t, tn } from '@shared/i18n'
import type { EntityInfo, FileInfo, VersionEntry } from '@shared/ipc'
import type { SqliteDb } from '../db/connection'
import type { FileStore } from '../files/file-store'
import { toCsv } from './csv'
import {
  filterToSql,
  isValidFilter,
  jsonPath,
  matchesFilter,
  sortRows,
  type FilterContext,
} from './query'
import { UndoStack } from './undo'

/**
 * Motor de datos (SPEC §6). Vive mientras la bóveda está desbloqueada y es el único
 * que escribe en las tablas del motor. Todas las operaciones son síncronas
 * (better-sqlite3) y cada escritura va en una transacción.
 */

interface StoredRow {
  id: string
  entity: string
  data: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

interface FieldRow {
  id: string
  entity: string
  key: string
  label: string
  type: string
  config: string
  position: number
  visible: number
  required: number
  system: number
  deleted_at: string | null
}

interface ViewRow {
  id: string
  entity: string
  name: string
  kind: string
  config: string
  position: number
}

export interface DataServiceOptions {
  /** Almacén de archivos cifrados (sin él, no se pueden adjuntar archivos). */
  files?: FileStore
  timeZone?: string
  now?: () => Date
  onChange?: (change: DataChange) => void
}

const HOURLY_MS = 60 * 60 * 1000
/** El mismo ajuste que lee la sincronización (sync/sync-service.ts). */
const CHANGES_KEY = 'sync.changes'
const TRASH_DAYS_KEY = 'data.trashDays'
const PROFILE_KEY = 'profile'
const BRIEF_TEMPLATES_KEY = 'briefs.templates'
const HOME_LAYOUT_KEY = 'home.layout'
const MAIL_TEMPLATES_KEY = 'mail.templates'
const TIMER_KEY = 'timer.running'
const COLLECTIONS_KEY = 'data.collections'
export const DEFAULT_TRASH_DAYS = 30
const CHUNK = 500

type Values = Record<string, unknown>

function chunks<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

function newId(): string {
  return randomUUID()
}

export type { FileInfo, VersionEntry }

interface SpawnPlan {
  newId: string
  entity: string
  data: Record<string, unknown>
  links: { field_id: string; to_id: string; position: number }[]
  sourceId: string
  recurrenceFieldId: string
  recurrence: unknown
}

interface LinkRow {
  field_id: string
  from_id: string
  to_id: string
}

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/**
 * Campo tal y como lo ve la interfaz: el nombre y las opciones que crea la app de serie
 * («Título», «Prospecto»…) en el idioma activo. Lo que ha escrito el usuario no está en el
 * diccionario y se queda igual. En la base de datos siempre va el texto original.
 */
export function uiField(f: FieldDef): FieldDef {
  const options = f.config['options']
  const translated =
    (f.type === 'select' || f.type === 'multiselect') && Array.isArray(options)
      ? {
          config: {
            ...f.config,
            options: (options as { label: string }[]).map((o) => ({ ...o, label: t(o.label) })),
          },
        }
      : {}
  return { ...f, label: t(f.label), ...translated }
}

/** Vista tal y como la ve la interfaz (nombres de serie traducidos: «Todas», «Por tipo»…). */
export function uiView(v: View): View {
  return { ...v, name: t(v.name) }
}

/** Si la interfaz devuelve un texto de serie tal y como lo mostró (traducido), se guarda el original. */
const untranslated = (shown: string, stored: string) => (shown === t(stored) ? stored : shown)

/** Lo mismo con las etiquetas de las opciones de un campo de selección. */
function untranslatedOptions(
  f: FieldDef,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const before = f.config['options']
  const after = config['options']
  if (!Array.isArray(before) || !Array.isArray(after)) return config
  const stored = new Map((before as { id: string; label: string }[]).map((o) => [o.id, o.label]))
  return {
    ...config,
    options: (after as unknown[]).map((o) => {
      if (!o || typeof o !== 'object') return o
      const opt = o as { id?: unknown; label?: unknown }
      const label = typeof opt.id === 'string' ? stored.get(opt.id) : undefined
      return label !== undefined && typeof opt.label === 'string'
        ? { ...opt, label: untranslated(opt.label, label) }
        : o
    }),
  }
}

/** Plantillas de brief de serie, en el idioma activo. */
function defaultBriefTemplates(): BriefTemplate[] {
  return DEFAULT_BRIEF_TEMPLATES.map((tpl) => ({
    ...tpl,
    name: t(tpl.name),
    sections: tpl.sections.map((s) => ({ ...s, title: t(s.title), hint: t(s.hint) })),
    tasks: tpl.tasks.map((k) => ({ ...k, title: t(k.title) })),
  }))
}

export class DataService {
  private readonly db: SqliteDb
  private readonly timeZone: string
  private readonly now: () => Date
  private readonly onChange: ((c: DataChange) => void) | undefined
  readonly undoStack = new UndoStack()
  private formulaCache = new Map<string, Node | FormulaError>()
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly store: FileStore | undefined
  /** El campo de título de cada entidad no cambia nunca: se busca una vez. */
  private titleIds = new Map<string, string | null>()
  /** Colecciones del usuario (se leen de la bóveda una vez y tras cada cambio). */
  private collectionCache: Collection[] | null = null

  constructor(db: SqliteDb, opts: DataServiceOptions = {}) {
    this.db = db
    this.timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE
    this.now = opts.now ?? (() => new Date())
    this.onChange = opts.onChange
    this.store = opts.files
    db.function('crm_norm', { deterministic: true }, (s: unknown) =>
      typeof s === 'string' ? norm(s) : s,
    )
    this.seed()
    this.purgeExpired()
    this.processRecurrences()
    this.gcFiles()
    this.timer = setInterval(() => {
      try {
        this.processRecurrences()
        this.purgeExpired()
      } catch {
        // La base de datos puede estar cerrándose: se reintenta en la próxima vuelta.
      }
    }, HOURLY_MS)
    this.timer.unref?.()
  }

  /** Para las tareas periódicas (al bloquear la bóveda). */
  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.store?.dispose()
  }

  /** Tareas de hoy y atrasadas sin terminar (para la barra lateral y el inicio). */
  taskSummary(): { today: number; overdue: number } {
    const meta = this.recurringMeta('tarea') ?? this.dueMeta('tarea')
    if (!meta) return { today: 0, overdue: 0 }
    const today = this.ctx().today
    const done = parseFieldConfig('select', meta.status.config)
      .options.filter((o) => o.done)
      .map((o) => o.id)
    const notDone = done.length
      ? `AND (${jsonPath(meta.status)} IS NULL OR ${jsonPath(meta.status)} NOT IN (${done.map(() => '?').join(',')}))`
      : ''
    const count = (cond: string) =>
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS n FROM records WHERE entity = 'tarea' AND deleted_at IS NULL
             AND ${jsonPath(meta.due)} ${cond} ? ${notDone}`,
          )
          .get(today, ...done) as { n: number }
      ).n
    return { today: count('='), overdue: count('<') }
  }

  private dueMeta(entity: string): { due: FieldDef; status: FieldDef } | null {
    const fields = this.listFields(entity)
    const due = fields.find((f) => f.type === 'date')
    const status = fields.find(
      (f) =>
        f.type === 'select' && parseFieldConfig('select', f.config).options.some((o) => o.done),
    )
    return due && status ? { due, status } : null
  }

  private nowIso(): string {
    return this.now().toISOString()
  }

  /** Zona horaria del perfil (o la de las opciones, por defecto Europe/Madrid). */
  private zone(): string {
    const p = this.getSetting(PROFILE_KEY)
    const tz = p && typeof p === 'object' ? (p as Partial<Profile>).timeZone : undefined
    return tz ?? this.timeZone
  }

  private ctx(): FilterContext {
    const tz = this.zone()
    return { today: todayIn(tz, this.now()), timeZone: tz }
  }

  getBriefTemplates(): BriefTemplate[] {
    const r = briefTemplatesSchema.safeParse(this.getSetting(BRIEF_TEMPLATES_KEY))
    return r.success ? r.data : defaultBriefTemplates()
  }

  setBriefTemplates(templates: BriefTemplate[]): BriefTemplate[] {
    this.putSetting(BRIEF_TEMPLATES_KEY, briefTemplatesSchema.parse(templates))
    this.emit(null)
    return this.getBriefTemplates()
  }

  /**
   * Brief desde una plantilla: contenido con sus secciones, fecha de entrega y tareas
   * enlazadas al brief, con su fecha límite (fase 12).
   */
  createBriefFromTemplate(templateId: string, values: Values = {}): RecordRow {
    const tpl = this.getBriefTemplates().find((x) => x.id === templateId)
    if (!tpl) throw new AppError('INVALID_INPUT', undefined, t('Esa plantilla no existe.'))
    const bf = (k: string) => this.listFields('brief').find((f) => f.key === k)
    const tf = (k: string) => this.listFields('tarea').find((f) => f.key === k)
    const today = this.ctx().today
    const content = bf('contenido')
    const entrega = bf('entrega')
    const brief = this.create(
      'brief',
      {
        ...values,
        ...(content ? { [content.id]: briefDocFromTemplate(tpl) } : {}),
        ...(entrega && tpl.dueDays !== null ? { [entrega.id]: shiftDate(today, tpl.dueDays) } : {}),
      },
      { title: tpl.name },
    )
    const toBrief = tf('brief')
    const due = tf('fecha_limite')
    for (const k of tpl.tasks) {
      const task = this.create(
        'tarea',
        due && k.dueDays !== null ? { [due.id]: shiftDate(today, k.dueDays) } : {},
        { title: k.title },
      )
      if (toBrief) this.setLinks(toBrief.id, task.id, [brief.id])
    }
    return this.get(brief.id)
  }

  /** Guarda el contenido de un brief como plantilla nueva (sus títulos son las secciones). */
  saveBriefAsTemplate(recordId: string, name: string): BriefTemplate[] {
    const r = this.get(recordId)
    if (r.entity !== 'brief') throw new AppError('INVALID_INPUT')
    const content = this.listFields('brief').find((f) => f.key === 'contenido')
    const rich = content ? (r.values[content.id] as { doc?: unknown } | undefined) : undefined
    const tpl = templateFromBriefDoc(name, rich?.doc, () => randomUUID().slice(0, 8))
    if (!tpl.sections.length)
      throw new AppError(
        'INVALID_INPUT',
        undefined,
        t('El brief no tiene títulos: cada título del contenido se convierte en una sección.'),
      )
    return this.setBriefTemplates([...this.getBriefTemplates(), tpl])
  }

  /** Tarjetas y widgets de Inicio (fase 12). */
  /** Cronómetro en marcha (D-099), guardado en la bóveda: sobrevive a cerrar la app. */
  getTimer(): RunningTimer | null {
    const r = runningTimerSchema.safeParse(this.getSetting(TIMER_KEY))
    return r.success ? r.data : null
  }

  startTimer(input: TimerStart): RunningTimer {
    if (this.getTimer())
      throw new AppError('INVALID_INPUT', undefined, t('Ya hay un cronómetro en marcha.'))
    const timer = { ...timerStartSchema.parse(input), startedAt: this.now().toISOString() }
    this.putSetting(TIMER_KEY, timer)
    this.emit(null)
    return timer
  }

  /** Para el cronómetro y crea el registro de horas (o lo descarta si `discard`). */
  stopTimer(discard = false): RecordRow | null {
    const timer = this.getTimer()
    if (!timer) return null
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(TIMER_KEY)
    if (discard) {
      this.emit(null)
      return null
    }
    const fields = this.listFields('hora')
    const id = (k: string) => fields.find((f) => f.key === k)?.id
    const values: Values = {}
    if (id('fecha')) values[id('fecha')!] = todayIn(this.zone(), this.now())
    if (id('horas')) values[id('horas')!] = elapsedHours(timer.startedAt, this.now())
    if (id('facturable')) values[id('facturable')!] = true
    let rec = this.create('hora', values, { title: timer.description })
    if (timer.clientId && id('cliente') && this.get(timer.clientId))
      rec = this.setLinks(id('cliente')!, rec.id, [timer.clientId])
    return rec
  }

  /** Plantillas de correo (D-098). Sin guardar, las de serie en el idioma de la app. */
  getMailTemplates(): MailTemplate[] {
    const r = mailTemplatesSchema.safeParse(this.getSetting(MAIL_TEMPLATES_KEY))
    if (r.success) return r.data
    return DEFAULT_MAIL_TEMPLATES.map((m) => ({
      ...m,
      name: t(m.name),
      subject: t(m.subject),
      body: t(m.body),
    }))
  }

  setMailTemplates(list: MailTemplate[]): MailTemplate[] {
    this.putSetting(MAIL_TEMPLATES_KEY, mailTemplatesSchema.parse(list))
    this.emit(null)
    return this.getMailTemplates()
  }

  getHomeLayout(): HomeLayout {
    const r = homeLayoutSchema.safeParse(this.getSetting(HOME_LAYOUT_KEY))
    return r.success ? r.data : DEFAULT_HOME_LAYOUT
  }

  setHomeLayout(layout: HomeLayout | null): HomeLayout {
    if (layout === null) this.db.prepare('DELETE FROM settings WHERE key = ?').run(HOME_LAYOUT_KEY)
    else this.putSetting(HOME_LAYOUT_KEY, homeLayoutSchema.parse(layout))
    this.emit(null)
    return this.getHomeLayout()
  }

  getProfile(): Profile {
    const r = profileSchema.safeParse(this.getSetting(PROFILE_KEY) ?? {})
    return r.success ? r.data : DEFAULT_PROFILE
  }

  /**
   * Actividad por día del último año (mapa de actividad del Perfil, D-095): cuántos
   * cambios has hecho en tus registros (crear, editar, borrar…), según tu zona horaria.
   */
  activity(): { date: string; count: number }[] {
    const { today, timeZone } = this.ctx()
    const since = shiftDate(today, -371)
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone })
    const rows = this.db
      .prepare('SELECT at FROM history WHERE at >= ?')
      .all(`${shiftDate(since, -1)}T00:00:00`) as { at: string }[]
    const counts = new Map<string, number>()
    for (const r of rows) {
      const day = fmt.format(new Date(r.at))
      if (day >= since && day <= today) counts.set(day, (counts.get(day) ?? 0) + 1)
    }
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }))
  }

  setProfile(p: Profile): Profile {
    this.putSetting(PROFILE_KEY, profileSchema.parse(p))
    this.emit(null)
    return this.getProfile()
  }

  private emit(entity: string | null): void {
    // Contador de cambios: la sincronización sabe así si hay algo que subir.
    const n = this.getSetting(CHANGES_KEY)
    this.putSetting(CHANGES_KEY, (typeof n === 'number' ? n : 0) + 1)
    this.onChange?.({ entity, undo: this.undoStack.state() })
  }

  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  // --- Entidades y siembra --------------------------------------------------

  entities(): EntityInfo[] {
    const letters = new Map(this.collections().map((c) => [c.id, c.letter]))
    return this.allEntities().map((e) => ({
      id: e.id,
      label: t(e.label),
      singular: t(e.singular),
      gender: e.gender,
      titleKey: e.titleKey,
      custom: letters.has(e.id),
      letter: letters.get(e.id) ?? null,
    }))
  }

  /** Entidades de sistema y colecciones del usuario. */
  private allEntities(): EntityDef[] {
    return [...ENTITIES, ...this.collections().map(collectionEntity)]
  }

  private entityDef(id: string): EntityDef | undefined {
    const sys = findEntity(id)
    if (sys) return sys
    const c = this.collections().find((x) => x.id === id)
    return c ? collectionEntity(c) : undefined
  }

  private requireEntity(id: string) {
    const e = this.entityDef(id)
    if (!e)
      throw new AppError('INVALID_INPUT', undefined, t('No existe la entidad «{id}».', { id }))
    return e
  }

  // --- Colecciones personalizadas (fase 12) -----------------------------------

  collections(): Collection[] {
    if (!this.collectionCache) {
      const r = collectionsSchema.safeParse(this.getSetting(COLLECTIONS_KEY) ?? [])
      this.collectionCache = r.success ? r.data : []
    }
    return this.collectionCache
  }

  private saveCollections(list: Collection[]): void {
    this.putSetting(COLLECTIONS_KEY, list)
    this.collectionCache = null
  }

  /** Crea una colección con un campo «Nombre», otro «Notas» y la vista «Todos». */
  createCollection(input: CollectionInput): EntityInfo[] {
    const c = collectionInputSchema.parse(input)
    const list = this.collections()
    if (list.length >= 50)
      throw new AppError('INVALID_INPUT', undefined, t('Como mucho puede haber 50 colecciones.'))
    const taken = new Set([...ENTITIES.map((e) => e.id), ...list.map((x) => x.id)])
    const id = collectionIdFor(c.label, (x) => taken.has(x))
    const col: Collection = { ...c, id, createdAt: this.nowIso() }
    this.tx(() => {
      this.saveCollections([...list, col])
      this.seed([collectionEntity(col)])
    })
    this.emit(id)
    return this.entities()
  }

  updateCollection(id: string, input: CollectionInput): EntityInfo[] {
    const c = collectionInputSchema.parse(input)
    const list = this.collections()
    if (!list.some((x) => x.id === id)) throw new AppError('INVALID_INPUT')
    this.saveCollections(list.map((x) => (x.id === id ? { ...x, ...c } : x)))
    this.emit(id)
    return this.entities()
  }

  /**
   * Borra una colección vacía: sus campos, vistas y lo que tenga en la papelera. Si tiene
   * registros o la enlaza otra entidad, se explica qué hacer antes.
   */
  deleteCollection(id: string): EntityInfo[] {
    const list = this.collections()
    const col = list.find((x) => x.id === id)
    if (!col) throw new AppError('INVALID_INPUT')
    const live = this.db
      .prepare('SELECT COUNT(*) AS n FROM records WHERE entity = ? AND deleted_at IS NULL')
      .get(id) as { n: number }
    if (live.n > 0)
      throw new AppError(
        'INVALID_INPUT',
        undefined,
        tn(
          live.n,
          '«{name}» tiene {n} registro: bórralos antes (van a la papelera).',
          '«{name}» tiene {n} registros: bórralos antes (van a la papelera).',
          { name: col.label },
        ),
      )
    const refs = (
      this.db
        .prepare(
          "SELECT entity, label, config FROM field_defs WHERE entity != ? AND type = 'relation' AND deleted_at IS NULL",
        )
        .all(id) as { entity: string; label: string; config: string }[]
    ).filter((f) => (JSON.parse(f.config) as { target?: string }).target === id)
    if (refs.length)
      throw new AppError(
        'INVALID_INPUT',
        undefined,
        t('Antes quita los campos que la enlazan: {fields}.', {
          fields: refs
            .map((f) =>
              t('«{field}» de {entity}', {
                field: t(f.label),
                entity: t(this.entityDef(f.entity)?.label ?? f.entity),
              }),
            )
            .join(', '),
        }),
      )
    this.tx(() => {
      const trashed = this.db.prepare('SELECT id FROM records WHERE entity = ?').all(id) as {
        id: string
      }[]
      for (const r of trashed) this.hardDelete(r.id)
      this.db
        .prepare('DELETE FROM links WHERE field_id IN (SELECT id FROM field_defs WHERE entity = ?)')
        .run(id)
      this.db.prepare('DELETE FROM field_defs WHERE entity = ?').run(id)
      this.db.prepare('DELETE FROM views WHERE entity = ?').run(id)
      this.db.prepare('DELETE FROM settings WHERE key = ?').run(`data.seeded.${id}`)
      this.saveCollections(list.filter((x) => x.id !== id))
    })
    this.titleIds.delete(id)
    this.undoStack.clear()
    this.emit(id)
    return this.entities()
  }

  private getSetting(key: string): unknown {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined
    return row ? JSON.parse(row.value) : undefined
  }

  private putSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), this.nowIso())
  }

  /**
   * Crea los campos y vistas iniciales de cada entidad. Es incremental: la versión
   * sembrada se guarda por entidad y al abrir una bóveda antigua solo se añade lo que
   * falta (un campo cuya clave ya exista, aunque esté eliminado, no se vuelve a crear).
   * Los campos inversos van al final, cuando ya existen los campos de los que dependen.
   */
  private seed(defs: readonly EntityDef[] = ENTITIES): void {
    const seededVersion = (id: string): number => {
      const v = this.getSetting(`data.seeded.${id}`)
      return v === true ? 1 : typeof v === 'number' ? v : 0
    }
    const pending = defs.filter((e) => seededVersion(e.id) < e.seedVersion)
    if (pending.length === 0) return
    this.tx(() => {
      const now = this.nowIso()
      const keyToId = (entity: string, key: string) =>
        (
          this.db
            .prepare('SELECT id FROM field_defs WHERE entity = ? AND key = ?')
            .get(entity, key) as { id: string } | undefined
        )?.id
      const insertField = (entity: string, f: EntityDef['fields'][number]) => {
        if (keyToId(entity, f.key)) return
        const raw: Record<string, unknown> = { ...(f.config ?? {}) }
        if (f.inverse) {
          const owner = keyToId(f.inverse.entity, f.inverse.key)
          if (!owner) return
          raw['inverseOf'] = owner
        }
        const config = fieldConfigSchemas[f.type].parse(raw)
        const max = this.db
          .prepare('SELECT MAX(position) AS m FROM field_defs WHERE entity = ?')
          .get(entity) as { m: number | null }
        this.db
          .prepare(
            `INSERT INTO field_defs (id, entity, key, label, type, config, position, visible, required, system, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            newId(),
            entity,
            f.key,
            f.label,
            f.type,
            JSON.stringify(config),
            (max.m ?? -1) + 1,
            f.visible === false ? 0 : 1,
            f.required ? 1 : 0,
            f.system ? 1 : 0,
            now,
            now,
          )
      }
      const fresh = (e: EntityDef, since: number | undefined) => (since ?? 1) > seededVersion(e.id)
      for (const pass of ['direct', 'inverse'] as const)
        for (const e of pending)
          for (const f of e.fields)
            if (fresh(e, f.since) && (pass === 'inverse') === !!f.inverse) insertField(e.id, f)
      for (const e of pending) {
        e.views.forEach((v) => {
          if (!fresh(e, v.since)) return
          const raw = { ...v.config } as Record<string, unknown>
          const id = (k: unknown) => (typeof k === 'string' ? (keyToId(e.id, k) ?? null) : null)
          if (typeof raw['groupBy'] === 'string') raw['groupBy'] = id(raw['groupBy'])
          if (typeof raw['dateField'] === 'string') raw['dateField'] = id(raw['dateField'])
          if (Array.isArray(raw['cardFields']))
            raw['cardFields'] = (raw['cardFields'] as string[]).map(id).filter(Boolean)
          if (Array.isArray(raw['filters']))
            raw['filters'] = (raw['filters'] as { fieldId: string }[])
              .map((f) => ({ ...f, fieldId: id(f.fieldId) }))
              .filter((f) => f.fieldId)
          if (Array.isArray(raw['sorts']))
            raw['sorts'] = (raw['sorts'] as { fieldId: string }[])
              .map((f) => ({
                ...f,
                fieldId: ['createdAt', 'updatedAt'].includes(f.fieldId) ? f.fieldId : id(f.fieldId),
              }))
              .filter((f) => f.fieldId)
          const config = viewConfigSchema.parse(raw)
          const max = this.db
            .prepare('SELECT MAX(position) AS m FROM views WHERE entity = ?')
            .get(e.id) as { m: number | null }
          this.db
            .prepare(
              `INSERT INTO views (id, entity, name, kind, config, position, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(newId(), e.id, v.name, v.kind, JSON.stringify(config), (max.m ?? -1) + 1, now, now)
        })
        this.putSetting(`data.seeded.${e.id}`, e.seedVersion)
      }
    })
  }

  // --- Campos -----------------------------------------------------------------

  private fieldFromRow(r: FieldRow): FieldDef {
    return {
      id: r.id,
      entity: r.entity,
      key: r.key,
      label: r.label,
      type: r.type as FieldType,
      config: JSON.parse(r.config) as Record<string, unknown>,
      position: r.position,
      visible: !!r.visible,
      required: !!r.required,
      system: !!r.system,
      deletedAt: r.deleted_at,
    }
  }

  listFields(entity: string, includeDeleted = false): FieldDef[] {
    this.requireEntity(entity)
    const rows = this.db
      .prepare(
        `SELECT * FROM field_defs WHERE entity = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY position, created_at`,
      )
      .all(entity) as FieldRow[]
    return rows.map((r) => this.fieldFromRow(r))
  }

  getField(id: string): FieldDef {
    const r = this.db.prepare('SELECT * FROM field_defs WHERE id = ?').get(id) as
      FieldRow | undefined
    if (!r) throw new AppError('INVALID_INPUT', undefined, t('El campo no existe.'))
    return this.fieldFromRow(r)
  }

  private uniqueKey(entity: string, base: string): string {
    const taken = new Set(
      (
        this.db.prepare('SELECT key FROM field_defs WHERE entity = ?').all(entity) as {
          key: string
        }[]
      ).map((r) => r.key),
    )
    if (!taken.has(base)) return base
    for (let i = 2; ; i++) {
      const k = `${base.slice(0, 36)}_${i}`
      if (!taken.has(k)) return k
    }
  }

  /** Comprueba la configuración de fórmulas, resúmenes y relaciones. */
  private validateComputed(
    entity: string,
    type: FieldType,
    config: Record<string, unknown>,
    selfId?: string,
    selfKey?: string,
  ) {
    if (type === 'relation') {
      const target = String(config['target'] ?? '')
      if (!this.entityDef(target))
        throw new AppError(
          'INVALID_INPUT',
          undefined,
          t('La relación apunta a una entidad que no existe.'),
        )
      const inv = parseFieldConfig('relation', config).inverseOf
      if (inv) {
        const owner = this.getField(inv)
        const oc = owner.type === 'relation' ? parseFieldConfig('relation', owner.config) : null
        if (!oc || owner.entity !== target || oc.target !== entity || oc.inverseOf)
          throw new AppError(
            'INVALID_INPUT',
            undefined,
            t('El campo inverso no encaja con su relación.'),
          )
      }
    }
    if (type === 'rollup') {
      const c = parseFieldConfig('rollup', config)
      if (!c.relationField) return
      const rel = this.getField(c.relationField)
      if (rel.entity !== entity || rel.type !== 'relation' || rel.deletedAt)
        throw new AppError(
          'INVALID_INPUT',
          undefined,
          t('El resumen necesita un campo de relación de esta entidad.'),
        )
      if (c.fn !== 'count') {
        if (!c.targetField)
          throw new AppError('INVALID_INPUT', undefined, t('Elige el campo que se resume.'))
        const target = this.getField(c.targetField)
        const relTarget = parseFieldConfig('relation', rel.config).target
        if (
          target.entity !== relTarget ||
          !['number', 'currency', 'percent', 'rating'].includes(target.type)
        )
          throw new AppError(
            'INVALID_INPUT',
            undefined,
            t('Solo se pueden resumir campos numéricos de la entidad relacionada.'),
          )
      }
    }
    if (type === 'formula') {
      const c = parseFieldConfig('formula', config)
      const err = this.formulaProblem(entity, c.expression, selfId, selfKey)
      if (err) throw new AppError('INVALID_INPUT', undefined, err)
    }
  }

  /** Error de una fórmula (sintaxis, campos inexistentes o referencias circulares), o null. */
  formulaProblem(
    entity: string,
    expression: string,
    selfId?: string,
    selfKey?: string,
  ): string | null {
    if (expression.trim() === '') return null
    let ast: Node
    try {
      ast = parseFormula(expression)
    } catch (e) {
      return e instanceof FormulaError ? e.message : t('Error en la fórmula.')
    }
    const fields = this.listFields(entity).filter((f) => f.id !== selfId)
    const byKey = new Map(fields.map((f) => [f.key, f]))
    for (const ref of formulaReferences(ast)) {
      if (ref === selfKey) return t('Una fórmula no puede usarse a sí misma.')
      if (!byKey.has(ref)) return t('No existe ningún campo «{ref}».', { ref })
    }
    // Ciclos entre fórmulas: a → b → a.
    const graph = new Map<string, string[]>()
    for (const f of fields) {
      if (f.type !== 'formula') continue
      try {
        graph.set(f.key, [
          ...formulaReferences(
            parseFormula(parseFieldConfig('formula', f.config).expression || '0'),
          ),
        ])
      } catch {
        graph.set(f.key, [])
      }
    }
    const me = selfKey ?? '__nueva__'
    graph.set(me, [...formulaReferences(ast)])
    const seen = new Set<string>()
    const visit = (k: string, path: Set<string>): boolean => {
      if (path.has(k)) return true
      if (seen.has(k)) return false
      seen.add(k)
      path.add(k)
      for (const n of graph.get(k) ?? []) if (visit(n, path)) return true
      path.delete(k)
      return false
    }
    return visit(me, new Set()) ? t('La fórmula crea una referencia circular.') : null
  }

  createField(
    entity: string,
    input: { label: string; type: FieldType; config?: Record<string, unknown> },
  ): FieldDef {
    this.requireEntity(entity)
    if (!FIELD_TYPES.includes(input.type)) throw new AppError('INVALID_INPUT')
    const unavailable = UNAVAILABLE_TYPES[input.type]
    if (unavailable) throw new AppError('INVALID_INPUT', undefined, t(unavailable))
    const label = input.label.trim()
    if (!label) throw new AppError('INVALID_INPUT', undefined, t('El campo necesita un nombre.'))
    const config = fieldConfigSchemas[input.type].parse(input.config ?? {}) as Record<
      string,
      unknown
    >
    const key = this.uniqueKey(entity, slugifyKey(label))
    this.validateComputed(entity, input.type, config, undefined, key)
    const id = newId()
    const now = this.nowIso()
    const max = this.db
      .prepare('SELECT MAX(position) AS m FROM field_defs WHERE entity = ?')
      .get(entity) as { m: number | null }
    this.db
      .prepare(
        `INSERT INTO field_defs (id, entity, key, label, type, config, position, visible, required, system, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)`,
      )
      .run(id, entity, key, label, input.type, JSON.stringify(config), (max.m ?? -1) + 1, now, now)
    this.emit(entity)
    return this.getField(id)
  }

  /** Crea en la entidad de destino el campo que muestra esta relación desde el otro lado. */
  createInverseField(fieldId: string, label: string, multiple = true): FieldDef {
    const f = this.getField(fieldId)
    if (f.type !== 'relation' || f.deletedAt) throw new AppError('INVALID_INPUT')
    const c = parseFieldConfig('relation', f.config)
    if (c.inverseOf) throw new AppError('INVALID_INPUT')
    return this.createField(c.target, {
      label,
      type: 'relation',
      config: { target: f.entity, multiple, inverseOf: f.id },
    })
  }

  updateField(
    id: string,
    patch: {
      label?: string
      key?: string
      config?: Record<string, unknown>
      visible?: boolean
      required?: boolean
    },
  ): FieldDef {
    const f = this.getField(id)
    const label = patch.label !== undefined ? untranslated(patch.label.trim(), f.label) : f.label
    if (!label) throw new AppError('INVALID_INPUT', undefined, t('El campo necesita un nombre.'))
    let key = f.key
    if (patch.key !== undefined && patch.key !== f.key) {
      if (f.system)
        throw new AppError(
          'INVALID_INPUT',
          undefined,
          t('La clave de un campo de sistema no se puede cambiar.'),
        )
      key = fieldKeySchema.parse(patch.key)
      if (this.uniqueKey(f.entity, key) !== key)
        throw new AppError('INVALID_INPUT', undefined, t('Ya hay un campo con esa clave.'))
    }
    // En una relación no cambian ni la entidad de destino ni de qué campo es inversa.
    const fixed =
      f.type === 'relation'
        ? { target: f.config['target'], inverseOf: f.config['inverseOf'] }
        : f.type === 'select'
          ? { pipeline: f.config['pipeline'] }
          : {}
    const config =
      patch.config !== undefined
        ? (fieldConfigSchemas[f.type].parse({
            ...untranslatedOptions(f, patch.config),
            ...fixed,
          }) as Record<string, unknown>)
        : f.config
    if (patch.config !== undefined) this.validateComputed(f.entity, f.type, config, f.id, key)
    const required =
      f.system && f.key === this.requireEntity(f.entity).titleKey
        ? true
        : (patch.required ?? f.required)
    this.db
      .prepare(
        `UPDATE field_defs SET label = ?, key = ?, config = ?, visible = ?, required = ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        label,
        key,
        JSON.stringify(config),
        (patch.visible ?? f.visible) ? 1 : 0,
        required ? 1 : 0,
        this.nowIso(),
        id,
      )
    this.formulaCache.clear()
    this.emit(f.entity)
    return this.getField(id)
  }

  reorderFields(entity: string, ids: string[]): FieldDef[] {
    const fields = this.listFields(entity, true)
    const known = new Set(fields.map((f) => f.id))
    if (ids.some((i) => !known.has(i))) throw new AppError('INVALID_INPUT')
    const rest = fields.filter((f) => !ids.includes(f.id)).map((f) => f.id)
    const stmt = this.db.prepare('UPDATE field_defs SET position = ? WHERE id = ?')
    this.tx(() => [...ids, ...rest].forEach((fid, i) => stmt.run(i, fid)))
    this.emit(entity)
    return this.listFields(entity)
  }

  /** Elimina un campo de forma reversible: sus valores se conservan. */
  deleteField(id: string): void {
    const f = this.getField(id)
    if (f.system)
      throw new AppError(
        'INVALID_INPUT',
        undefined,
        t('Los campos de sistema no se pueden eliminar, solo ocultar.'),
      )
    this.db
      .prepare('UPDATE field_defs SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(this.nowIso(), this.nowIso(), id)
    this.formulaCache.clear()
    this.emit(f.entity)
  }

  restoreField(id: string): FieldDef {
    const f = this.getField(id)
    this.db
      .prepare('UPDATE field_defs SET deleted_at = NULL, updated_at = ? WHERE id = ?')
      .run(this.nowIso(), id)
    this.formulaCache.clear()
    this.emit(f.entity)
    return this.getField(id)
  }

  /** Índice sobre un campo muy usado para filtrar (SPEC §6). */
  private ensureIndex(field: FieldDef): void {
    if (
      ![
        'number',
        'currency',
        'percent',
        'rating',
        'date',
        'datetime',
        'select',
        'checkbox',
      ].includes(field.type)
    )
      return
    const name = `rec_f_${field.id.replace(/-/g, '')}`
    this.db.exec(`CREATE INDEX IF NOT EXISTS "${name}" ON records (entity, ${jsonPath(field)})`)
  }

  // --- Vistas ---------------------------------------------------------------

  private viewFromRow(r: ViewRow): View {
    return {
      id: r.id,
      entity: r.entity,
      name: r.name,
      kind: r.kind as ViewKind,
      config: viewConfigSchema.parse(JSON.parse(r.config)),
      position: r.position,
    }
  }

  listViews(entity: string): View[] {
    this.requireEntity(entity)
    return (
      this.db
        .prepare('SELECT * FROM views WHERE entity = ? ORDER BY position, created_at')
        .all(entity) as ViewRow[]
    ).map((r) => this.viewFromRow(r))
  }

  getView(id: string): View {
    const r = this.db.prepare('SELECT * FROM views WHERE id = ?').get(id) as ViewRow | undefined
    if (!r) throw new AppError('INVALID_INPUT', undefined, t('La vista no existe.'))
    return this.viewFromRow(r)
  }

  createView(entity: string, name: string, kind: ViewKind): View {
    this.requireEntity(entity)
    if (!VIEW_KINDS.includes(kind)) throw new AppError('INVALID_INPUT')
    const fields = this.listFields(entity)
    const config = viewConfigSchema.parse({
      groupBy: kind === 'kanban' ? (fields.find((f) => f.type === 'select')?.id ?? null) : null,
      dateField:
        kind === 'calendar'
          ? (fields.find((f) => f.type === 'date' || f.type === 'datetime')?.id ?? null)
          : null,
    })
    const id = newId()
    const now = this.nowIso()
    const max = this.db
      .prepare('SELECT MAX(position) AS m FROM views WHERE entity = ?')
      .get(entity) as { m: number | null }
    this.db
      .prepare(
        `INSERT INTO views (id, entity, name, kind, config, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        entity,
        name.trim() || t('Vista'),
        kind,
        JSON.stringify(config),
        (max.m ?? -1) + 1,
        now,
        now,
      )
    this.emit(entity)
    return this.getView(id)
  }

  updateView(id: string, patch: { name?: string; config?: Partial<ViewConfig> }): View {
    const v = this.getView(id)
    const config = viewConfigSchema.parse({ ...v.config, ...(patch.config ?? {}) })
    const fields = new Map(this.listFields(v.entity).map((f) => [f.id, f]))
    for (const flt of config.filters) {
      const f = fields.get(flt.fieldId)
      if (f) this.ensureIndex(f)
    }
    this.db
      .prepare('UPDATE views SET name = ?, config = ?, updated_at = ? WHERE id = ?')
      .run(
        (patch.name && untranslated(patch.name.trim(), v.name)) || v.name,
        JSON.stringify(config),
        this.nowIso(),
        id,
      )
    return this.getView(id)
  }

  deleteView(id: string): void {
    const v = this.getView(id)
    const count = (
      this.db.prepare('SELECT COUNT(*) AS n FROM views WHERE entity = ?').get(v.entity) as {
        n: number
      }
    ).n
    if (count <= 1)
      throw new AppError('INVALID_INPUT', undefined, t('Tiene que quedar al menos una vista.'))
    this.db.prepare('DELETE FROM views WHERE id = ?').run(id)
    this.emit(v.entity)
  }

  // --- Lectura de registros ---------------------------------------------------

  private titleFieldId(entity: string): string | null {
    if (this.titleIds.has(entity)) return this.titleIds.get(entity)!
    const def = this.entityDef(entity)
    const r = def
      ? (this.db
          .prepare('SELECT id FROM field_defs WHERE entity = ? AND key = ? AND system = 1')
          .get(entity, def.titleKey) as { id: string } | undefined)
      : undefined
    this.titleIds.set(entity, r?.id ?? null)
    return r?.id ?? null
  }

  private titleOf(entity: string, data: Values): string {
    const id = this.titleFieldId(entity)
    const t = id ? data[id] : null
    return typeof t === 'string' && t.trim() ? t : 'Sin título'
  }

  private loadRows(ids: string[]): StoredRow[] {
    const out: StoredRow[] = []
    for (const part of chunks(ids)) {
      out.push(
        ...(this.db
          .prepare(`SELECT * FROM records WHERE id IN (${part.map(() => '?').join(',')})`)
          .all(...part) as StoredRow[]),
      )
    }
    return out
  }

  /** Completa relaciones, resúmenes y fórmulas de un lote de registros. */
  private hydrate(rows: StoredRow[], fields: FieldDef[]): RecordRow[] {
    const data = new Map(rows.map((r) => [r.id, JSON.parse(r.data) as Values]))
    const relFields = fields.filter((f) => f.type === 'relation')
    const direct = relFields.filter((f) => !parseFieldConfig('relation', f.config).inverseOf)
    const inverse = relFields.filter((f) => parseFieldConfig('relation', f.config).inverseOf)
    const linksBy = new Map<string, Map<string, string[]>>() // fieldId → recordId → ids
    const targetIds = new Set<string>()
    const rowIds = rows.map((r) => r.id)
    const add = (fieldId: string, recordId: string, other: string) => {
      const byRecord = linksBy.get(fieldId) ?? new Map<string, string[]>()
      linksBy.set(fieldId, byRecord)
      byRecord.set(recordId, [...(byRecord.get(recordId) ?? []), other])
      targetIds.add(other)
    }
    if (rowIds.length) {
      for (const part of chunks(rowIds)) {
        const marks = part.map(() => '?').join(',')
        if (direct.length) {
          const ls = this.db
            .prepare(
              `SELECT field_id, from_id, to_id FROM links WHERE field_id IN (${direct.map(() => '?').join(',')})
               AND from_id IN (${marks}) ORDER BY position`,
            )
            .all(...direct.map((f) => f.id), ...part) as LinkRow[]
          for (const l of ls) add(l.field_id, l.from_id, l.to_id)
        }
        // Inversos: los vínculos del campo original vistos desde el otro lado.
        for (const g of inverse) {
          const owner = parseFieldConfig('relation', g.config).inverseOf!
          const ls = this.db
            .prepare(
              `SELECT field_id, from_id, to_id FROM links WHERE field_id = ? AND to_id IN (${marks})
               ORDER BY created_at, rowid`,
            )
            .all(owner, ...part) as LinkRow[]
          for (const l of ls) add(g.id, l.to_id, l.from_id)
        }
      }
    }
    const targets = new Map(
      this.loadRows([...targetIds])
        .filter((t) => !t.deleted_at)
        .map((t) => [t.id, { entity: t.entity, data: JSON.parse(t.data) as Values }]),
    )

    const formulas = fields.filter((f) => f.type === 'formula')
    const order = this.formulaOrder(formulas)
    const today = this.ctx().today
    const byId = new Map(fields.map((f) => [f.id, f]))

    return rows.map((r) => {
      const stored = data.get(r.id)!
      const values: Values = {}
      for (const f of fields) {
        if (f.type === 'relation') {
          const ids = linksBy.get(f.id)?.get(r.id) ?? []
          values[f.id] = ids
            .filter((i) => targets.has(i))
            .map((i): LinkRef => ({
              id: i,
              title: this.titleOf(targets.get(i)!.entity, targets.get(i)!.data),
            }))
        } else if (
          !COMPUTED_TYPES.includes(f.type) &&
          stored[f.id] !== undefined &&
          stored[f.id] !== null
        ) {
          values[f.id] = stored[f.id]
        }
      }
      for (const f of fields.filter((x) => x.type === 'rollup')) {
        values[f.id] = this.rollup(f, values, targets, byId)
      }
      if (formulas.length) {
        const env = new Map<string, FormulaValue>()
        for (const f of fields)
          if (f.type !== 'formula') env.set(f.key, this.toFormulaValue(f, values[f.id]))
        for (const f of order.sorted) {
          const res = this.evalFormula(f, env, today)
          values[f.id] = res
          env.set(f.key, 'value' in res ? res.value : null)
        }
        for (const f of order.cyclic) values[f.id] = { error: t('Referencia circular.') }
      }
      return {
        id: r.id,
        entity: r.entity,
        title: this.titleOf(r.entity, stored),
        values,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        deletedAt: r.deleted_at,
      }
    })
  }

  private rollup(
    f: FieldDef,
    values: Values,
    targets: Map<string, { entity: string; data: Values }>,
    byId: Map<string, FieldDef>,
  ): ComputedValue {
    const c = parseFieldConfig('rollup', f.config)
    if (!c.relationField || !byId.has(c.relationField)) return { value: null }
    const linked = (values[c.relationField] as LinkRef[] | undefined) ?? []
    if (c.fn === 'count') return { value: linked.length }
    if (!c.targetField) return { value: null }
    const nums = linked
      .map((l) => targets.get(l.id)?.data[c.targetField!])
      .filter((v): v is number => typeof v === 'number')
    if (nums.length === 0) return { value: c.fn === 'sum' ? 0 : null }
    switch (c.fn) {
      case 'sum':
        return { value: nums.reduce((a, b) => a + b, 0) }
      case 'avg':
        return { value: nums.reduce((a, b) => a + b, 0) / nums.length }
      case 'min':
        return { value: Math.min(...nums) }
      case 'max':
        return { value: Math.max(...nums) }
    }
  }

  private toFormulaValue(f: FieldDef, v: unknown): FormulaValue {
    if (v === undefined || v === null) return f.type === 'checkbox' ? false : null
    switch (f.type) {
      case 'longtext':
        return (v as RichText).text
      case 'select':
        return parseFieldConfig('select', f.config).options.find((o) => o.id === v)?.label ?? null
      case 'multiselect': {
        const opts = parseFieldConfig('multiselect', f.config).options
        return (v as string[])
          .map((id) => opts.find((o) => o.id === id)?.label)
          .filter(Boolean)
          .join(', ')
      }
      case 'relation':
        return (v as LinkRef[]).length
      case 'checklist': {
        // Fracción completada (0–1): sirve para fórmulas como SI(checklist = 1; …).
        const items = v as ChecklistItem[]
        return items.length ? items.filter((i) => i.done).length / items.length : null
      }
      case 'recurrence':
        return describeRecurrence(v as Recurrence)
      case 'files':
        return (v as FileRef[]).length
      case 'rollup':
        return 'value' in (v as ComputedValue) ? (v as { value: FormulaValue }).value : null
      default:
        return v as FormulaValue
    }
  }

  private parsedFormula(f: FieldDef): Node | FormulaError {
    const expr = parseFieldConfig('formula', f.config).expression
    const cacheKey = `${f.id}:${expr}`
    let ast = this.formulaCache.get(cacheKey)
    if (!ast) {
      try {
        ast = parseFormula(expr || '""')
      } catch (e) {
        ast = e instanceof FormulaError ? e : new FormulaError('Error en la fórmula.')
      }
      this.formulaCache.set(cacheKey, ast)
    }
    return ast
  }

  private evalFormula(f: FieldDef, env: Map<string, FormulaValue>, today: string): ComputedValue {
    const ast = this.parsedFormula(f)
    if (ast instanceof FormulaError) return { error: t(ast.message) }
    try {
      const raw = evaluate(ast, { fields: env, today })
      const c = parseFieldConfig('formula', f.config)
      if (raw === null || raw === '') return { value: null }
      if (['number', 'currency', 'percent'].includes(c.format) && typeof raw !== 'number')
        return { error: t('La fórmula no devuelve un número.') }
      return { value: raw }
    } catch (e) {
      return { error: e instanceof FormulaError ? t(e.message) : t('Error en la fórmula.') }
    }
  }

  /** Orden de evaluación de las fórmulas (las que dependen de otras, después). */
  private formulaOrder(formulas: FieldDef[]): { sorted: FieldDef[]; cyclic: FieldDef[] } {
    const byKey = new Map(formulas.map((f) => [f.key, f]))
    const deps = new Map<string, string[]>()
    for (const f of formulas) {
      const ast = this.parsedFormula(f)
      deps.set(
        f.key,
        ast instanceof FormulaError ? [] : [...formulaReferences(ast)].filter((k) => byKey.has(k)),
      )
    }
    const sorted: FieldDef[] = []
    const state = new Map<string, 'visiting' | 'done'>()
    const cyclic = new Set<string>()
    const visit = (k: string): boolean => {
      if (state.get(k) === 'done') return !cyclic.has(k)
      if (state.get(k) === 'visiting') return false
      state.set(k, 'visiting')
      let ok = true
      for (const d of deps.get(k) ?? []) if (!visit(d)) ok = false
      state.set(k, 'done')
      if (ok) sorted.push(byKey.get(k)!)
      else cyclic.add(k)
      return ok
    }
    formulas.forEach((f) => visit(f.key))
    return { sorted, cyclic: formulas.filter((f) => cyclic.has(f.key)) }
  }

  /** Registros de una entidad que cumplen los filtros, ordenados. */
  query(
    entity: string,
    opts: { filters?: Filter[]; match?: 'all' | 'any'; sorts?: Sort[] } = {},
  ): RecordRow[] {
    this.requireEntity(entity)
    const fields = this.listFields(entity)
    const byId = new Map(fields.map((f) => [f.id, f]))
    const ctx = this.ctx()
    const filters = (opts.filters ?? []).filter((f) => isValidFilter(byId.get(f.fieldId), f))
    const match = opts.match ?? 'all'

    const sqlParts: { sql: string; params: unknown[] }[] = []
    const jsFilters: Filter[] = []
    const translated = filters.map((f) => ({ f, sql: filterToSql(byId.get(f.fieldId)!, f, ctx) }))
    if (match === 'all') {
      for (const t of translated) {
        if (t.sql) sqlParts.push(t.sql)
        else jsFilters.push(t.f)
      }
    } else if (translated.every((t) => t.sql)) {
      if (translated.length)
        sqlParts.push({
          sql: `(${translated.map((t) => t.sql!.sql).join(' OR ')})`,
          params: translated.flatMap((t) => t.sql!.params),
        })
    } else {
      jsFilters.push(...filters)
    }

    const where = ['entity = ?', 'deleted_at IS NULL', ...sqlParts.map((p) => p.sql)].join(' AND ')
    const rows = this.db
      .prepare(`SELECT * FROM records WHERE ${where}`)
      .all(entity, ...sqlParts.flatMap((p) => p.params)) as StoredRow[]
    let out = this.hydrate(rows, fields)
    if (jsFilters.length) {
      out = out.filter((r) => {
        const tests = jsFilters.map((f) =>
          matchesFilter(byId.get(f.fieldId)!, r.values[f.fieldId], f, ctx),
        )
        return match === 'all' ? tests.every(Boolean) : tests.some(Boolean)
      })
    }
    return sortRows(out, opts.sorts ?? [], byId)
  }

  get(id: string): RecordRow {
    const r = this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as StoredRow | undefined
    if (!r) throw new AppError('INVALID_INPUT', undefined, t('El registro no existe.'))
    return this.hydrate([r], this.listFields(r.entity))[0]!
  }

  // --- Escritura ----------------------------------------------------------------

  private validatePatch(entity: string, patch: Values): Values {
    const fields = new Map(this.listFields(entity).map((f) => [f.id, f]))
    const out: Values = {}
    for (const [fid, raw] of Object.entries(patch)) {
      const f = fields.get(fid)
      if (!f) throw new AppError('INVALID_INPUT', undefined, t('Ese campo no existe.'))
      if (COMPUTED_TYPES.includes(f.type) || f.type === 'relation')
        throw new AppError(
          'INVALID_INPUT',
          undefined,
          t('«{field}» no se edita directamente.', { field: t(f.label) }),
        )
      let value: unknown
      try {
        value = parseValue(f, raw)
      } catch (e) {
        throw new AppError('INVALID_INPUT', undefined, t((e as Error).message))
      }
      if (f.type === 'longtext' && value) {
        const rt = value as RichText
        if (JSON.stringify(rt.doc).length > 1_000_000)
          throw new AppError('INVALID_INPUT', undefined, t('El texto es demasiado largo.'))
        value = { doc: rt.doc, text: richTextToPlain(rt.doc).trim() }
      }
      if (f.type === 'files' && value) {
        const refs = value as FileRef[]
        const known = this.db.prepare('SELECT id FROM files WHERE id = ?')
        if (refs.some((r) => !known.get(r.id)))
          throw new AppError('INVALID_INPUT', undefined, t('Algún archivo no está en la bóveda.'))
      }
      if (f.required && value === null)
        throw new AppError(
          'INVALID_INPUT',
          undefined,
          t('«{field}» no puede quedar vacío.', { field: t(f.label) }),
        )
      out[fid] = value
    }
    return out
  }

  private writeData(id: string, data: Values): void {
    const clean: Values = {}
    for (const [k, v] of Object.entries(data)) if (v !== null && v !== undefined) clean[k] = v
    this.db
      .prepare('UPDATE records SET data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(clean), this.nowIso(), id)
  }

  private addHistory(
    recordId: string,
    entity: string,
    action: HistoryEntry['action'],
    changes: Record<string, { from: unknown; to: unknown }>,
  ) {
    this.db
      .prepare(
        'INSERT INTO history (record_id, entity, at, action, changes) VALUES (?, ?, ?, ?, ?)',
      )
      .run(recordId, entity, this.nowIso(), action, JSON.stringify(changes))
  }

  /** Texto indexado para la búsqueda global: título y campos de texto. */
  private reindex(id: string): void {
    this.db.prepare('DELETE FROM search_fts WHERE record_id = ?').run(id)
    const r = this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as StoredRow | undefined
    if (!r || r.deleted_at) return
    const data = JSON.parse(r.data) as Values
    const titleId = this.titleFieldId(r.entity)
    const body: string[] = []
    for (const f of this.listFields(r.entity)) {
      const v = data[f.id]
      if (v === undefined || v === null || f.id === titleId) continue
      if (['text', 'url', 'email', 'phone'].includes(f.type)) body.push(String(v))
      else if (f.type === 'longtext') body.push((v as RichText).text)
      else if (f.type === 'checklist')
        body.push((v as ChecklistItem[]).map((i) => i.text).join('\n'))
      else if (f.type === 'files') body.push((v as FileRef[]).map((i) => i.name).join('\n'))
      else if (f.type === 'select' || f.type === 'multiselect') {
        const opts = parseFieldConfig(f.type, f.config).options
        const ids = Array.isArray(v) ? (v as string[]) : [v as string]
        body.push(ids.map((x) => opts.find((o) => o.id === x)?.label ?? '').join(' '))
      }
    }
    this.db
      .prepare('INSERT INTO search_fts (record_id, entity, title, body) VALUES (?, ?, ?, ?)')
      .run(id, r.entity, this.titleOf(r.entity, data), body.join('\n'))
  }

  private storedData(id: string): { row: StoredRow; data: Values } {
    const row = this.db.prepare('SELECT * FROM records WHERE id = ?').get(id) as
      StoredRow | undefined
    if (!row) throw new AppError('INVALID_INPUT', undefined, t('El registro no existe.'))
    return { row, data: JSON.parse(row.data) as Values }
  }

  private linksOf(
    id: string,
  ): { field_id: string; from_id: string; to_id: string; position: number }[] {
    return this.db
      .prepare(
        'SELECT field_id, from_id, to_id, position FROM links WHERE from_id = ? OR to_id = ?',
      )
      .all(id, id) as { field_id: string; from_id: string; to_id: string; position: number }[]
  }

  private insertRecord(id: string, entity: string, data: Values, createdAt: string): void {
    this.db
      .prepare(
        'INSERT INTO records (id, entity, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, entity, JSON.stringify(data), createdAt, createdAt)
  }

  private hardDelete(id: string): void {
    this.db.prepare('DELETE FROM links WHERE from_id = ? OR to_id = ?').run(id, id)
    this.db.prepare('DELETE FROM history WHERE record_id = ?').run(id)
    this.db.prepare('DELETE FROM versions WHERE record_id = ?').run(id)
    this.db.prepare('DELETE FROM search_fts WHERE record_id = ?').run(id)
    this.db.prepare('DELETE FROM records WHERE id = ?').run(id)
  }

  create(
    entity: string,
    values: Values = {},
    opts: { label?: string; title?: string } = {},
  ): RecordRow {
    const def = this.requireEntity(entity)
    const titleId = this.titleFieldId(entity)
    const withTitle = { ...values }
    if (titleId && opts.title?.trim()) withTitle[titleId] = opts.title.trim()
    // Los pipelines (estado de una tarea, etapa de un cliente…) empiezan en su primera etapa
    // y las listas con plantilla (lista de arranque de un cliente), con sus elementos.
    for (const f of this.listFields(entity)) {
      if (withTitle[f.id] !== undefined) continue
      if (f.type === 'select') {
        const c = parseFieldConfig('select', f.config)
        if (c.pipeline && c.options[0]) withTitle[f.id] = c.options[0].id
      } else if (f.type === 'checklist') {
        const items = parseFieldConfig('checklist', f.config).template ?? []
        if (items.length)
          withTitle[f.id] = items.map((text) => ({ id: newId(), text: t(text), done: false }))
      }
    }
    if (
      titleId &&
      (withTitle[titleId] === undefined || withTitle[titleId] === '' || withTitle[titleId] === null)
    )
      withTitle[titleId] = t('Sin título')
    const data = this.validatePatch(entity, withTitle)
    const id = newId()
    const createdAt = this.nowIso()
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null))
    this.tx(() => {
      this.insertRecord(id, entity, clean, createdAt)
      this.addHistory(
        id,
        entity,
        'create',
        Object.fromEntries(Object.entries(clean).map(([k, v]) => [k, { from: null, to: v }])),
      )
      this.reindex(id)
    })
    const label =
      opts.label ??
      t(def.gender === 'f' ? 'Crear una {singular}' : 'Crear un {singular}', {
        singular: t(def.singular),
      })
    this.undoStack.push({
      label,
      undo: () => this.tx(() => this.hardDelete(id)),
      redo: () =>
        this.tx(() => {
          this.insertRecord(id, entity, clean, createdAt)
          this.addHistory(id, entity, 'create', {})
          this.reindex(id)
        }),
    })
    this.emit(entity)
    return this.get(id)
  }

  update(id: string, patch: Values): RecordRow {
    const { row, data } = this.storedData(id)
    if (row.deleted_at)
      throw new AppError('INVALID_INPUT', undefined, t('El registro está en la papelera.'))
    const clean = this.validatePatch(row.entity, patch)
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const [k, v] of Object.entries(clean))
      if (!sameValue(data[k], v)) changes[k] = { from: data[k] ?? null, to: v }
    if (Object.keys(changes).length === 0) return this.get(id)
    const apply = (dir: 'from' | 'to') =>
      this.tx(() => {
        const current = this.storedData(id).data
        for (const [k, c] of Object.entries(changes)) current[k] = c[dir]
        this.writeData(id, current)
        this.addHistory(
          id,
          row.entity,
          'update',
          Object.fromEntries(
            Object.entries(changes).map(([k, c]) => [
              k,
              dir === 'to' ? c : { from: c.to, to: c.from },
            ]),
          ),
        )
        this.reindex(id)
      })
    apply('to')
    // ¿Se acaba de completar una tarea que se repite? Se crea la siguiente.
    const meta = this.recurringMeta(row.entity)
    const spawn =
      meta &&
      changes[meta.status.id] &&
      !this.isDoneValue(meta.status, changes[meta.status.id]!.from) &&
      this.isDoneValue(meta.status, changes[meta.status.id]!.to)
        ? this.planNext(id, 'completed')
        : null
    if (spawn) this.doSpawn(spawn)
    const fields = new Map(this.listFields(row.entity).map((f) => [f.id, f]))
    const names = Object.keys(changes).map((k) => t(fields.get(k)?.label ?? 'campo'))
    this.undoStack.push({
      label:
        names.length === 1
          ? t('Editar «{field}»', { field: names[0]! })
          : t('Editar {n} campos', { n: names.length }),
      undo: () => {
        if (spawn) this.undoSpawn(spawn)
        apply('from')
      },
      redo: () => {
        apply('to')
        if (spawn) this.doSpawn(spawn)
      },
    })
    this.emit(row.entity)
    return this.get(id)
  }

  // --- Versiones -------------------------------------------------------------

  listVersions(recordId: string): VersionEntry[] {
    this.storedData(recordId)
    return (
      this.db
        .prepare('SELECT * FROM versions WHERE record_id = ? ORDER BY number DESC')
        .all(recordId) as {
        id: number
        number: number
        note: string
        data: string
        created_at: string
      }[]
    ).map((v) => ({
      id: v.id,
      number: v.number,
      note: v.note,
      createdAt: v.created_at,
      data: JSON.parse(v.data) as Values,
    }))
  }

  /** Guarda el estado actual del registro como una versión nueva (v1, v2…). */
  createVersion(recordId: string, note = ''): VersionEntry {
    const { row, data } = this.storedData(recordId)
    const n =
      ((
        this.db
          .prepare('SELECT MAX(number) AS m FROM versions WHERE record_id = ?')
          .get(recordId) as {
          m: number | null
        }
      ).m ?? 0) + 1
    this.db
      .prepare(
        'INSERT INTO versions (record_id, number, note, data, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(recordId, n, note.trim().slice(0, 500), JSON.stringify(data), this.nowIso())
    this.emit(row.entity)
    return this.listVersions(recordId).find((v) => v.number === n)!
  }

  /** Vuelve a los valores de una versión (se puede deshacer como cualquier edición). */
  restoreVersion(versionId: number): RecordRow {
    const v = this.db.prepare('SELECT * FROM versions WHERE id = ?').get(versionId) as
      { record_id: string; data: string } | undefined
    if (!v) throw new AppError('INVALID_INPUT', undefined, t('La versión no existe.'))
    const { row } = this.storedData(v.record_id)
    const snapshot = JSON.parse(v.data) as Values
    const patch: Values = {}
    for (const f of this.listFields(row.entity)) {
      if (COMPUTED_TYPES.includes(f.type) || f.type === 'relation') continue
      patch[f.id] = snapshot[f.id] ?? null
    }
    const title = this.titleFieldId(row.entity)
    if (title && !patch[title]) delete patch[title]
    return this.update(v.record_id, patch)
  }

  // --- Archivos ---------------------------------------------------------------

  get files(): FileStore {
    if (!this.store)
      throw new AppError('UNKNOWN', undefined, t('Los archivos no están disponibles.'))
    return this.store
  }

  private registerFile(id: string, size: number, name: string): FileRef {
    const mime = mimeFromName(name)
    this.db
      .prepare(
        'INSERT OR IGNORE INTO files (id, size, mime, has_thumb, created_at) VALUES (?, ?, ?, 0, ?)',
      )
      .run(id, size, mime, this.nowIso())
    const row = this.fileInfo(id)!
    return { id, name: safeFileName(name), size, mime: row.mime }
  }

  /** Importa archivos del disco (elegidos por el usuario en el diálogo del sistema). */
  importFiles(paths: string[]): FileRef[] {
    return paths.map((p) => {
      const { id, size } = this.files.importPath(p)
      return this.registerFile(id, size, p.split(/[\\/]/).pop() ?? 'archivo')
    })
  }

  /** Importa un archivo que llega desde la interfaz (arrastrar y soltar). */
  importBuffer(name: string, data: Uint8Array): FileRef {
    const { id, size } = this.files.importBuffer(data)
    return this.registerFile(id, size, name)
  }

  fileInfo(id: string): FileInfo | null {
    const r = this.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as
      | {
          id: string
          size: number
          mime: string
          width: number | null
          height: number | null
          duration: number | null
          has_thumb: number
        }
      | undefined
    return r
      ? {
          id: r.id,
          size: r.size,
          mime: r.mime,
          width: r.width,
          height: r.height,
          duration: r.duration,
          hasThumb: !!r.has_thumb,
        }
      : null
  }

  /** Miniatura y medidas que calcula la interfaz al ver el archivo por primera vez. */
  setFileMeta(
    id: string,
    meta: { width?: number; height?: number; duration?: number; thumb?: Uint8Array },
  ): FileInfo {
    if (!this.fileInfo(id))
      throw new AppError('INVALID_INPUT', undefined, t('El archivo no existe.'))
    if (meta.thumb) this.files.saveThumb(id, meta.thumb)
    this.db
      .prepare(
        `UPDATE files SET width = COALESCE(?, width), height = COALESCE(?, height),
         duration = COALESCE(?, duration), has_thumb = MAX(has_thumb, ?) WHERE id = ?`,
      )
      .run(
        meta.width ?? null,
        meta.height ?? null,
        meta.duration === undefined ? null : Math.round(meta.duration),
        meta.thumb ? 1 : 0,
        id,
      )
    return this.fileInfo(id)!
  }

  /**
   * Borra los archivos que ya no usa ningún registro (ni en la papelera ni en sus
   * versiones). Los recién importados se respetan un día, por si aún no se han
   * guardado en su registro.
   */
  gcFiles(): number {
    if (!this.store) return 0
    const used = new Set<string>()
    const fileFields = this.db
      .prepare("SELECT id, entity FROM field_defs WHERE type = 'files'")
      .all() as {
      id: string
      entity: string
    }[]
    const collect = (data: Values) => {
      for (const f of fileFields) {
        const v = data[f.id]
        if (Array.isArray(v)) for (const r of v as FileRef[]) used.add(r.id)
      }
    }
    if (fileFields.length) {
      for (const r of this.db.prepare('SELECT data FROM records').iterate() as Iterable<{
        data: string
      }>)
        collect(JSON.parse(r.data) as Values)
      for (const r of this.db.prepare('SELECT data FROM versions').iterate() as Iterable<{
        data: string
      }>)
        collect(JSON.parse(r.data) as Values)
    }
    // Fondos de los temas propios (se guardan en la bóveda como cualquier archivo).
    const themes = this.getSetting('appearance.themes')
    if (Array.isArray(themes))
      for (const t of themes as { background?: { fileId?: unknown } | null }[])
        if (typeof t?.background?.fileId === 'string') used.add(t.background.fileId)
    // Miniaturas de las creatividades de Meta (fase 6).
    for (const r of this.db
      .prepare('SELECT thumb_file_id AS id FROM ad_creatives WHERE thumb_file_id IS NOT NULL')
      .iterate() as Iterable<{ id: string }>)
      used.add(r.id)
    const limit = new Date(this.now().getTime() - 86_400_000).toISOString()
    const stale = (
      this.db.prepare('SELECT id FROM files WHERE created_at < ?').all(limit) as { id: string }[]
    ).filter((r) => !used.has(r.id))
    for (const r of stale) {
      this.store.remove(r.id)
      this.db.prepare('DELETE FROM files WHERE id = ?').run(r.id)
    }
    return stale.length
  }

  // --- Repeticiones (tareas) ------------------------------------------------------

  /**
   * Campos que hacen falta para repetir registros de una entidad: el de repetición,
   * la primera fecha (la fecha límite) y el primer campo de selección con alguna
   * opción «terminada» (el estado). Null si la entidad no los tiene.
   */
  private recurringMeta(
    entity: string,
  ): { recurrence: FieldDef; due: FieldDef; status: FieldDef } | null {
    const fields = this.listFields(entity)
    const recurrence = fields.find((f) => f.type === 'recurrence')
    const due = fields.find((f) => f.type === 'date')
    const status = fields.find(
      (f) =>
        f.type === 'select' && parseFieldConfig('select', f.config).options.some((o) => o.done),
    )
    return recurrence && due && status ? { recurrence, due, status } : null
  }

  private isDoneValue(status: FieldDef, v: unknown): boolean {
    return parseFieldConfig('select', status.config).options.some((o) => o.id === v && o.done)
  }

  /**
   * Prepara la siguiente repetición de un registro. `completed`: se acaba de completar
   * (cuenta desde su fecha, nunca antes de mañana en modo «al completar»).
   * `overdue`: modo «según calendario» con la fecha ya pasada.
   */
  private planNext(id: string, why: 'completed' | 'overdue'): SpawnPlan | null {
    const { row, data } = this.storedData(id)
    const meta = this.recurringMeta(row.entity)
    if (!meta) return null
    const parsed = recurrenceSchema.safeParse(data[meta.recurrence.id])
    if (!parsed.success) return null
    const r = parsed.data
    const today = this.ctx().today
    const due = typeof data[meta.due.id] === 'string' ? (data[meta.due.id] as string) : null
    const notBefore = r.mode === 'completion' && why === 'completed' ? shiftDate(today, 1) : today
    const next = nextOccurrence(r, due ?? today, notBefore)
    const opts = parseFieldConfig('select', meta.status.config).options
    const fresh = opts.find((o) => !o.done)?.id ?? null
    const copy: Values = { ...data, [meta.due.id]: next }
    if (fresh) copy[meta.status.id] = fresh
    else delete copy[meta.status.id]
    // Las listas de comprobación empiezan sin marcar.
    for (const f of this.listFields(row.entity))
      if (f.type === 'checklist' && Array.isArray(copy[f.id]))
        copy[f.id] = (copy[f.id] as ChecklistItem[]).map((i) => ({ ...i, done: false }))
    const links = (
      this.db.prepare('SELECT field_id, to_id, position FROM links WHERE from_id = ?').all(id) as {
        field_id: string
        to_id: string
        position: number
      }[]
    ).filter(
      (l) =>
        !this.inversesOf(l.field_id).some((g) => !parseFieldConfig('relation', g.config).multiple),
    )
    return {
      newId: newId(),
      entity: row.entity,
      data: copy,
      links,
      sourceId: id,
      recurrenceFieldId: meta.recurrence.id,
      recurrence: data[meta.recurrence.id],
    }
  }

  /** Crea la repetición y le pasa la regla (la anterior ya no genera más). */
  private doSpawn(p: SpawnPlan): void {
    this.tx(() => {
      const now = this.nowIso()
      this.insertRecord(p.newId, p.entity, p.data, now)
      const ins = this.db.prepare(
        'INSERT INTO links (field_id, from_id, to_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      for (const l of p.links) ins.run(l.field_id, p.newId, l.to_id, l.position, now)
      this.addHistory(p.newId, p.entity, 'create', {})
      this.reindex(p.newId)
      const source = this.storedData(p.sourceId).data
      delete source[p.recurrenceFieldId]
      this.writeData(p.sourceId, source)
      this.addHistory(p.sourceId, p.entity, 'update', {
        [p.recurrenceFieldId]: { from: p.recurrence, to: null },
      })
    })
  }

  private undoSpawn(p: SpawnPlan): void {
    this.tx(() => {
      this.hardDelete(p.newId)
      const source = this.storedData(p.sourceId).data
      source[p.recurrenceFieldId] = p.recurrence
      this.writeData(p.sourceId, source)
      this.addHistory(p.sourceId, p.entity, 'update', {
        [p.recurrenceFieldId]: { from: null, to: p.recurrence },
      })
    })
  }

  /**
   * Repeticiones «según calendario»: si la fecha de una tarea pendiente ya pasó, se
   * crea la siguiente (desde hoy). Se llama al abrir la bóveda y cada hora.
   * Devuelve cuántas se han creado.
   */
  processRecurrences(): number {
    let created = 0
    for (const e of this.allEntities()) {
      const meta = this.recurringMeta(e.id)
      if (!meta) continue
      const today = this.ctx().today
      const rows = this.db
        .prepare(
          `SELECT id, data FROM records WHERE entity = ? AND deleted_at IS NULL
           AND ${jsonPath(meta.recurrence)} IS NOT NULL AND ${jsonPath(meta.due)} < ?`,
        )
        .all(e.id, today) as { id: string; data: string }[]
      for (const r of rows) {
        const data = JSON.parse(r.data) as Values
        const rule = recurrenceSchema.safeParse(data[meta.recurrence.id])
        if (!rule.success || rule.data.mode !== 'schedule') continue
        if (this.isDoneValue(meta.status, data[meta.status.id])) continue
        const plan = this.planNext(r.id, 'overdue')
        if (plan) {
          this.doSpawn(plan)
          created++
        }
      }
      if (created) this.emit(e.id)
    }
    return created
  }

  /** Campos inversos de un campo de relación (los que lo muestran desde el otro lado). */
  private inversesOf(fieldId: string): FieldDef[] {
    return (
      this.db
        .prepare("SELECT * FROM field_defs WHERE type = 'relation' AND deleted_at IS NULL")
        .all() as FieldRow[]
    )
      .map((r) => this.fieldFromRow(r))
      .filter((g) => parseFieldConfig('relation', g.config).inverseOf === fieldId)
  }

  /**
   * Cambia los registros enlazados de un campo de relación (directo o inverso).
   * Los vínculos se guardan una sola vez, con el campo directo: un campo inverso
   * escribe en los del campo original. Si el otro lado admite un solo registro (un
   * contacto pertenece a un cliente), enlazarlo aquí lo desengancha del anterior.
   */
  setLinks(fieldId: string, recordId: string, toIds: string[]): RecordRow {
    const f = this.getField(fieldId)
    if (f.type !== 'relation' || f.deletedAt) throw new AppError('INVALID_INPUT')
    const { row } = this.storedData(recordId)
    if (row.entity !== f.entity) throw new AppError('INVALID_INPUT')
    const c = parseFieldConfig('relation', f.config)
    const unique = [...new Set(toIds)].filter((t) => t !== recordId)
    if (!c.multiple && unique.length > 1)
      throw new AppError('INVALID_INPUT', undefined, t('Esta relación admite un solo registro.'))
    const targets = this.loadRows(unique)
    if (
      targets.length !== unique.length ||
      targets.some((t) => t.entity !== c.target || t.deleted_at)
    )
      throw new AppError('INVALID_INPUT', undefined, t('Algún registro enlazado no existe.'))

    const isInverse = !!c.inverseOf
    const owner = isInverse ? this.getField(c.inverseOf!) : f
    // ¿El otro lado admite un solo registro?
    const otherSingle = isInverse
      ? !parseFieldConfig('relation', owner.config).multiple
      : this.inversesOf(f.id).some((g) => !parseFieldConfig('relation', g.config).multiple)

    const current = (): string[] =>
      (isInverse
        ? (this.db
            .prepare(
              'SELECT from_id AS id FROM links WHERE field_id = ? AND to_id = ? ORDER BY created_at, rowid',
            )
            .all(owner.id, recordId) as { id: string }[])
        : (this.db
            .prepare(
              'SELECT to_id AS id FROM links WHERE field_id = ? AND from_id = ? ORDER BY position',
            )
            .all(owner.id, recordId) as { id: string }[])
      ).map((r) => r.id)
    const before = current()
    if (sameValue(before, unique)) return this.get(recordId)

    // Todos los vínculos que este cambio puede tocar, para deshacer con exactitud.
    const touched = [recordId, ...new Set([...before, ...unique])]
    const marks = touched.map(() => '?').join(',')
    const snapshot = () =>
      this.db
        .prepare(
          `SELECT field_id, from_id, to_id, position, created_at FROM links
           WHERE field_id = ? AND (from_id IN (${marks}) OR to_id IN (${marks}))`,
        )
        .all(owner.id, ...touched, ...touched) as (LinkRow & {
        position: number
        created_at: string
      })[]
    const restore = (rows: ReturnType<typeof snapshot>, from: string[], to: string[]) =>
      this.tx(() => {
        this.db
          .prepare(
            `DELETE FROM links WHERE field_id = ? AND (from_id IN (${marks}) OR to_id IN (${marks}))`,
          )
          .run(owner.id, ...touched, ...touched)
        const ins = this.db.prepare(
          'INSERT INTO links (field_id, from_id, to_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        for (const l of rows) ins.run(l.field_id, l.from_id, l.to_id, l.position, l.created_at)
        this.db
          .prepare('UPDATE records SET updated_at = ? WHERE id = ?')
          .run(this.nowIso(), recordId)
        this.addHistory(recordId, row.entity, 'update', { [f.id]: { from, to } })
      })

    const prev = snapshot()
    this.tx(() => {
      const now = this.nowIso()
      const ins = this.db.prepare(
        'INSERT INTO links (field_id, from_id, to_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      if (isInverse) {
        this.db
          .prepare('DELETE FROM links WHERE field_id = ? AND to_id = ?')
          .run(owner.id, recordId)
        for (const t of unique) {
          if (otherSingle)
            this.db.prepare('DELETE FROM links WHERE field_id = ? AND from_id = ?').run(owner.id, t)
          const n = (
            this.db
              .prepare('SELECT COUNT(*) AS n FROM links WHERE field_id = ? AND from_id = ?')
              .get(owner.id, t) as { n: number }
          ).n
          ins.run(owner.id, t, recordId, n, now)
        }
      } else {
        this.db
          .prepare('DELETE FROM links WHERE field_id = ? AND from_id = ?')
          .run(owner.id, recordId)
        unique.forEach((t, i) => {
          if (otherSingle)
            this.db.prepare('DELETE FROM links WHERE field_id = ? AND to_id = ?').run(owner.id, t)
          ins.run(owner.id, recordId, t, i, now)
        })
      }
      this.db.prepare('UPDATE records SET updated_at = ? WHERE id = ?').run(now, recordId)
      this.addHistory(recordId, row.entity, 'update', { [f.id]: { from: before, to: unique } })
    })
    const next = snapshot()
    this.undoStack.push({
      label: t('Editar «{field}»', { field: t(f.label) }),
      undo: () => restore(prev, unique, before),
      redo: () => restore(next, before, unique),
    })
    this.emit(null)
    return this.get(recordId)
  }

  duplicate(id: string): RecordRow {
    const { row, data } = this.storedData(id)
    const def = this.requireEntity(row.entity)
    const titleId = this.titleFieldId(row.entity)
    const copy = { ...data }
    if (titleId) copy[titleId] = t('{title} (copia)', { title: this.titleOf(row.entity, data) })
    const created = this.create(row.entity, copy, {
      label: t(def.gender === 'f' ? 'Duplicar una {singular}' : 'Duplicar un {singular}', {
        singular: t(def.singular),
      }),
    })
    // Los vínculos salientes también se copian.
    // (salvo los de relaciones cuyo otro lado admite un solo registro: no se pueden repetir).
    const out = (
      this.db.prepare('SELECT field_id, to_id, position FROM links WHERE from_id = ?').all(id) as {
        field_id: string
        to_id: string
        position: number
      }[]
    ).filter(
      (l) =>
        !this.inversesOf(l.field_id).some((g) => !parseFieldConfig('relation', g.config).multiple),
    )
    if (out.length) {
      const ins = this.db.prepare(
        'INSERT INTO links (field_id, from_id, to_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
      )
      this.tx(() =>
        out.forEach((l) => ins.run(l.field_id, created.id, l.to_id, l.position, this.nowIso())),
      )
    }
    return this.get(created.id)
  }

  /** Envía a la papelera (restaurable durante los días configurados). */
  trash(ids: string[]): void {
    const rows = this.loadRows(ids).filter((r) => !r.deleted_at)
    if (rows.length === 0) return
    const at = this.nowIso()
    const setDeleted = (deleted: boolean) =>
      this.tx(() => {
        for (const r of rows) {
          const res = this.db
            .prepare('UPDATE records SET deleted_at = ? WHERE id = ?')
            .run(deleted ? at : null, r.id)
          if (res.changes === 0) throw new Error('El registro ya no existe.')
          this.addHistory(r.id, r.entity, deleted ? 'delete' : 'restore', {})
          this.reindex(r.id)
        }
      })
    setDeleted(true)
    const one = rows.length === 1
    this.undoStack.push({
      label: one
        ? t('Enviar a la papelera')
        : t('Enviar {n} registros a la papelera', { n: rows.length }),
      undo: () => setDeleted(false),
      redo: () => setDeleted(true),
    })
    for (const e of new Set(rows.map((r) => r.entity))) this.emit(e)
  }

  restore(ids: string[]): void {
    const rows = this.loadRows(ids).filter((r) => r.deleted_at)
    if (rows.length === 0) return
    const deletedAt = new Map(rows.map((r) => [r.id, r.deleted_at]))
    const set = (restore: boolean) =>
      this.tx(() => {
        for (const r of rows) {
          const res = this.db
            .prepare('UPDATE records SET deleted_at = ? WHERE id = ?')
            .run(restore ? null : deletedAt.get(r.id), r.id)
          if (res.changes === 0) throw new Error('El registro ya no existe.')
          this.addHistory(r.id, r.entity, restore ? 'restore' : 'delete', {})
          this.reindex(r.id)
        }
      })
    set(true)
    this.undoStack.push({
      label: t('Restaurar de la papelera'),
      undo: () => set(false),
      redo: () => set(true),
    })
    for (const e of new Set(rows.map((r) => r.entity))) this.emit(e)
  }

  /** Borra para siempre registros de la papelera. No se puede deshacer. */
  purge(ids: string[]): void {
    const rows = this.loadRows(ids).filter((r) => r.deleted_at)
    this.tx(() => rows.forEach((r) => this.hardDelete(r.id)))
    this.gcFiles()
    for (const e of new Set(rows.map((r) => r.entity))) this.emit(e)
  }

  trashDays(): number {
    const v = this.getSetting(TRASH_DAYS_KEY)
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : DEFAULT_TRASH_DAYS
  }

  setTrashDays(days: number): void {
    this.putSetting(TRASH_DAYS_KEY, days)
    this.purgeExpired()
    this.emit(null)
  }

  listTrash(entity?: string): TrashItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM records WHERE deleted_at IS NOT NULL ${entity ? 'AND entity = ?' : ''} ORDER BY deleted_at DESC`,
      )
      .all(...(entity ? [entity] : [])) as StoredRow[]
    const days = this.trashDays()
    const now = this.now().getTime()
    return rows.map((r) => ({
      id: r.id,
      entity: r.entity,
      title: this.titleOf(r.entity, JSON.parse(r.data) as Values),
      deletedAt: r.deleted_at!,
      daysLeft: Math.max(0, Math.ceil(days - (now - Date.parse(r.deleted_at!)) / 86_400_000)),
    }))
  }

  /** Vacía lo que lleva en la papelera más días de los configurados. */
  purgeExpired(): number {
    const limit = new Date(this.now().getTime() - this.trashDays() * 86_400_000).toISOString()
    const ids = (
      this.db
        .prepare('SELECT id FROM records WHERE deleted_at IS NOT NULL AND deleted_at < ?')
        .all(limit) as { id: string }[]
    ).map((r) => r.id)
    if (ids.length) this.tx(() => ids.forEach((id) => this.hardDelete(id)))
    return ids.length
  }

  // --- Historial y búsqueda -------------------------------------------------

  history(id: string): HistoryEntry[] {
    const { row } = this.storedData(id)
    const fields = new Map(this.listFields(row.entity, true).map((f) => [f.id, f]))
    const rows = this.db
      .prepare('SELECT * FROM history WHERE record_id = ? ORDER BY at DESC, id DESC LIMIT 500')
      .all(id) as { id: number; at: string; action: string; changes: string }[]
    return rows.map((h) => ({
      id: h.id,
      at: h.at,
      action: h.action as HistoryEntry['action'],
      changes: Object.entries(
        JSON.parse(h.changes) as Record<string, { from: unknown; to: unknown }>,
      ).map(([fieldId, c]) => ({
        fieldId,
        label: t(fields.get(fieldId)?.label ?? 'Campo eliminado'),
        from: c.from,
        to: c.to,
      })),
    }))
  }

  search(text: string, limit = 20): SearchHit[] {
    const terms = words(norm(text)).slice(0, 8)
    if (terms.length === 0) return []
    // Cada palabra como prefijo, entre comillas para que FTS5 no la interprete.
    const match = terms.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ')
    const rows = this.db
      .prepare(
        `SELECT record_id, entity, title, snippet(search_fts, 3, '', '', '…', 12) AS snip
         FROM search_fts WHERE search_fts MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, Math.min(Math.max(limit, 1), 100)) as {
      record_id: string
      entity: string
      title: string
      snip: string
    }[]
    return rows.map((r) => ({ id: r.record_id, entity: r.entity, title: r.title, snippet: r.snip }))
  }

  // --- Deshacer, rehacer y exportar -------------------------------------------

  undo(): string | null {
    try {
      const label = this.undoStack.undo()
      this.emit(null)
      return label
    } catch {
      this.undoStack.clear()
      throw new AppError('UNKNOWN', undefined, t('No se pudo deshacer: el registro ya no existe.'))
    }
  }

  redo(): string | null {
    try {
      const label = this.undoStack.redo()
      this.emit(null)
      return label
    } catch {
      this.undoStack.clear()
      throw new AppError('UNKNOWN', undefined, t('No se pudo rehacer: el registro ya no existe.'))
    }
  }

  undoState(): UndoState {
    return this.undoStack.state()
  }

  /** CSV de una vista: sus filtros, su orden y sus columnas visibles. */
  exportCsv(viewId: string): { csv: string; filename: string } {
    const v = this.getView(viewId)
    const def = this.requireEntity(v.entity)
    const fields = this.listFields(v.entity)
    const byId = new Map(fields.map((f) => [f.id, f]))
    const ordered = [
      ...v.config.columns
        .filter((c) => c.visible && byId.has(c.fieldId))
        .map((c) => byId.get(c.fieldId)!),
      ...fields.filter((f) => f.visible && !v.config.columns.some((c) => c.fieldId === f.id)),
    ]
    const rows = this.query(v.entity, v.config)
    const [y, m, d] = this.ctx().today.split('-')
    const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-')
    return {
      csv: toCsv(ordered, rows),
      filename: safe(`${t(def.label)} - ${t(v.name)} - ${d}-${m}-${y}.csv`),
    }
  }
}
