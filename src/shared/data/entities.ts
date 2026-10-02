import type { FieldType, SelectOption } from './fields'
import type { ViewConfig, ViewKind } from './views'

/**
 * Entidades del motor. En la fase 1 solo está activa «Notas»; clientes, tareas y el
 * resto se irán añadiendo en sus fases sobre el mismo motor.
 */
export interface EntitySeedField {
  key: string
  label: string
  type: FieldType
  config?: Record<string, unknown>
  system?: boolean
  required?: boolean
  visible?: boolean
}

export interface EntityDef {
  id: string
  label: string
  /** Nombre en singular para botones: «Nueva nota». */
  singular: string
  /** Género gramatical, para «Nueva nota» / «Nuevo cliente». */
  gender: 'f' | 'm'
  /** Clave del campo que hace de título. */
  titleKey: string
  fields: EntitySeedField[]
  views: { name: string; kind: ViewKind; config: Partial<Record<keyof ViewConfig, unknown>> }[]
}

const opt = (id: string, label: string, color: SelectOption['color']): SelectOption => ({
  id,
  label,
  color,
})

export const ENTITIES: readonly EntityDef[] = [
  {
    id: 'nota',
    label: 'Notas',
    singular: 'nota',
    gender: 'f',
    titleKey: 'titulo',
    fields: [
      { key: 'titulo', label: 'Título', type: 'text', system: true, required: true },
      { key: 'contenido', label: 'Contenido', type: 'longtext', system: true },
      {
        key: 'tipo',
        label: 'Tipo',
        type: 'select',
        config: {
          options: [
            opt('idea', 'Idea', 'melocoton'),
            opt('reunion', 'Reunión', 'azul'),
            opt('referencia', 'Referencia', 'verde'),
          ],
        },
      },
      {
        key: 'etiquetas',
        label: 'Etiquetas',
        type: 'multiselect',
        config: {
          options: [
            opt('importante', 'Importante', 'terracota'),
            opt('pendiente', 'Pendiente', 'ambar'),
          ],
        },
      },
      { key: 'fecha', label: 'Fecha', type: 'date' },
      { key: 'fijada', label: 'Fijada', type: 'checkbox' },
    ],
    views: [
      { name: 'Todas', kind: 'table', config: {} },
      { name: 'Por tipo', kind: 'kanban', config: { groupBy: 'tipo' } },
      { name: 'Calendario', kind: 'calendar', config: { dateField: 'fecha' } },
      { name: 'Tarjetas', kind: 'gallery', config: { cardFields: ['tipo', 'etiquetas'] } },
    ],
  },
]

export function findEntity(id: string): EntityDef | undefined {
  return ENTITIES.find((e) => e.id === id)
}
