import type { FieldDef } from '@shared/data/fields'
import type { View } from '@shared/data/views'

export interface Column {
  field: FieldDef
  width: number
  visible: boolean
}

const DEFAULT_WIDTH: Partial<Record<FieldDef['type'], number>> = {
  longtext: 260,
  number: 110,
  currency: 120,
  percent: 100,
  date: 110,
  datetime: 150,
  checkbox: 80,
  rating: 110,
  checklist: 120,
  recurrence: 200,
  select: 140,
  multiselect: 200,
  url: 180,
  email: 200,
  phone: 130,
  relation: 200,
  formula: 130,
  rollup: 120,
}

export function defaultWidth(f: FieldDef, isTitle: boolean): number {
  if (isTitle) return 300
  return DEFAULT_WIDTH[f.type] ?? 180
}

/**
 * Columnas de la tabla en el orden de la vista. Los campos que la vista no
 * menciona (p. ej. recién creados) van al final, visibles si el campo lo es.
 * El título va siempre primero y no se puede ocultar.
 */
export function viewColumns(fields: FieldDef[], view: View, titleId: string | null): Column[] {
  const byId = new Map(fields.map((f) => [f.id, f]))
  const out: Column[] = []
  const seen = new Set<string>()
  for (const c of view.config.columns) {
    const f = byId.get(c.fieldId)
    if (!f || seen.has(f.id)) continue
    seen.add(f.id)
    out.push({ field: f, width: c.width, visible: c.visible })
  }
  for (const f of fields) {
    if (seen.has(f.id)) continue
    out.push({ field: f, width: defaultWidth(f, f.id === titleId), visible: f.visible })
  }
  const ti = out.findIndex((c) => c.field.id === titleId)
  if (ti > 0) out.unshift(...out.splice(ti, 1))
  if (ti >= 0) out[0]!.visible = true
  return out
}

export function toConfigColumns(cols: Column[]): View['config']['columns'] {
  return cols.map((c) => ({
    fieldId: c.field.id,
    width: Math.round(Math.min(1200, Math.max(60, c.width))),
    visible: c.visible,
  }))
}
