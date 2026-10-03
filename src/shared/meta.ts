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
}

export const accountUpdateSchema = z.object({
  id: z.string().regex(/^act_\d{1,30}$/),
  enabled: z.boolean().optional(),
  clientId: z.string().min(1).max(64).nullable().optional(),
})

export const PERF_LEVELS = ['campaign', 'adset', 'ad'] as const
export type PerfLevel = (typeof PERF_LEVELS)[number]

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const perfQuerySchema = z.object({
  accountId: z.string().regex(/^act_\d{1,30}$/),
  level: z.enum(PERF_LEVELS),
  /** Solo los hijos de esta campaña o conjunto. */
  parentId: z.string().max(40).nullable().default(null),
  since: isoDate,
  until: isoDate,
})
export type PerfQuery = z.input<typeof perfQuerySchema>

/** Métricas sumables de un periodo, ya convertidas a la moneda de visualización. */
export interface PerfMetrics {
  spend: number
  impressions: number
  clicks: number
  linkClicks: number
  purchases: number
  purchaseValue: number
  addToCart: number
  initiateCheckout: number
  video3s: number
  thruplays: number
}

export interface PerfRow extends PerfMetrics {
  id: string
  name: string
  status: string | null
  effectiveStatus: string | null
  /** Campaña (objetivo) o conjunto (objetivo de optimización). */
  objective: string | null
  dailyBudget: number | null
  lifetimeBudget: number | null
  thumbFileId: string | null
}

export interface PerfResult {
  currency: string
  /** Moneda de la cuenta (la de origen de los importes). */
  accountCurrency: string
  /** No hay tipo de cambio para convertir: se muestra en la moneda de la cuenta. */
  unconverted: boolean
  rows: PerfRow[]
  totals: PerfMetrics
  /** Totales del periodo anterior de la misma duración (para comparar). */
  previous: PerfMetrics
}

export function emptyMetrics(): PerfMetrics {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    linkClicks: 0,
    purchases: 0,
    purchaseValue: 0,
    addToCart: 0,
    initiateCheckout: 0,
    video3s: 0,
    thruplays: 0,
  }
}

/** Métricas derivadas (null si el denominador es 0). */
export function derived(m: PerfMetrics) {
  const div = (a: number, b: number) => (b > 0 ? a / b : null)
  return {
    cpm: div(m.spend * 1000, m.impressions),
    cpc: div(m.spend, m.linkClicks),
    linkCtr: div(m.linkClicks * 100, m.impressions),
    roas: div(m.purchaseValue, m.spend),
    aov: div(m.purchaseValue, m.purchases),
    cpa: div(m.spend, m.purchases),
    hookRate: div(m.video3s * 100, m.impressions),
  }
}

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
