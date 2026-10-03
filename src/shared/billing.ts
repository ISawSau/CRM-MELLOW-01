import { z } from 'zod'

/** Facturación y cobros (SPEC §7.9, fase 9). */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const billingQuerySchema = z.object({ since: isoDate, until: isoDate })

export interface BillingRow {
  clientId: string | null
  client: string
  /** Facturas emitidas en el periodo. */
  facturado: number
  /** Facturas cobradas en el periodo (por fecha de cobro). */
  cobrado: number
  /** Sin cobrar (todas, no solo las del periodo). */
  pendiente: number
  /** Sin cobrar y con el vencimiento pasado. */
  vencido: number
  gastos: number
  /** Gasto en Meta de las cuentas del cliente. */
  inversion: number
  /** Fee mensual prorrateado por los días del periodo. */
  feePrevisto: number
  /** Porcentaje acordado sobre la inversión en Meta. */
  porcentajePrevisto: number
  /** Cobrado − gastos. */
  beneficio: number
  facturas: number
}

export interface OverdueInvoice {
  id: string
  numero: string
  client: string
  total: number
  currency: string
  vencimiento: string
  /** Días desde el vencimiento. */
  days: number
}

export interface BillingSummary {
  currency: string
  /** Faltan tipos de cambio de alguna moneda: esos importes no se han sumado. */
  partial: boolean
  since: string
  until: string
  rows: BillingRow[]
  totals: Omit<BillingRow, 'clientId' | 'client'>
  overdue: OverdueInvoice[]
}
