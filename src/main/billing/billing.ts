import type { BillingRow, BillingSummary, OverdueInvoice } from '@shared/billing'
import { daysBetween } from '@shared/analysis'
import type { FieldDef } from '@shared/data/fields'
import type { LinkRef, RecordRow } from '@shared/data/records'
import type { SqliteDb } from '../db/connection'
import type { DataService } from '../data/data-service'
import { analyze } from '../analysis/query'
import { moneyConverter } from '../meta/sums'

/**
 * Resumen de facturación y beneficio por cliente (SPEC §7.9). Las facturas se registran
 * (se emiten con un programa que cumple Verifactu, D-071); aquí se suman, se convierten a
 * la moneda de visualización con el tipo del BCE de cada fecha y se cruzan con los
 * gastos, los fees acordados y la inversión publicitaria.
 */

const NONE = '__sin__'
const MONTH_DAYS = 365 / 12

function byKey(fields: FieldDef[]) {
  const map = new Map(fields.map((f) => [f.key, f]))
  return (k: string) => map.get(k)
}

/** Etiqueta de la opción elegida en un campo de selección. */
function optionLabel(f: FieldDef | undefined, v: unknown): string | null {
  if (!f || typeof v !== 'string') return null
  const o = (f.config['options'] as { id: string; label: string }[] | undefined)?.find(
    (x) => x.id === v,
  )
  return o?.label ?? null
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const clientOf = (f: FieldDef | undefined, r: RecordRow) =>
  ((f ? (r.values[f.id] as LinkRef[] | undefined) : undefined) ?? [])[0]?.id ?? NONE

export function billingSummary(
  db: SqliteDb,
  data: DataService,
  since: string,
  until: string,
  currency: string,
  today: string,
): BillingSummary {
  const conv = moneyConverter(db, currency)
  let partial = false
  const money = (amount: number, from: string | null, date: string): number => {
    const c = from && /^[A-Z]{3}$/.test(from) ? from : currency
    const f = conv(c, date)
    if (!f) {
      partial = true
      return 0
    }
    return f(amount)
  }

  const rows = new Map<string, BillingRow>()
  const clientTitle = new Map<string, string>()
  const row = (id: string): BillingRow => {
    let r = rows.get(id)
    if (!r)
      rows.set(
        id,
        (r = {
          clientId: id === NONE ? null : id,
          client: id === NONE ? 'Sin cliente' : (clientTitle.get(id) ?? 'Cliente borrado'),
          facturado: 0,
          cobrado: 0,
          pendiente: 0,
          vencido: 0,
          gastos: 0,
          inversion: 0,
          feePrevisto: 0,
          porcentajePrevisto: 0,
          beneficio: 0,
          facturas: 0,
        }),
      )
    return r
  }
  const inRange = (d: unknown) => typeof d === 'string' && d >= since && d <= until

  // Clientes: fee mensual y porcentaje del gasto según el acuerdo.
  const cf = byKey(data.listFields('cliente'))
  const clients = data.query('cliente') as RecordRow[]
  for (const c of clients) clientTitle.set(c.id, c.title)

  // Facturas.
  const ff = byKey(data.listFields('factura'))
  const overdue: OverdueInvoice[] = []
  for (const inv of data.query('factura') as RecordRow[]) {
    const v = (k: string) => {
      const f = ff(k)
      return f ? inv.values[f.id] : undefined
    }
    const total = Math.round(num(v('base')) * (1 + num(v('iva')) / 100) * 100) / 100
    const cur = optionLabel(ff('moneda'), v('moneda'))
    const estado = v('estado')
    const emision = typeof v('emision') === 'string' ? (v('emision') as string) : null
    const cobro = typeof v('cobro') === 'string' ? (v('cobro') as string) : null
    const vencimiento = typeof v('vencimiento') === 'string' ? (v('vencimiento') as string) : null
    const r = row(clientOf(ff('cliente'), inv))
    if (inRange(emision)) {
      r.facturado += money(total, cur, emision!)
      r.facturas++
    }
    if (estado === 'cobrada') {
      const when = cobro ?? emision
      if (inRange(when)) r.cobrado += money(total, cur, when!)
    } else {
      const amount = money(total, cur, today)
      r.pendiente += amount
      if (vencimiento && vencimiento < today) {
        r.vencido += amount
        overdue.push({
          id: inv.id,
          numero: inv.title,
          client: r.client,
          total,
          currency: cur ?? currency,
          vencimiento,
          days: daysBetween(vencimiento, today) - 1,
        })
      }
    }
  }

  // Gastos.
  const gf = byKey(data.listFields('gasto'))
  for (const g of data.query('gasto') as RecordRow[]) {
    const fecha = gf('fecha') ? g.values[gf('fecha')!.id] : undefined
    if (!inRange(fecha)) continue
    const importe = gf('importe') ? num(g.values[gf('importe')!.id]) : 0
    const cur = optionLabel(gf('moneda'), gf('moneda') ? g.values[gf('moneda')!.id] : undefined)
    row(clientOf(gf('cliente'), g)).gastos += money(importe, cur, fecha as string)
  }

  // Inversión publicitaria (Meta, LinkedIn y X) por cliente (cuentas asignadas).
  const meta = analyze(db, data, { since, until, groupBy: 'cliente', limit: 50 }, currency)
  partial ||= meta.partial
  for (const g of meta.groups) {
    if (g.key.startsWith('__') && g.key !== NONE) continue
    row(g.key).inversion += g.base['gasto'] ?? 0
  }

  // Lo previsto según el acuerdo: fee prorrateado por días y porcentaje del gasto.
  const days = daysBetween(since, until)
  const feeField = cf('fee')
  const feeCurrency = (feeField?.config['currency'] as string | undefined) ?? 'EUR'
  for (const c of clients) {
    const acuerdo = cf('acuerdo')
      ? (c.values[cf('acuerdo')!.id] as string[] | undefined)
      : undefined
    if (!acuerdo?.length) continue
    const r = row(c.id)
    if (acuerdo.includes('fee') && feeField)
      r.feePrevisto += money((num(c.values[feeField.id]) * days) / MONTH_DAYS, feeCurrency, until)
    const pct = cf('porcentaje_gasto') ? num(c.values[cf('porcentaje_gasto')!.id]) : 0
    if (acuerdo.includes('porcentaje') && pct) r.porcentajePrevisto += (r.inversion * pct) / 100
  }

  const list = [...rows.values()]
  for (const r of list) r.beneficio = r.cobrado - r.gastos
  const keys = [
    'facturado',
    'cobrado',
    'pendiente',
    'vencido',
    'gastos',
    'inversion',
    'feePrevisto',
    'porcentajePrevisto',
    'beneficio',
    'facturas',
  ] as const
  const totals = Object.fromEntries(
    keys.map((k) => [k, list.reduce((n, r) => n + r[k], 0)]),
  ) as Pick<BillingRow, (typeof keys)[number]>
  return {
    currency,
    partial,
    since,
    until,
    rows: list
      .filter((r) => keys.some((k) => r[k] !== 0))
      .sort((a, b) => b.facturado - a.facturado || a.client.localeCompare(b.client)),
    totals,
    overdue: overdue.sort((a, b) => a.vencimiento.localeCompare(b.vencimiento)),
  }
}
