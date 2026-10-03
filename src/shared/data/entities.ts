import type { FieldType, SelectOption } from './fields'
import type { ViewConfig, ViewKind } from './views'

/**
 * Entidades del motor. Cada fase activa las suyas sobre el mismo motor: Notas (fase 1),
 * Clientes y Contactos (fase 2)…
 *
 * La siembra es incremental: cada entidad tiene una versión y cada campo o vista indica
 * desde qué versión existe (`since`). Al abrir una bóveda antigua se añade solo lo que
 * le falta, sin tocar lo que el usuario haya cambiado.
 */
export interface EntitySeedField {
  key: string
  label: string
  type: FieldType
  config?: Record<string, unknown>
  system?: boolean
  required?: boolean
  visible?: boolean
  /** Versión de la siembra en la que aparece el campo (1 si se omite). */
  since?: number
  /** Para relaciones inversas: el campo de relación del que es inverso. */
  inverse?: { entity: string; key: string }
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
  /** Versión actual de la siembra de esta entidad. */
  seedVersion: number
  fields: EntitySeedField[]
  views: {
    name: string
    kind: ViewKind
    config: Partial<Record<keyof ViewConfig, unknown>>
    since?: number
  }[]
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
    seedVersion: 2,
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
      {
        key: 'cliente',
        label: 'Cliente',
        type: 'relation',
        config: { target: 'cliente', multiple: false },
        since: 2,
      },
    ],
    views: [
      { name: 'Todas', kind: 'table', config: {} },
      { name: 'Por tipo', kind: 'kanban', config: { groupBy: 'tipo' } },
      { name: 'Calendario', kind: 'calendar', config: { dateField: 'fecha' } },
      { name: 'Tarjetas', kind: 'gallery', config: { cardFields: ['tipo', 'etiquetas'] } },
    ],
  },
  {
    id: 'cliente',
    label: 'Clientes',
    singular: 'cliente',
    gender: 'm',
    titleKey: 'nombre',
    seedVersion: 1,
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', system: true, required: true },
      { key: 'descripcion', label: 'Descripción', type: 'longtext', system: true },
      {
        key: 'etapa',
        label: 'Etapa',
        type: 'select',
        config: {
          pipeline: true,
          options: [
            opt('prospecto', 'Prospecto', 'gris'),
            opt('propuesta', 'Propuesta enviada', 'azul'),
            opt('negociacion', 'Negociación', 'ambar'),
            opt('onboarding', 'Onboarding', 'lila'),
            opt('activo', 'Activo', 'verde'),
            opt('pausa', 'En pausa', 'melocoton'),
            opt('finalizado', 'Finalizado', 'vino'),
          ],
        },
      },
      {
        key: 'etiquetas',
        label: 'Etiquetas',
        type: 'multiselect',
        config: {
          options: [
            opt('ecommerce', 'Ecommerce', 'azul'),
            opt('servicios', 'Servicios', 'verde'),
            opt('prioritario', 'Prioritario', 'terracota'),
          ],
        },
      },
      { key: 'fee', label: 'Fee mensual', type: 'currency' },
      { key: 'inicio', label: 'Cliente desde', type: 'date' },
      { key: 'web', label: 'Web', type: 'url' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'telefono', label: 'Teléfono', type: 'phone' },
      { key: 'sector', label: 'Sector', type: 'text' },
      {
        key: 'contactos',
        label: 'Contactos',
        type: 'relation',
        config: { target: 'contacto', multiple: true },
        inverse: { entity: 'contacto', key: 'cliente' },
      },
      {
        key: 'notas',
        label: 'Notas',
        type: 'relation',
        config: { target: 'nota', multiple: true },
        inverse: { entity: 'nota', key: 'cliente' },
      },
      { key: 'nif', label: 'NIF / CIF', type: 'text', visible: false },
      { key: 'direccion', label: 'Dirección fiscal', type: 'text', visible: false },
      {
        key: 'moneda',
        label: 'Moneda',
        type: 'select',
        visible: false,
        config: {
          options: [
            opt('eur', 'EUR', 'gris'),
            opt('usd', 'USD', 'gris'),
            opt('gbp', 'GBP', 'gris'),
            opt('mxn', 'MXN', 'gris'),
            opt('chf', 'CHF', 'gris'),
          ],
        },
      },
      { key: 'zona_horaria', label: 'Zona horaria', type: 'text', visible: false },
    ],
    views: [
      { name: 'Todos', kind: 'table', config: {} },
      { name: 'Pipeline', kind: 'kanban', config: { groupBy: 'etapa', cardFields: ['fee'] } },
      { name: 'Tarjetas', kind: 'gallery', config: { cardFields: ['etapa', 'web'] } },
    ],
  },
  {
    id: 'contacto',
    label: 'Contactos',
    singular: 'contacto',
    gender: 'm',
    titleKey: 'nombre',
    seedVersion: 1,
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', system: true, required: true },
      { key: 'notas', label: 'Notas', type: 'longtext', system: true },
      {
        key: 'cliente',
        label: 'Cliente',
        type: 'relation',
        config: { target: 'cliente', multiple: false },
      },
      { key: 'cargo', label: 'Cargo', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'telefono', label: 'Teléfono', type: 'phone' },
      { key: 'linkedin', label: 'LinkedIn', type: 'url' },
      { key: 'principal', label: 'Contacto principal', type: 'checkbox' },
    ],
    views: [
      { name: 'Todos', kind: 'table', config: {} },
      {
        name: 'Tarjetas',
        kind: 'gallery',
        config: { cardFields: ['cliente', 'cargo', 'email'] },
      },
    ],
  },
]

export function findEntity(id: string): EntityDef | undefined {
  return ENTITIES.find((e) => e.id === id)
}
