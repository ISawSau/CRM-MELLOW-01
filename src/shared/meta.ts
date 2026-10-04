import { z } from 'zod'

/**
 * Meta en solo lectura (SPEC §7.3). Tipos que comparten el proceso principal y la
 * interfaz. El token nunca sale del proceso principal.
 */

/** Versión de la Graph API comprobada en la documentación oficial (D-054). */
export const META_API_VERSION = 'v26.0'

/** Meta no deja pedir métricas con fecha de inicio de hace más de 37 meses. */
export const META_HISTORY_MONTHS = 37

export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/)

/** Monedas mínimas del SPEC (lista editable en Ajustes de Meta). */
export const DEFAULT_CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'CAD',
  'AUD',
  'MXN',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'JPY',
  'BRL',
] as const

export const SYNC_INTERVALS = [30, 60, 120, 240] as const

export const metaSettingsSchema = z.object({
  /** Cada cuántos minutos se sincroniza con la app abierta. */
  intervalMinutes: z
    .number()
    .int()
    .refine((n) => (SYNC_INTERVALS as readonly number[]).includes(n))
    .default(60),
  /** Días que se vuelven a descargar en cada sincronización (ventana de atribución). */
  attributionDays: z.number().int().min(1).max(28).default(7),
  /** Moneda en la que se muestran los importes. */
  displayCurrency: currencyCodeSchema.default('EUR'),
  currencies: z
    .array(currencyCodeSchema)
    .min(1)
    .max(60)
    .default([...DEFAULT_CURRENCIES]),
})
export type MetaSettings = z.infer<typeof metaSettingsSchema>

export const metaConnectSchema = z.object({
  token: z.string().trim().min(20).max(1000),
  /** Opcional: si la app de Meta exige «appsecret_proof». */
  appSecret: z.string().trim().max(200).default(''),
})

export interface MetaProgress {
  label: string
  done: number
  total: number
  /** Segundos que faltan, estimados con el ritmo de esta sincronización (null: aún no se sabe). */
  etaSeconds: number | null
  /** Meta ha pedido esperar por sus límites de uso hasta esta hora (ISO). */
  waitingUntil: string | null
}

export interface MetaStatus {
  connected: boolean
  /** Nombre del usuario del sistema dueño del token. */
  user: string | null
  phase: 'idle' | 'syncing' | 'error'
  error: string | null
  progress: MetaProgress | null
  lastSyncAt: string | null
  settings: MetaSettings
}

/** Estados de cuenta publicitaria (campo account_status de la API). */
export const ACCOUNT_STATUS_LABELS: Record<number, string> = {
  1: 'Activa',
  2: 'Desactivada',
  3: 'Pagos pendientes',
  7: 'En revisión de riesgo',
  8: 'Pendiente de liquidar',
  9: 'En periodo de gracia',
  100: 'Cierre pendiente',
  101: 'Cerrada',
  201: 'Activa (cualquiera)',
  202: 'Cerrada (cualquiera)',
}

export interface AdAccountInfo {
  id: string
  name: string
  currency: string
  timezone: string
  status: number | null
  business: string | null
  enabled: boolean
  clientId: string | null
  dataFrom: string | null
  dataUntil: string | null
  historyDone: boolean
  /** Trozos del histórico hechos / totales (null si no hay importación en marcha). */
  history: { done: number; total: number; failed: number } | null
  lastSyncAt: string | null
  lastError: string | null
  breakdowns: BreakdownConfig
}

export const accountUpdateSchema = z.object({
  id: z.string().regex(/^act_\d{1,30}$/),
  enabled: z.boolean().optional(),
  clientId: z.string().min(1).max(64).nullable().optional(),
})

export const PERF_LEVELS = ['campaign', 'adset', 'ad'] as const
export type PerfLevel = (typeof PERF_LEVELS)[number]

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/**
 * Tipos de acción de Meta para cada métrica, por orden de preferencia: si la fila trae
 * el primero, se usa ese (los otros son subconjuntos o duplicados del mismo evento).
 */
export const ACTION_PREFERENCE = {
  purchases: ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase'],
  addToCart: ['omni_add_to_cart', 'add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart'],
  initiateCheckout: [
    'omni_initiated_checkout',
    'initiate_checkout',
    'offsite_conversion.fb_pixel_initiate_checkout',
  ],
  video3s: ['video_view'],
} as const

/** Unidades mínimas por unidad de moneda (Meta da los presupuestos en la mínima). */
const ZERO_DECIMAL = new Set([
  'CLP',
  'COP',
  'CRC',
  'HUF',
  'ISK',
  'IDR',
  'JPY',
  'KRW',
  'PYG',
  'TWD',
  'VND',
])
export function currencyOffset(currency: string): number {
  return ZERO_DECIMAL.has(currency) ? 1 : 100
}

