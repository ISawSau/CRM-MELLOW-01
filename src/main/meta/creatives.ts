import { AppError } from '@shared/errors'
import { norm as normalizeText } from '@shared/data/text'
import type { FieldDef } from '@shared/data/fields'
import type { LinkRef, RecordRow } from '@shared/data/records'
import type {
  AdSearchHit,
  BaseSums,
  CreativeLinkInfo,
  CreativePerfResult,
  GroupPerf,
  TagPerfResult,
} from '@shared/meta'
import type { SqliteDb } from '../db/connection'
import type { DataService } from '../data/data-service'
import { addDaily, moneyConverter, type DailyRow } from './sums'
import { t } from '@shared/i18n'

/**
 * Vínculo entre creatividades (biblioteca, SPEC §7.8) y anuncios de Meta: manual
 * (buscar y elegir) y automático por código o por convención de nombres. Con los
 * vínculos, el rendimiento por creatividad y por etiqueta (ángulo, hook, formato…).
 */

const ENTITY = 'creatividad'

const HIT_SQL = `SELECT o.id, o.name, o.account_id AS accountId, a.name AS accountName,
       c.name AS campaignName, cr.thumb_file_id AS thumbFileId, o.effective_status AS effectiveStatus
  FROM ad_objects o
  JOIN ad_accounts a ON a.id = o.account_id
  LEFT JOIN ad_objects c ON c.id = o.campaign_id
  LEFT JOIN ad_creatives cr ON cr.id = o.creative_id`

