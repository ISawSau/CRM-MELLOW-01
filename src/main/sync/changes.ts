import type { Statement } from 'better-sqlite3'
import type { SqliteDb } from '../db/connection'

/**
 * Registro de cambios por fila para la sincronización (D-125). Cada escritura en una tabla
 * sincronizada deja su fila en `sync_outbox` (lo que falta por subir) y su reloj en
 * `sync_rows` (quién la cambió por última vez). Lo hacen disparadores TEMP: viven solo en
 * esta conexión, así que no van dentro de la base de datos ni ven las migraciones, y la
 * siembra de serie (que cada equipo hace igual) tampoco cuenta como cambio.
 *
 * Al aplicar los cambios de otro equipo gana el más reciente de cada fila (reloj híbrido:
 * milisegundos que nunca retroceden, y el id del equipo si empatan).
 */

/** Valor de una celda tal como viaja (los BLOB, en base64). */
export type Cell = string | number | null | { $b: string }

export interface PackRow {
  /** Tabla. */
  t: string
  /** Identidad de la fila (los valores de sus columnas clave). */
  k: (string | number | null)[]
  ts: number
  /** Equipo que hizo el cambio. */
  d: string
  /** Fila borrada. */
  del?: 1
  /** Columnas de la fila. */
  v?: Record<string, Cell>
}

export interface AppliedChanges {
  tables: Set<string>
  /** Ajustes tocados (por su clave). */
  settings: Set<string>
  /** Registros (tabla `records`) tocados: hay que reindexar su búsqueda. */
  records: Set<string>
  /** Filas que no se han podido aplicar (por ejemplo, una regla de unicidad). */
  skipped: number
}

interface TableInfo {
  name: string
  cols: string[]
  identity: string[]
  /** Columna id autonumérica que no viaja (su identidad son otras columnas). */
  surrogate: string | null
}

/** Tablas que nunca se sincronizan: internas, índice de búsqueda y cola de Meta del equipo. */
const SKIP_PREFIXES = ['sqlite_', '__drizzle', 'search_fts', 'sync_']
const LOCAL_TABLES = new Set(['ad_jobs'])
/**
 * Tablas con id autonumérico: dos equipos darían el mismo número a filas distintas, así
 * que se identifican por sus columnas naturales.
 */
const NATURAL_IDENTITY: Record<string, string[]> = {
  history: ['record_id', 'at', 'action'],
  versions: ['record_id', 'number'],
  alert_events: ['alert_id', 'until'],
}
/** Ajustes de cada equipo (su destino, su estado de sincronización, sus copias). */
const LOCAL_SETTING = (ref: 'NEW' | 'OLD') =>
  `${ref}."key" NOT LIKE 'sync.%' AND ${ref}."key" <> 'backups.last'`
const isLocalSetting = (key: string) => key.startsWith('sync.') || key === 'backups.last'
/**
 * Columnas que solo dicen cuándo se escribió la fila (D-131). Si una actualización solo
 * cambia estas, el contenido es el mismo y no se apunta para subir: así volver a bajar de
 * Meta los mismos datos (o guardar la misma página del libro) no gasta red.
 */
const VOLATILE = new Set(['fetched_at', 'synced_at', 'updated_at'])
/** Tablas que no se juntan al cambiar de instantánea: lo de Meta se vuelve a bajar. */
const MERGE_SKIP = ['ad_', 'fx_rates']

const q = (name: string) => `"${name.replace(/"/g, '""')}"`

function discover(db: SqliteDb): Map<string, TableInfo> {
  const out = new Map<string, TableInfo>()
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as { name: string }[]
  for (const { name } of names) {
    if (SKIP_PREFIXES.some((p) => name.startsWith(p)) || LOCAL_TABLES.has(name)) continue
    const info = db.prepare(`PRAGMA table_info(${q(name)})`).all() as {
      name: string
      pk: number
    }[]
    const cols = info.map((c) => c.name)
    const pk = info
      .filter((c) => c.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name)
    const natural = NATURAL_IDENTITY[name]
    const identity = natural ?? pk
    if (!identity.length || !identity.every((c) => cols.includes(c))) continue
    out.set(name, {
      name,
      cols,
      identity,
      surrogate: natural && pk.length === 1 ? pk[0]! : null,
    })
  }
  return out
}