// --- Tabla tipo Ads Manager (fase 7) -------------------------------------------------

/** Desgloses que se pueden activar (combinaciones admitidas por la documentación). */
export const BREAKDOWNS = {
  edad: { api: ['age'], label: 'Edad' },
  sexo: { api: ['gender'], label: 'Sexo' },
  pais: { api: ['country'], label: 'País' },
  plataforma: { api: ['publisher_platform'], label: 'Plataforma' },
  ubicacion: { api: ['publisher_platform', 'platform_position'], label: 'Ubicación' },
  dispositivo: { api: ['impression_device'], label: 'Dispositivo' },
} as const
export type BreakdownKey = keyof typeof BREAKDOWNS
export const BREAKDOWN_KEYS = Object.keys(BREAKDOWNS) as BreakdownKey[]
export const breakdownKeySchema = z.enum(BREAKDOWN_KEYS as [BreakdownKey, ...BreakdownKey[]])

export const breakdownConfigSchema = z
  .object({
    campaign: z.array(breakdownKeySchema).max(6).default([]),
    adset: z.array(breakdownKeySchema).max(6).default([]),
    ad: z.array(breakdownKeySchema).max(6).default([]),
  })
  .default({ campaign: [], adset: [], ad: [] })
export type BreakdownConfig = z.infer<typeof breakdownConfigSchema>

export const tableQuerySchema = z.object({
  accountId: z.string().regex(/^act_\d{1,30}$/),
  level: z.enum(PERF_LEVELS),
  parentId: z.string().max(40).nullable().default(null),
  since: isoDate,
  until: isoDate,
  /** Métricas del periodo anterior por fila (para comparar). */
  compare: z.boolean().default(false),
  breakdown: breakdownKeySchema.nullable().default(null),
})
export type TableQuery = z.input<typeof tableQuerySchema>

/** Sumas por clave de métrica (`gasto`, `compras`, `acc_…`, `val_…`). */
export type BaseSums = Record<string, number>

export interface RangeStats {
  alcance: number | null
  frecuencia: number | null
  clics_enlace_unicos: number | null
  ctr_enlace_unico: number | null
}

export interface TableRow {
  id: string
  name: string
  status: string | null
  effectiveStatus: string | null
  objective: string | null
  bidStrategy: string | null
  dailyBudget: number | null
  lifetimeBudget: number | null
  startTime: string | null
  endTime: string | null
  /** Última edición significativa (historial de actividad) o última actualización. */
  lastEdit: string | null
  lastEditExact: boolean
  attribution: string | null
  rankings: { quality: string | null; engagement: string | null; conversion: string | null }
  thumbFileId: string | null
  /** Anuncios: su vista previa pública en Meta (se abre en el navegador). */
  previewUrl: string | null
  creatives: { id: string; title: string }[]
  base: BaseSums
  range: RangeStats | null
  previous: BaseSums | null
  breakdown: { value: string; base: BaseSums }[] | null
}

export interface TableResult {
  currency: string
  accountCurrency: string
  unconverted: boolean
  rows: TableRow[]
  totals: BaseSums
  totalsRange: RangeStats | null
  previous: BaseSums
  /** Faltan alcance y frecuencia de este periodo (se pueden pedir a Meta). */
  rangeMissing: boolean
  /** Desgloses activados para esta cuenta y nivel. */
  breakdowns: BreakdownKey[]
}

export const rangeFetchSchema = z.object({
  accountId: z.string().regex(/^act_\d{1,30}$/),
  level: z.enum(PERF_LEVELS),
  parentId: z.string().max(40).nullable().default(null),
  since: isoDate,
  until: isoDate,
})

export interface AdSearchHit {
  id: string
  name: string
  accountId: string
  accountName: string
  campaignName: string | null
  thumbFileId: string | null
  effectiveStatus: string | null
  /** Vista previa pública del anuncio en Meta. */
  previewUrl: string | null
}

export interface CreativeLinkInfo extends AdSearchHit {
  source: 'manual' | 'auto'
}

export const creativePerfSchema = z.object({
  recordId: z.string().min(1).max(64),
  since: isoDate,
  until: isoDate,
})

export const tagPerfSchema = z.object({
  fieldId: z.string().min(1).max(64),
  since: isoDate,
  until: isoDate,
  clientId: z.string().min(1).max(64).nullable().default(null),
})

export interface GroupPerf {
  id: string
  label: string
  color: string | null
  /** Creatividades del grupo con algún anuncio vinculado. */
  creatives: number
  ads: number
  base: BaseSums
}

export interface CreativePerfResult {
  currency: string
  /** Hay importes que no se han podido convertir y se han dejado fuera. */
  partial: boolean
  base: BaseSums
  ads: number
}

export interface TagPerfResult {
  currency: string
  partial: boolean
  groups: GroupPerf[]
  creatives: GroupPerf[]
}