export function searchAds(db: SqliteDb, text: string, limit = 30): AdSearchHit[] {
  const words = normalizeText(text).split(/\s+/).filter(Boolean)
  const rows = db
    .prepare(`${HIT_SQL} WHERE o.level = 'ad' AND a.enabled = 1 ORDER BY o.updated_time DESC`)
    .all() as AdSearchHit[]
  return rows
    .filter((r) => {
      const hay = normalizeText(`${r.name} ${r.id} ${r.campaignName ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
    .slice(0, limit)
}

export function linksFor(db: SqliteDb, recordId: string): CreativeLinkInfo[] {
  return db
    .prepare(
      `${HIT_SQL.replace('SELECT ', 'SELECT l.source, ')}
       JOIN creative_links l ON l.ad_id = o.id
       WHERE l.record_id = ? AND l.source != 'off' ORDER BY l.created_at`,
    )
    .all(recordId) as CreativeLinkInfo[]
}

export function setLink(
  db: SqliteDb,
  recordId: string,
  adId: string,
  linked: boolean,
  now: string,
): void {
  const rec = db
    .prepare('SELECT entity FROM records WHERE id = ? AND deleted_at IS NULL')
    .get(recordId) as { entity: string } | undefined
  if (rec?.entity !== ENTITY)
    throw new AppError('INVALID_INPUT', undefined, t('No es una creatividad.'))
  if (linked) {
    const ad = db.prepare("SELECT 1 FROM ad_objects WHERE id = ? AND level = 'ad'").get(adId)
    if (!ad) throw new AppError('INVALID_INPUT', undefined, t('No existe ese anuncio.'))
    db.prepare(
      `INSERT INTO creative_links (record_id, ad_id, source, created_at) VALUES (?, ?, 'manual', ?)
       ON CONFLICT(record_id, ad_id) DO UPDATE SET source = 'manual'`,
    ).run(recordId, adId, now)
  } else {
    db.prepare('DELETE FROM creative_links WHERE record_id = ? AND ad_id = ?').run(recordId, adId)
    // Para que el vínculo automático no lo vuelva a crear.
    db.prepare(
      "INSERT OR IGNORE INTO creative_links (record_id, ad_id, source, created_at) VALUES (?, ?, 'off', ?)",
    ).run(recordId, adId, now)
  }
}

// --- Vínculo automático ---------------------------------------------------------------

const norm = (s: string) => normalizeText(s).replace(/[^a-z0-9]+/g, '')

/** Valores de un campo de la creatividad como texto, para comparar con el nombre. */
function displayValues(f: FieldDef, v: unknown): string[] {
  if (v === undefined || v === null || v === '') return []
  if (f.type === 'select' || f.type === 'multiselect') {
    const options = (f.config['options'] as { id: string; label: string }[] | undefined) ?? []
    const ids = Array.isArray(v) ? (v as string[]) : [v as string]
    return ids.map((id) => options.find((o) => o.id === id)?.label ?? id)
  }
  if (f.type === 'relation') return ((v as LinkRef[]) ?? []).map((l) => l.title)
  if (typeof v === 'string' || typeof v === 'number') return [String(v)]
  return []
}

export interface CompiledPattern {
  regex: RegExp
  keys: string[]
}

/**
 * «{cliente}_{angulo}_{formato}_v{version}» → expresión que separa el nombre del
 * anuncio. `{*}` vale cualquier cosa; `{version}` y las claves desconocidas no se
 * comparan.
 */
export function compilePattern(pattern: string): CompiledPattern | null {
  if (!pattern.trim() || !pattern.includes('{')) return null
  const keys: string[] = []
  let src = '^'
  const re = /\{([a-z0-9_*]+)\}/gi
  let last = 0
  for (const m of pattern.matchAll(re)) {
    src += pattern.slice(last, m.index).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (m[1] === '*') src += '.*?'
    else {
      keys.push(m[1]!.toLowerCase())
      src += '(.+?)'
    }
    last = m.index! + m[0].length
  }
  src += `${pattern.slice(last).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`
  return keys.length ? { regex: new RegExp(src, 'i'), keys } : null
}

/** Partes del nombre de un anuncio según la convención (null si no encaja). */
export function parseAdName(p: CompiledPattern, name: string): Record<string, string> | null {
  const m = p.regex.exec(name.trim())
  if (!m) return null
  const out: Record<string, string> = {}
  p.keys.forEach((k, i) => (out[k] = m[i + 1]!))
  return out
}

/**
 * Vincula los anuncios sin creatividad: por código (el nombre del anuncio lo contiene
 * como palabra) y por la convención de nombres. Solo si encaja con una creatividad.
 * Devuelve el número de vínculos nuevos.
 */
export function autoLink(
  db: SqliteDb,
  data: DataService,
  naming: { byCode: boolean; pattern: string },
  now: string,
): number {
  const pattern = compilePattern(naming.pattern)
  if (!naming.byCode && !pattern) return 0
  const fields = data.listFields(ENTITY)
  const byKey = new Map(fields.map((f) => [f.key, f]))
  const records = data.query(ENTITY) as RecordRow[]
  const codeField = byKey.get('codigo')
  const codes = new Map<string, string[]>()
  if (naming.byCode && codeField)
    for (const r of records) {
      const code = r.values[codeField.id]
      if (typeof code === 'string' && norm(code).length >= 2) {
        const k = norm(code)
        codes.set(k, [...(codes.get(k) ?? []), r.id])
      }
    }
  const ads = db
    .prepare(
      `SELECT o.id, o.name FROM ad_objects o
       WHERE o.level = 'ad' AND NOT EXISTS (SELECT 1 FROM creative_links l WHERE l.ad_id = o.id)`,
    )
    .all() as { id: string; name: string }[]
  const ins = db.prepare(
    "INSERT OR IGNORE INTO creative_links (record_id, ad_id, source, created_at) VALUES (?, ?, 'auto', ?)",
  )
  let n = 0
  db.transaction(() => {
    for (const ad of ads) {
      let match: string | null = null
      if (codes.size) {
        const tokens = new Set(
          normalizeText(ad.name)
            .split(/[^a-z0-9]+/)
            .filter(Boolean),
        )
        const found = [...codes.entries()].filter(([c]) => tokens.has(c)).flatMap(([, ids]) => ids)
        if (found.length === 1) match = found[0]!
      }
      if (!match && pattern) {
        const parts = parseAdName(pattern, ad.name)
        if (parts) {
          const candidates = records.filter((r) =>
            Object.entries(parts).every(([k, v]) => {
              const f = byKey.get(k)
              if (!f || k === 'version') return true
              return displayValues(f, r.values[f.id]).some((x) => norm(x) === norm(v))
            }),
          )
          const comparable = Object.keys(parts).some((k) => byKey.has(k) && k !== 'version')
          if (comparable && candidates.length === 1) match = candidates[0]!.id
        }
      }
      if (match) n += ins.run(match, ad.id, now).changes
    }
  })()
  return n
}

// --- Rendimiento ----------------------------------------------------------------------

/** Sumas de varios anuncios (de cuentas con monedas distintas) en la moneda dada. */
function sumAds(
  db: SqliteDb,
  adIds: string[],
  since: string,
  until: string,
  currency: string,
): { base: BaseSums; partial: boolean; perAd: Map<string, BaseSums> } {
  const base: BaseSums = {}
  const perAd = new Map<string, BaseSums>()
  let partial = false
  if (!adIds.length) return { base, partial, perAd }
  const conv = moneyConverter(db, currency)
  const stmt = db.prepare(
    `SELECT d.entity_id, d.date, d.spend, d.impressions, d.clicks, d.link_clicks, d.actions,
            d.action_values, d.extra, a.currency
     FROM ad_insights_daily d JOIN ad_accounts a ON a.id = d.account_id
     WHERE d.level = 'ad' AND d.entity_id = ? AND d.date BETWEEN ? AND ?`,
  )
  for (const id of adIds) {
    const s: BaseSums = {}
    for (const r of stmt.all(id, since, until) as (DailyRow & { currency: string })[]) {
      const money = conv(r.currency, r.date)
      if (!money) {
        partial = true
        continue
      }
      addDaily(s, r, money)
      addDaily(base, r, money)
    }
    perAd.set(id, s)
  }
  return { base, partial, perAd }
}

const linkedAds = (db: SqliteDb, recordId: string) =>
  (
    db
      .prepare("SELECT ad_id FROM creative_links WHERE record_id = ? AND source != 'off'")
      .all(recordId) as { ad_id: string }[]
  ).map((r) => r.ad_id)

export function creativePerf(
  db: SqliteDb,
  recordId: string,
  since: string,
  until: string,
  currency: string,
): CreativePerfResult {
  const ads = linkedAds(db, recordId)
  const { base, partial } = sumAds(db, ads, since, until, currency)
  return { currency, partial, base, ads: ads.length }
}

const addSums = (into: BaseSums, from: BaseSums) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v
}

/**
 * Ranking por etiqueta: para cada opción de un campo de selección de las creatividades
 * (ángulo, hook, formato…), las sumas de todos los anuncios vinculados. Una creatividad
 * con dos ángulos cuenta en los dos. También el ranking de creatividades.
 */
export function tagPerf(
  db: SqliteDb,
  data: DataService,
  fieldId: string,
  since: string,
  until: string,
  currency: string,
  clientId: string | null,
): TagPerfResult {
  const fields = data.listFields(ENTITY)
  const field = fields.find((f) => f.id === fieldId)
  if (!field || (field.type !== 'select' && field.type !== 'multiselect'))
    throw new AppError('INVALID_INPUT', undefined, t('Elige un campo de selección.'))
  const clientField = fields.find((f) => f.key === 'cliente')
  const options = (field.config['options'] as { id: string; label: string; color: string }[]) ?? []
  let records = data.query(ENTITY) as RecordRow[]
  if (clientId && clientField)
    records = records.filter((r) =>
      ((r.values[clientField.id] as LinkRef[] | undefined) ?? []).some((l) => l.id === clientId),
    )
  const groups = new Map<string, GroupPerf>()
  const creatives: GroupPerf[] = []
  let partial = false
  for (const r of records) {
    const ads = linkedAds(db, r.id)
    if (!ads.length) continue
    const s = sumAds(db, ads, since, until, currency)
    partial ||= s.partial
    creatives.push({
      id: r.id,
      label: r.title,
      color: null,
      creatives: 1,
      ads: ads.length,
      base: s.base,
    })
    const v = r.values[field.id]
    const ids = Array.isArray(v) ? (v as string[]) : v ? [v as string] : ['']
    for (const id of ids) {
      const o = options.find((x) => x.id === id)
      const key = o ? o.id : ''
      let g = groups.get(key)
      if (!g)
        groups.set(
          key,
          (g = {
            id: key,
            label: o ? t(o.label) : t('Sin valor'),
            color: o?.color ?? null,
            creatives: 0,
            ads: 0,
            base: {},
          }),
        )
      g.creatives++
      g.ads += ads.length
      addSums(g.base, s.base)
    }
  }
  const bySpend = (a: GroupPerf, b: GroupPerf) => (b.base['gasto'] ?? 0) - (a.base['gasto'] ?? 0)
  return {
    currency,
    partial,
    groups: [...groups.values()].sort(bySpend),
    creatives: creatives.sort(bySpend),
  }
}
