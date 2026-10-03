import { z } from 'zod'

/**
 * Otras plataformas de publicidad (SPEC §7.4, fase 11). LinkedIn por su API (gratis con
 * aprobación) o por CSV; X por CSV (su API es de pago por uso). Los datos se guardan en
 * las mismas tablas que Meta, así que Análisis, Facturación e Informes los incluyen.
 */

export const PLATFORMS = { meta: 'Meta', linkedin: 'LinkedIn', x: 'X' } as const
export type Platform = keyof typeof PLATFORMS
export const OTHER_PLATFORMS = ['linkedin', 'x'] as const
export type OtherPlatform = (typeof OTHER_PLATFORMS)[number]

/** Id de cuenta de otra plataforma: «li_123456» (LinkedIn) o «x_tienda-demo» (X / CSV). */
export const otherAccountId = z.string().regex(/^(li|x)_[a-z0-9-]{1,60}$/)

export interface PlatformAccount {
  id: string
  platform: OtherPlatform
  name: string
  currency: string
  timezone: string
  enabled: boolean
  clientId: string | null
  dataFrom: string | null
  dataUntil: string | null
  /** De dónde llegan los datos: la API o archivos CSV. */
  source: 'api' | 'csv'
  lastSyncAt: string | null
  lastError: string | null
}

export const platformAccountUpdateSchema = z.object({
  id: otherAccountId,
  enabled: z.boolean().optional(),
  clientId: z.string().min(1).max(64).nullable().optional(),
})

// --- CSV ---------------------------------------------------------------------------

/** Columnas que se pueden asignar. Fecha, campaña, importe e impresiones son obligatorias. */
export const CSV_FIELDS = {
  date: 'Fecha',
  campaign: 'Campaña',
  campaignId: 'Id de campaña',
  spend: 'Importe gastado',
  impressions: 'Impresiones',
  clicks: 'Clics',
  linkClicks: 'Clics en el enlace',
  conversions: 'Conversiones',
  value: 'Valor de conversiones',
} as const
export type CsvField = keyof typeof CSV_FIELDS
export const REQUIRED_FIELDS: readonly CsvField[] = ['date', 'campaign', 'spend', 'impressions']

export const DATE_FORMATS = {
  ymd: 'aaaa-mm-dd',
  dmy: 'dd/mm/aaaa',
  mdy: 'mm/dd/aaaa (EE. UU.)',
} as const
export type DateFormat = keyof typeof DATE_FORMATS

export const csvMappingSchema = z.object({
  /** Índice de columna de cada campo (null: no está). */
  columns: z.record(
    z.enum(Object.keys(CSV_FIELDS) as [CsvField, ...CsvField[]]),
    z.number().int().min(0).max(500).nullable(),
  ),
  dateFormat: z.enum(['ymd', 'dmy', 'mdy']),
  decimal: z.enum([',', '.']),
  /** Cómo se cuentan las conversiones: como compras (ROAS, CPA) o como otras conversiones. */
  conversionsAs: z.enum(['compras', 'otras']).default('compras'),
})
export type CsvMapping = z.infer<typeof csvMappingSchema>

export const csvImportSchema = z.object({
  platform: z.enum(OTHER_PLATFORMS),
  /** Cuenta existente o nueva (nombre, moneda y zona horaria). */
  accountId: otherAccountId.nullable(),
  newAccount: z
    .object({
      name: z.string().trim().min(1).max(120),
      currency: z.string().regex(/^[A-Z]{3}$/),
      timezone: z.string().min(1).max(64),
    })
    .nullable(),
  /** Contenido del CSV (texto). */
  text: z.string().min(1).max(20_000_000),
  mapping: csvMappingSchema,
})
export type CsvImport = z.infer<typeof csvImportSchema>

export interface LinkedInStatus {
  connected: boolean
  /** Fecha ISO de caducidad del token. */
  expiresAt: string | null
  daysLeft: number | null
  phase: 'idle' | 'syncing' | 'error'
  error: string | null
  lastSyncAt: string | null
}

export const linkedinConnectSchema = z.object({
  clientId: z.string().trim().max(200).default(''),
  clientSecret: z.string().trim().max(200).default(''),
  /** Token generado en el portal de desarrolladores (alternativa al inicio de sesión). */
  token: z.string().trim().max(4000).default(''),
})

export interface CsvImportResult {
  accountId: string
  rows: number
  campaigns: number
  since: string
  until: string
  skipped: number
}

/** Quita acentos, espacios sobrantes y mayúsculas para comparar cabeceras. */
export function normalizeHeader(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ()%]/g, '')
    .trim()
}

/**
 * Nombres de columna conocidos (en inglés y en español) de las exportaciones de LinkedIn
 * Campaign Manager y X Ads. Solo sirven para proponer el mapeo: el usuario lo confirma.
 */
const SYNONYMS: Record<CsvField, string[]> = {
  date: [
    'start date (in utc)',
    'date',
    'day',
    'fecha',
    'dia',
    'time period',
    'periodo',
    'start date',
    'fecha de inicio',
  ],
  campaign: ['campaign name', 'campaign', 'nombre de la campana', 'campana', 'nombre de campana'],
  campaignId: ['campaign id', 'id de la campana', 'id de campana'],
  spend: [
    'total spent',
    'amount spent',
    'spend',
    'cost',
    'importe gastado',
    'importe invertido',
    'gasto',
    'coste',
    'gasto total',
    'billed charge local micro',
  ],
  impressions: ['impressions', 'impresiones'],
  clicks: ['clicks', 'clics', 'total clicks', 'clics totales'],
  linkClicks: [
    'clicks to landing page',
    'landing page clicks',
    'link clicks',
    'url clicks',
    'clics en el enlace',
    'clics a la pagina de destino',
  ],
  conversions: ['conversions', 'total conversions', 'conversiones', 'purchases', 'compras'],
  value: [
    'total conversion value',
    'conversion value',
    'valor de conversion',
    'valor de las conversiones',
    'purchase value',
    'valor de compras',
    'sales',
  ],
}

