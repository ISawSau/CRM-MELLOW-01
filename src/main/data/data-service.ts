import { randomUUID } from 'node:crypto'
import { todayIn } from '@shared/data/dates'
import { ENTITIES, findEntity } from '@shared/data/entities'
import {
  COMPUTED_TYPES,
  FIELD_TYPES,
  fieldConfigSchemas,
  fieldKeySchema,
  parseFieldConfig,
  parseValue,
  slugifyKey,
  UNAVAILABLE_TYPES,
  type FieldDef,
  type FieldType,
  type RichText,
} from '@shared/data/fields'
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
import { norm, richTextToPlain } from '@shared/data/text'
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
import { AppError } from '@shared/errors'
import type { SqliteDb } from '../db/connection'
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
  timeZone?: string
  now?: () => Date
  onChange?: (change: DataChange) => void
}

const TRASH_DAYS_KEY = 'data.trashDays'
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

const sameValue = (a: unknown, b: unknown) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export class DataService {
  private readonly db: SqliteDb
  private readonly timeZone: string
  private readonly now: () => Date
  private readonly onChange: ((c: DataChange) => void) | undefined
  readonly undoStack = new UndoStack()
  private formulaCache = new Map<string, Node | FormulaError>()
  /** El campo de título de cada entidad no cambia nunca: se busca una vez. */
  private titleIds = new Map<string, string | null>()

  constructor(db: SqliteDb, opts: DataServiceOptions = {}) {
    this.db = db
    this.timeZone = opts.timeZone ?? DEFAULT_TIME_ZONE
    this.now = opts.now ?? (() => new Date())
    this.onChange = opts.onChange
    db.function('crm_norm', { deterministic: true }, (s: unknown) =>
      typeof s === 'string' ? norm(s) : s,
    )
    this.seed()
    this.purgeExpired()
  }

  private nowIso(): string {
    return this.now().toISOString()
  }

  private ctx(): FilterContext {
    return { today: todayIn(this.timeZone, this.now()), timeZone: this.timeZone }
  }

  private emit(entity: string | null): void {
    this.onChange?.({ entity })
  }

  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn)()
  }

  // --- Entidades y siembra --------------------------------------------------

  entities() {
    return ENTITIES.map((e) => ({
      id: e.id,
      label: e.label,
      singular: e.singular,
      gender: e.gender,
    }))
  }

  private requireEntity(id: string) {
    const e = findEntity(id)
    if (!e) throw new AppError('INVALID_INPUT', undefined, `No existe la entidad «${id}».`)
    return e
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

  /** Crea los campos y vistas iniciales de cada entidad, una sola vez. */
  private seed(): void {
    for (const e of ENTITIES) {
      const flag = `data.seeded.${e.id}`
      if (this.getSetting(flag)) continue
      this.tx(() => {
        const now = this.nowIso()
        const idsByKey = new Map<string, string>()
        e.fields.forEach((f, i) => {
          const id = newId()
          idsByKey.set(f.key, id)
          const config = fieldConfigSchemas[f.type].parse(f.config ?? {})
          this.db
            .prepare(
              `INSERT INTO field_defs (id, entity, key, label, type, config, position, visible, required, system, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              id,
              e.id,
              f.key,
              f.label,
              f.type,
              JSON.stringify(config),
              i,
              f.visible === false ? 0 : 1,
              f.required ? 1 : 0,
              f.system ? 1 : 0,
              now,
              now,
            )
        })
        e.views.forEach((v, i) => {
          const raw = { ...v.config } as Record<string, unknown>
          if (typeof raw['groupBy'] === 'string')
            raw['groupBy'] = idsByKey.get(raw['groupBy']) ?? null
          if (typeof raw['dateField'] === 'string')
            raw['dateField'] = idsByKey.get(raw['dateField']) ?? null
          if (Array.isArray(raw['cardFields']))
            raw['cardFields'] = (raw['cardFields'] as string[])
              .map((k) => idsByKey.get(k))
              .filter(Boolean)
          const config = viewConfigSchema.parse(raw)
          this.db
            .prepare(
              `INSERT INTO views (id, entity, name, kind, config, position, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(newId(), e.id, v.name, v.kind, JSON.stringify(config), i, now, now)
        })
        this.putSetting(flag, true)
      })
    }
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
    if (!r) throw new AppError('INVALID_INPUT', undefined, 'El campo no existe.')
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
      if (!findEntity(target))
        throw new AppError(
          'INVALID_INPUT',
          undefined,
          'La relación apunta a una entidad que no existe.',
        )
    }
    if (type === 'rollup') {
      const c = parseFieldConfig('rollup', config)
      if (!c.relationField) return
      const rel = this.getField(c.relationField)
      if (rel.entity !== entity || rel.type !== 'relation' || rel.deletedAt)
        throw new AppError(
          'INVALID_INPUT',
          undefined,
          'El resumen necesita un campo de relación de esta entidad.',
        )
      if (c.fn !== 'count') {
        if (!c.targetField)
          throw new AppError('INVALID_INPUT', undefined, 'Elige el campo que se resume.')
        const target = this.getField(c.targetField)
        const relTarget = parseFieldConfig('relation', rel.config).target
        if (
          target.entity !== relTarget ||
          !['number', 'currency', 'percent', 'rating'].includes(target.type)
        )
          throw new AppError(
            'INVALID_INPUT',
            undefined,
            'Solo se pueden resumir campos numéricos de la entidad relacionada.',
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
      return e instanceof FormulaError ? e.message : 'Error en la fórmula.'
    }
    const fields = this.listFields(entity).filter((f) => f.id !== selfId)
    const byKey = new Map(fields.map((f) => [f.key, f]))
    for (const ref of formulaReferences(ast)) {
      if (ref === selfKey) return 'Una fórmula no puede usarse a sí misma.'
      if (!byKey.has(ref)) return `No existe ningún campo «${ref}».`
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
    return visit(me, new Set()) ? 'La fórmula crea una referencia circular.' : null
  }

  createField(
    entity: string,
    input: { label: string; type: FieldType; config?: Record<string, unknown> },
  ): FieldDef {
    this.requireEntity(entity)
    if (!FIELD_TYPES.includes(input.type)) throw new AppError('INVALID_INPUT')
    const unavailable = UNAVAILABLE_TYPES[input.type]
    if (unavailable) throw new AppError('INVALID_INPUT', undefined, unavailable)
    const label = input.label.trim()
    if (!label) throw new AppError('INVALID_INPUT', undefined, 'El campo necesita un nombre.')
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
    const label = patch.label !== undefined ? patch.label.trim() : f.label
    if (!label) throw new AppError('INVALID_INPUT', undefined, 'El campo necesita un nombre.')
    let key = f.key
    if (patch.key !== undefined && patch.key !== f.key) {
      if (f.system)
        throw new AppError(
          'INVALID_INPUT',
          undefined,
          'La clave de un campo de sistema no se puede cambiar.',
        )
      key = fieldKeySchema.parse(patch.key)
      if (this.uniqueKey(f.entity, key) !== key)
        throw new AppError('INVALID_INPUT', undefined, 'Ya hay un campo con esa clave.')
    }
    const config =
      patch.config !== undefined
        ? (fieldConfigSchemas[f.type].parse(patch.config) as Record<string, unknown>)
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
        'Los campos de sistema no se pueden eliminar, solo ocultar.',
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
    if (!r) throw new AppError('INVALID_INPUT', undefined, 'La vista no existe.')
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
        name.trim() || 'Vista',
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
      .run(patch.name?.trim() || v.name, JSON.stringify(config), this.nowIso(), id)
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
      throw new AppError('INVALID_INPUT', undefined, 'Tiene que quedar al menos una vista.')
    this.db.prepare('DELETE FROM views WHERE id = ?').run(id)
    this.emit(v.entity)
  }

  // --- Lectura de registros ---------------------------------------------------

  private titleFieldId(entity: string): string | null {
    if (this.titleIds.has(entity)) return this.titleIds.get(entity)!
    const def = findEntity(entity)
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
    const linksBy = new Map<string, Map<string, string[]>>() // fieldId → fromId → toIds
    const targetIds = new Set<string>()
    const rowIds = rows.map((r) => r.id)
    if (relFields.length && rowIds.length) {
      for (const part of chunks(rowIds)) {
        const ls = this.db
          .prepare(
            `SELECT field_id, from_id, to_id FROM links WHERE field_id IN (${relFields.map(() => '?').join(',')})
             AND from_id IN (${part.map(() => '?').join(',')}) ORDER BY position`,
          )
          .all(...relFields.map((f) => f.id), ...part) as {
          field_id: string
          from_id: string
          to_id: string
        }[]
        for (const l of ls) {
          const byFrom = linksBy.get(l.field_id) ?? new Map<string, string[]>()
          linksBy.set(l.field_id, byFrom)
          byFrom.set(l.from_id, [...(byFrom.get(l.from_id) ?? []), l.to_id])
          targetIds.add(l.to_id)
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
        for (const f of order.cyclic) values[f.id] = { error: 'Referencia circular.' }
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
    if (ast instanceof FormulaError) return { error: ast.message }
    try {
      const raw = evaluate(ast, { fields: env, today })
      const c = parseFieldConfig('formula', f.config)
      if (raw === null || raw === '') return { value: null }
      if (['number', 'currency', 'percent'].includes(c.format) && typeof raw !== 'number')
        return { error: 'La fórmula no devuelve un número.' }
      return { value: raw }
    } catch (e) {
      return { error: e instanceof FormulaError ? e.message : 'Error en la fórmula.' }
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
    if (!r) throw new AppError('INVALID_INPUT', undefined, 'El registro no existe.')
    return this.hydrate([r], this.listFields(r.entity))[0]!
  }

  // --- Escritura ----------------------------------------------------------------

  private validatePatch(entity: string, patch: Values): Values {
    const fields = new Map(this.listFields(entity).map((f) => [f.id, f]))
    const out: Values = {}
    for (const [fid, raw] of Object.entries(patch)) {
      const f = fields.get(fid)
      if (!f) throw new AppError('INVALID_INPUT', undefined, 'Ese campo no existe.')
      if (COMPUTED_TYPES.includes(f.type) || f.type === 'relation' || f.type === 'files')
        throw new AppError('INVALID_INPUT', undefined, `«${f.label}» no se edita directamente.`)
      let value: unknown
      try {
        value = parseValue(f, raw)
      } catch (e) {
        throw new AppError('INVALID_INPUT', undefined, (e as Error).message)
      }
      if (f.type === 'longtext' && value) {
        const rt = value as RichText
        if (JSON.stringify(rt.doc).length > 1_000_000)
          throw new AppError('INVALID_INPUT', undefined, 'El texto es demasiado largo.')
        value = { doc: rt.doc, text: richTextToPlain(rt.doc).trim() }
      }
      if (f.required && value === null)
        throw new AppError('INVALID_INPUT', undefined, `«${f.label}» no puede quedar vacío.`)
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
    if (!row) throw new AppError('INVALID_INPUT', undefined, 'El registro no existe.')
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
    this.db.prepare('DELETE FROM search_fts WHERE record_id = ?').run(id)
    this.db.prepare('DELETE FROM records WHERE id = ?').run(id)
  }

  create(entity: string, values: Values = {}, opts: { label?: string } = {}): RecordRow {
    const def = this.requireEntity(entity)
    const titleId = this.titleFieldId(entity)
    const withTitle = { ...values }
    if (
      titleId &&
      (withTitle[titleId] === undefined || withTitle[titleId] === '' || withTitle[titleId] === null)
    )
      withTitle[titleId] = 'Sin título'
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
    const label = opts.label ?? `Crear ${def.gender === 'f' ? 'una' : 'un'} ${def.singular}`
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
      throw new AppError('INVALID_INPUT', undefined, 'El registro está en la papelera.')
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
    const fields = new Map(this.listFields(row.entity).map((f) => [f.id, f]))
    const names = Object.keys(changes).map((k) => fields.get(k)?.label ?? 'campo')
    this.undoStack.push({
      label: `Editar ${names.length === 1 ? `«${names[0]}»` : `${names.length} campos`}`,
      undo: () => apply('from'),
      redo: () => apply('to'),
    })
    this.emit(row.entity)
    return this.get(id)
  }

  setLinks(fieldId: string, fromId: string, toIds: string[]): RecordRow {
    const f = this.getField(fieldId)
    if (f.type !== 'relation' || f.deletedAt) throw new AppError('INVALID_INPUT')
    const { row } = this.storedData(fromId)
    if (row.entity !== f.entity) throw new AppError('INVALID_INPUT')
    const c = parseFieldConfig('relation', f.config)
    const unique = [...new Set(toIds)].filter((t) => t !== fromId)
    if (!c.multiple && unique.length > 1)
      throw new AppError('INVALID_INPUT', undefined, 'Esta relación admite un solo registro.')
    const targets = this.loadRows(unique)
    if (
      targets.length !== unique.length ||
      targets.some((t) => t.entity !== c.target || t.deleted_at)
    )
      throw new AppError('INVALID_INPUT', undefined, 'Algún registro enlazado no existe.')
    const before = (
      this.db
        .prepare('SELECT to_id FROM links WHERE field_id = ? AND from_id = ? ORDER BY position')
        .all(fieldId, fromId) as {
        to_id: string
      }[]
    ).map((r) => r.to_id)
    if (sameValue(before, unique)) return this.get(fromId)
    const write = (ids: string[], from: string[]) =>
      this.tx(() => {
        this.db.prepare('DELETE FROM links WHERE field_id = ? AND from_id = ?').run(fieldId, fromId)
        const ins = this.db.prepare(
          'INSERT INTO links (field_id, from_id, to_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        ids.forEach((t, i) => ins.run(fieldId, fromId, t, i, this.nowIso()))
        this.db.prepare('UPDATE records SET updated_at = ? WHERE id = ?').run(this.nowIso(), fromId)
        this.addHistory(fromId, row.entity, 'update', { [fieldId]: { from, to: ids } })
      })
    write(unique, before)
    this.undoStack.push({
      label: `Editar «${f.label}»`,
      undo: () => write(before, unique),
      redo: () => write(unique, before),
    })
    this.emit(row.entity)
    return this.get(fromId)
  }

  duplicate(id: string): RecordRow {
    const { row, data } = this.storedData(id)
    const def = this.requireEntity(row.entity)
    const titleId = this.titleFieldId(row.entity)
    const copy = { ...data }
    if (titleId) copy[titleId] = `${this.titleOf(row.entity, data)} (copia)`
    const created = this.create(row.entity, copy, {
      label: `Duplicar ${def.gender === 'f' ? 'una' : 'un'} ${def.singular}`,
    })
    // Los vínculos salientes también se copian.
    const out = this.db
      .prepare('SELECT field_id, to_id, position FROM links WHERE from_id = ?')
      .all(id) as {
      field_id: string
      to_id: string
      position: number
    }[]
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
      label: one ? 'Enviar a la papelera' : `Enviar ${rows.length} registros a la papelera`,
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
      label: 'Restaurar de la papelera',
      undo: () => set(false),
      redo: () => set(true),
    })
    for (const e of new Set(rows.map((r) => r.entity))) this.emit(e)
  }

  /** Borra para siempre registros de la papelera. No se puede deshacer. */
  purge(ids: string[]): void {
    const rows = this.loadRows(ids).filter((r) => r.deleted_at)
    this.tx(() => rows.forEach((r) => this.hardDelete(r.id)))
    for (const e of new Set(rows.map((r) => r.entity))) this.emit(e)
  }

  trashDays(): number {
    const v = this.getSetting(TRASH_DAYS_KEY)
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : DEFAULT_TRASH_DAYS
  }

  setTrashDays(days: number): void {
    this.putSetting(TRASH_DAYS_KEY, days)
    this.purgeExpired()
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
        label: fields.get(fieldId)?.label ?? 'Campo eliminado',
        from: c.from,
        to: c.to,
      })),
    }))
  }

  search(text: string, limit = 20): SearchHit[] {
    const terms = norm(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, 8)
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
      throw new AppError('UNKNOWN', undefined, 'No se pudo deshacer: el registro ya no existe.')
    }
  }

  redo(): string | null {
    try {
      const label = this.undoStack.redo()
      this.emit(null)
      return label
    } catch {
      this.undoStack.clear()
      throw new AppError('UNKNOWN', undefined, 'No se pudo rehacer: el registro ya no existe.')
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
      filename: safe(`${def.label} - ${v.name} - ${d}-${m}-${y}.csv`),
    }
  }
}