function encodeCell(v: unknown): Cell {
  if (v === null || v === undefined) return null
  if (Buffer.isBuffer(v)) return { $b: v.toString('base64') }
  if (typeof v === 'bigint') return Number(v)
  if (typeof v === 'number' || typeof v === 'string') return v
  return String(v)
}

function decodeCell(v: Cell | undefined): unknown {
  if (v && typeof v === 'object' && '$b' in v) return Buffer.from(v.$b, 'base64')
  return v ?? null
}

export interface ChangeLogOptions {
  /** Id de este equipo. */
  device: () => string
  /** Hay un cambio nuevo (para subirlo enseguida). */
  onChange?: () => void
  /** Sin sincronización configurada no se apunta nada (la cola no crece sin fin). */
  active?: () => boolean
}

export class ChangeLog {
  private tables = new Map<string, TableInfo>()
  private capture = true
  private last = 0
  private notifying = false
  private readonly stmts = new Map<string, Statement>()

  /** Sentencias preparadas una vez (aplicar miles de filas de Meta debe ir rápido). */
  private stmt(sql: string): Statement {
    let st = this.stmts.get(sql)
    if (!st) {
      st = this.db.prepare(sql)
      this.stmts.set(sql, st)
    }
    return st
  }

  constructor(
    readonly db: SqliteDb,
    private readonly o: ChangeLogOptions,
  ) {
    this.install()
  }

  /** Reloj híbrido: la hora en milisegundos, pero siempre por delante del último visto. */
  private tick(): number {
    this.last = Math.max(Date.now(), this.last + 1)
    return this.last
  }

  private install(): void {
    const db = this.db
    this.tables = discover(db)
    const max = db
      .prepare(
        'SELECT MAX(ts) AS m FROM (SELECT MAX(ts) AS ts FROM sync_rows UNION ALL SELECT MAX(ts) FROM sync_outbox)',
      )
      .get() as { m: number | null }
    this.last = max.m ?? 0
    db.function('crm_sync_on', () => (this.capture && (this.o.active?.() ?? true) ? 1 : 0))
    db.function('crm_sync_ts', () => this.tick())
    db.function('crm_sync_last', () => this.last)
    db.function('crm_sync_dev', () => this.o.device())
    // Un aviso por tanda de cambios, no uno por fila (Meta escribe miles seguidas).
    db.function('crm_sync_changed', () => {
      if (!this.notifying) {
        this.notifying = true
        setImmediate(() => {
          this.notifying = false
          this.o.onChange?.()
        })
      }
      return null
    })
    for (const t of this.tables.values()) {
      const key = (ref: 'NEW' | 'OLD') =>
        `json_array(${t.identity.map((c) => `${ref}.${q(c)}`).join(', ')})`
      // Sin «OR REPLACE» ni «ON CONFLICT»: dentro de un disparador los sustituiría el de la
      // sentencia que lo dispara (un INSERT OR IGNORE dejaría el cambio sin apuntar).
      // Y sin «main.» en las tablas: el SQLite del móvil (3.49) no lo admite dentro de un
      // disparador (D-127); sin calificar llegan igual a las de la base de datos.
      const mark = (ref: 'NEW' | 'OLD', where = '') => `
        DELETE FROM sync_outbox WHERE tbl = '${t.name}' AND key = ${key(ref)}${where ? ` AND ${where}` : ''};
        INSERT INTO sync_outbox (tbl, key, ts) SELECT '${t.name}', ${key(ref)}, crm_sync_ts()${where ? ` WHERE ${where}` : ''};
        DELETE FROM sync_rows WHERE tbl = '${t.name}' AND key = ${key(ref)}${where ? ` AND ${where}` : ''};
        INSERT INTO sync_rows (tbl, key, ts, dev) SELECT '${t.name}', ${key(ref)}, crm_sync_last(), crm_sync_dev()${where ? ` WHERE ${where}` : ''};
        SELECT crm_sync_changed();`
      const when = (ref: 'NEW' | 'OLD') =>
        `crm_sync_on()${t.name === 'settings' ? ` AND ${LOCAL_SETTING(ref)}` : ''}`
      const base = `sync_${t.name}`
      // Solo si cambia algo más que la hora de escritura (D-131).
      const content = t.cols.filter((c) => !VOLATILE.has(c))
      const changed = content.length
        ? content.map((c) => `OLD.${q(c)} IS NOT NEW.${q(c)}`).join(' OR ')
        : '1'
      db.exec(`
        DROP TRIGGER IF EXISTS temp.${q(`${base}_i`)};
        DROP TRIGGER IF EXISTS temp.${q(`${base}_u`)};
        DROP TRIGGER IF EXISTS temp.${q(`${base}_d`)};
        CREATE TEMP TRIGGER ${q(`${base}_i`)} AFTER INSERT ON main.${q(t.name)}
          WHEN ${when('NEW')} BEGIN ${mark('NEW')} END;
        CREATE TEMP TRIGGER ${q(`${base}_u`)} AFTER UPDATE ON main.${q(t.name)}
          WHEN ${when('NEW')} AND (${changed}) BEGIN ${mark('NEW')} ${mark('OLD', `${key('OLD')} <> ${key('NEW')}`)} END;
        CREATE TEMP TRIGGER ${q(`${base}_d`)} AFTER DELETE ON main.${q(t.name)}
          WHEN ${when('OLD')} BEGIN ${mark('OLD')} END;
      `)
    }
  }

