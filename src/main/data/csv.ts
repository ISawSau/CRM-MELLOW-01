import type { FieldDef } from '@shared/data/fields'
import { formatValue } from '@shared/data/format-value'
import type { ComputedValue, RecordRow } from '@shared/data/records'
import { t } from '@shared/i18n'

/**
 * Exportación a CSV pensada para abrirla con Excel en español:
 * separador «;», decimales con coma, UTF-8 con BOM y saltos de línea CRLF.
 */

const NUMERIC = new Set(['number', 'currency', 'percent', 'rating'])

/** Número sin separador de miles y con coma decimal (Excel en español lo lee bien). */
function plainNumber(n: number): string {
  return String(Math.round(n * 1e10) / 1e10).replace('.', ',')
}

function cellText(field: FieldDef, value: unknown): { text: string; numeric: boolean } {
  if (value === null || value === undefined) return { text: '', numeric: false }
  if (NUMERIC.has(field.type) && typeof value === 'number') {
    // Los porcentajes se guardan como fracción (0,15); en el CSV, 15.
    return { text: plainNumber(field.type === 'percent' ? value * 100 : value), numeric: true }
  }
  if (field.type === 'formula' || field.type === 'rollup') {
    const c = value as ComputedValue
    if ('value' in c && typeof c.value === 'number')
      return { text: plainNumber(c.value), numeric: true }
  }
  return { text: formatValue(field, value), numeric: false }
}

function escapeCell(text: string, numeric: boolean): string {
  // Protección contra «inyección de fórmulas» en Excel: un texto que empieza por
  // = + - @ se trataría como fórmula al abrir el CSV.
  const safe = !numeric && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function header(field: FieldDef): string {
  if (field.type === 'currency') {
    const cur = (field.config['currency'] as string | undefined) ?? 'EUR'
    return `${t(field.label)} (${cur})`
  }
  if (field.type === 'percent') return `${t(field.label)} (%)`
  return t(field.label)
}

export function toCsv(fields: FieldDef[], rows: RecordRow[]): string {
  const lines = [fields.map((f) => escapeCell(header(f), false)).join(';')]
  for (const row of rows) {
    lines.push(
      fields
        .map((f) => {
          const { text, numeric } = cellText(f, row.values[f.id])
          return escapeCell(text, numeric)
        })
        .join(';'),
    )
  }
  return '﻿' + lines.join('\r\n') + '\r\n'
}