// --- Lectura de CSV ----------------------------------------------------------------

/** Separa un CSV en filas y celdas (comillas, saltos dentro de comillas, BOM). */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '')
  // El separador más repetido en las primeras líneas (fuera de comillas).
  const head = t
    .split(/\r?\n/)
    .slice(0, 20)
    .join('\n')
    .replace(/"[^"]*"/g, '')
  const delim = [',', ';', '\t'].reduce((a, b) =>
    head.split(b).length > head.split(a).length ? b : a,
  )
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === delim) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/**
 * Busca la fila de cabeceras (las exportaciones de LinkedIn traen antes unas líneas con
 * el título y el periodo del informe) y propone el mapeo de columnas.
 */
export function detectTable(rows: string[][]): {
  headerRow: number
  headers: string[]
  columns: Record<CsvField, number | null>
} {
  let best = { headerRow: 0, score: -1 }
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const norm = rows[i]!.map(normalizeHeader)
    const score = (Object.keys(SYNONYMS) as CsvField[]).filter((f) =>
      norm.some((h) => SYNONYMS[f].includes(h)),
    ).length
    if (score > best.score) best = { headerRow: i, score }
  }
  const headers = rows[best.headerRow] ?? []
  const norm = headers.map(normalizeHeader)
  const columns = {} as Record<CsvField, number | null>
  const used = new Set<number>()
  for (const f of Object.keys(SYNONYMS) as CsvField[]) {
    let idx: number | null = null
    // Por orden de preferencia de los sinónimos.
    for (const s of SYNONYMS[f]) {
      const j = norm.findIndex((h, k) => h === s && !used.has(k))
      if (j >= 0) {
        idx = j
        break
      }
    }
    if (idx !== null) used.add(idx)
    columns[f] = idx
  }
  return { headerRow: best.headerRow, headers, columns }
}

/** «1.234,56 €», «$1,234.56», «12 %», «-» → número (o null si no lo es). */
export function parseAmount(raw: string, decimal: ',' | '.'): number | null {
  let s = raw.trim().replace(/[^\d,.-]/g, '')
  if (s === '' || s === '-') return null
  s = decimal === ',' ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  ene: 1,
  abr: 4,
  ago: 8,
  dic: 12,
  sept: 9,
}

/**
 * Fecha → «aaaa-mm-dd». Admite el formato elegido, ISO (con hora), «Sep 1, 2026» y
 * rangos «a - b» (se toma el primer día).
 */
export function parseCsvDate(raw: string, format: DateFormat): string | null {
  let s = raw.trim()
  const range = /^(.+?)\s+[-–]\s+(.+)$/.exec(s)
  if (range && !/^\d{4}-\d{2}-\d{2}$/.test(s)) s = range[1]!
  const pad = (n: number) => String(n).padStart(2, '0')
  const ok = (y: number, m: number, d: number) => {
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null
  }
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s)
  if (m) return ok(Number(m[1]), Number(m[2]), Number(m[3]))
  m = /^([A-Za-zé]{3,5})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s)
  if (m) {
    const mon = MONTHS[m[1]!.toLowerCase().slice(0, 4)] ?? MONTHS[m[1]!.toLowerCase().slice(0, 3)]
    return mon ? ok(Number(m[3]), mon, Number(m[2])) : null
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s)
  if (m) {
    const y = Number(m[3]!.length === 2 ? `20${m[3]}` : m[3])
    const a = Number(m[1])
    const b = Number(m[2])
    if (format === 'mdy') return ok(y, a, b)
    return ok(y, b, a)
  }
  return null
}

/** Propone el formato de fecha y el separador decimal mirando los valores. */
export function guessFormats(
  rows: string[][],
  columns: Record<CsvField, number | null>,
): { dateFormat: DateFormat; decimal: ',' | '.' } {
  let dateFormat: DateFormat = 'dmy'
  const dc = columns.date
  if (dc !== null) {
    const values = rows.map((r) => r[dc] ?? '').filter(Boolean)
    if (values.some((v) => /^\d{4}-\d{1,2}-\d{1,2}/.test(v.trim()))) dateFormat = 'ymd'
    else if (values.some((v) => /^\d{1,2}[/.-](1[3-9]|2\d|3[01])[/.-]/.test(v.trim())))
      dateFormat = 'mdy'
  }
  let commas = 0
  let dots = 0
  for (const f of ['spend', 'value'] as const) {
    const c = columns[f]
    if (c === null) continue
    for (const r of rows) {
      const v = (r[c] ?? '').replace(/[^\d,.-]/g, '')
      if (/,\d{1,2}$/.test(v)) commas++
      if (/\.\d{1,2}$/.test(v)) dots++
    }
  }
  return { dateFormat, decimal: commas > dots ? ',' : '.' }
}

/** «Tienda Demo (X)» → «tienda-demo» para el id de una cuenta importada. */
export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 50) || 'cuenta'
  )
}