  /** Cambios de este equipo sin subir. */
  /** El último cambio apuntado (0 si no hay ninguno). */
  lastQueued(): number {
    return (
      (this.db.prepare('SELECT MAX(id) AS m FROM sync_outbox').get() as { m: number | null }).m ?? 0
    )
  }

  pending(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as { n: number }).n
  }

  private where(t: TableInfo): string {
    return t.identity.map((c) => `${q(c)} IS ?`).join(' AND ')
  }

  /** Las filas cambiadas, con sus valores de ahora (o borradas), para un paquete. */
  collect(limit = 4000, upTo = Number.MAX_SAFE_INTEGER): { rows: PackRow[]; maxId: number } {
    const queue = this.db
      .prepare('SELECT id, tbl, key, ts FROM sync_outbox WHERE id <= ? ORDER BY id LIMIT ?')
      .all(upTo, limit) as { id: number; tbl: string; key: string; ts: number }[]
    const device = this.o.device()
    const rows: PackRow[] = []
    let maxId = 0
    for (const e of queue) {
      maxId = Math.max(maxId, e.id)
      const t = this.tables.get(e.tbl)
      if (!t) continue
      const k = JSON.parse(e.key) as PackRow['k']
      const row = this.stmt(`SELECT * FROM main.${q(t.name)} WHERE ${this.where(t)}`).get(...k) as
        Record<string, unknown> | undefined
      if (!row) {
        rows.push({ t: t.name, k, ts: e.ts, d: device, del: 1 })
        continue
      }
      const v: Record<string, Cell> = {}
      for (const c of t.cols) if (c !== t.surrogate) v[c] = encodeCell(row[c])
      rows.push({ t: t.name, k, ts: e.ts, d: device, v })
    }
    return { rows, maxId }
  }

  /** Ya subidos: fuera de la cola (lo que cambió después tiene un id mayor y se queda). */
  ack(maxId: number): void {
    this.db.prepare('DELETE FROM sync_outbox WHERE id <= ?').run(maxId)
  }

  /** Vacía la cola (todo va ya en una instantánea completa). */
  clear(): void {
    this.db.prepare('DELETE FROM sync_outbox').run()
  }

  /**
   * Todo lo del usuario en este equipo (D-126): antes de cambiar la base de datos por la de
   * la nube se guarda, para juntarlo después y no perder nada. Sin las métricas de Meta, que
   * se vuelven a bajar de Meta, ni los ajustes propios de este equipo.
   */
  dump(): PackRow[] {
    const device = this.o.device()
    const out: PackRow[] = []
    for (const t of this.tables.values()) {
      if (MERGE_SKIP.some((p) => t.name.startsWith(p))) continue
      const rows = this.db.prepare(`SELECT * FROM main.${q(t.name)}`).all() as Record<
        string,
        unknown
      >[]
      for (const row of rows) {
        if (t.name === 'settings' && isLocalSetting(String(row['key']))) continue
        const v: Record<string, Cell> = {}
        for (const c of t.cols) if (c !== t.surrogate) v[c] = encodeCell(row[c])
        out.push({
          t: t.name,
          k: t.identity.map((c) => encodeCell(row[c]) as string | number | null),
          ts: 0,
          d: device,
          v,
        })
      }
    }
    return out
  }

  /**
   * Junta lo que había aquí (de `dump`) con lo que hay ahora (D-126): entra lo que falta y,
   * si está en los dos, lo editado más tarde (`updated_at`; en los ratos de lectura, el más
   * largo). Lo que entra queda en la cola para subirlo. Un borrado de aquí no se recupera:
   * mejor algo de más que algo perdido.
   */
  merge(rows: PackRow[]): AppliedChanges {
    const winners: PackRow[] = []
    const device = this.o.device()
    for (const r of rows) {
      const t = this.tables.get(r.t)
      if (!t || !r.v || r.k.length !== t.identity.length) continue
      const cur = this.stmt(`SELECT * FROM main.${q(t.name)} WHERE ${this.where(t)}`).get(
        ...r.k,
      ) as Record<string, unknown> | undefined
      const mine = r.v
      let wins = !cur
      if (cur && t.cols.includes('updated_at')) {
        const a = mine['updated_at']
        const b = cur['updated_at']
        wins = typeof a === 'string' && typeof b === 'string' && a > b
      } else if (cur && t.name === 'reading_sessions')
        wins = Number(mine['seconds']) > Number(cur['seconds'])
      if (wins) winners.push({ ...r, ts: this.tick(), d: device })
    }
    return this.apply(winners, true)
  }

  /**
   * Aplica cambios de otro equipo (o los propios que vuelven tras una instantánea). Gana el
   * más reciente de cada fila. `asLocal`: además quedan en la cola para subirlos (los cambios
   * de aquí que no se habían subido antes de cambiar de instantánea).
   */
  apply(rows: PackRow[], asLocal = false): AppliedChanges {
    const out: AppliedChanges = {
      tables: new Set(),
      settings: new Set(),
      records: new Set(),
      skipped: 0,
    }
    const getClock = this.db.prepare('SELECT ts, dev FROM sync_rows WHERE tbl = ? AND key = ?')
    const setClock = this.db.prepare(
      'INSERT OR REPLACE INTO sync_rows (tbl, key, ts, dev) VALUES (?, ?, ?, ?)',
    )
    const dropQueued = this.db.prepare('DELETE FROM sync_outbox WHERE tbl = ? AND key = ?')
    const queue = this.db.prepare('INSERT INTO sync_outbox (tbl, key, ts) VALUES (?, ?, ?)')
    this.capture = false
    try {
      this.db.transaction(() => {
        for (const r of rows) {
          const t = this.tables.get(r.t)
          if (!t || !Array.isArray(r.k) || r.k.length !== t.identity.length) {
            out.skipped++
            continue
          }
          const key = JSON.stringify(r.k)
          this.last = Math.max(this.last, r.ts)
          const clock = getClock.get(t.name, key) as { ts: number; dev: string } | undefined
          if (clock && (clock.ts > r.ts || (clock.ts === r.ts && clock.dev >= r.d))) continue
          try {
            if (r.del) {
              this.stmt(`DELETE FROM main.${q(t.name)} WHERE ${this.where(t)}`).run(...r.k)
            } else {
              const v = r.v ?? {}
              const cols = t.cols.filter((c) => c !== t.surrogate && c in v)
              const rest = cols.filter((c) => !t.identity.includes(c))
              const values = (cs: string[]) => cs.map((c) => decodeCell(v[c]))
              const updated = rest.length
                ? this.stmt(
                    `UPDATE main.${q(t.name)} SET ${rest.map((c) => `${q(c)} = ?`).join(', ')} WHERE ${this.where(t)}`,
                  ).run(...values(rest), ...r.k).changes
                : (
                    this.stmt(
                      `SELECT COUNT(*) AS n FROM main.${q(t.name)} WHERE ${this.where(t)}`,
                    ).get(...r.k) as { n: number }
                  ).n
              if (!updated)
                this.stmt(
                  `INSERT INTO main.${q(t.name)} (${cols.map(q).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
                ).run(...values(cols))
            }
          } catch (e) {
            // Una regla de unicidad u otra restricción de este equipo: esa fila no entra.
            if ((e as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT')) {
              out.skipped++
              continue
            }
            throw e
          }
          setClock.run(t.name, key, r.ts, r.d)
          dropQueued.run(t.name, key)
          if (asLocal) queue.run(t.name, key, r.ts)
          out.tables.add(t.name)
          if (t.name === 'records' && typeof r.k[0] === 'string') out.records.add(r.k[0])
          if (t.name === 'settings' && typeof r.k[0] === 'string') out.settings.add(r.k[0])
        }
      })()
    } finally {
      this.capture = true
    }
    return out
  }
}
