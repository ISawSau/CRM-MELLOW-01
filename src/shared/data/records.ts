import type { FormulaValue } from './formula'

/** Datos que el proceso principal devuelve a la interfaz. */

/** Valor de un campo calculado (fórmula o resumen). */
export type ComputedValue = { value: FormulaValue } | { error: string }

/** Registro enlazado por un campo de relación. */
export interface LinkRef {
  id: string
  title: string
}

export interface RecordRow {
  id: string
  entity: string
  title: string
  /**
   * Valores por id de campo. Guardados: su valor (o ausente si vacío).
   * Relación: LinkRef[]. Fórmula y resumen: ComputedValue.
   */
  values: Record<string, unknown>
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface HistoryChange {
  fieldId: string
  label: string
  from: unknown
  to: unknown
}

export interface HistoryEntry {
  id: number
  at: string
  action: 'create' | 'update' | 'delete' | 'restore'
  changes: HistoryChange[]
}

export interface TrashItem {
  id: string
  entity: string
  title: string
  deletedAt: string
  /** Días que quedan antes de borrarse para siempre. */
  daysLeft: number
}

export interface SearchHit {
  id: string
  entity: string
  title: string
  snippet: string
}

export interface UndoState {
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
}

export interface DataChange {
  entity: string | null
}
