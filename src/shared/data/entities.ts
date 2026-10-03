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
    seedVersion: 3,
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
      {
        key: 'tareas',
        label: 'Tareas',
        type: 'relation',
        config: { target: 'tarea', multiple: true },
        inverse: { entity: 'tarea', key: 'notas' },
        since: 3,
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
    seedVersion: 3,
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
      {
        key: 'tareas',
        label: 'Tareas',
        type: 'relation',
        config: { target: 'tarea', multiple: true },
        inverse: { entity: 'tarea', key: 'cliente' },
        since: 2,
      },
      {
        key: 'briefs',
        label: 'Briefs',
        type: 'relation',
        config: { target: 'brief', multiple: true },
        inverse: { entity: 'brief', key: 'cliente' },
        since: 2,
      },
      {
        key: 'creatividades',
        label: 'Creatividades',
        type: 'relation',
        config: { target: 'creatividad', multiple: true },
        inverse: { entity: 'creatividad', key: 'cliente' },
        since: 3,
      },
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
  {
    id: 'tarea',
    label: 'Tareas',
    singular: 'tarea',
    gender: 'f',
    titleKey: 'titulo',
    seedVersion: 2,
    fields: [
      { key: 'titulo', label: 'Título', type: 'text', system: true, required: true },
      { key: 'descripcion', label: 'Descripción', type: 'longtext', system: true },
      {
        key: 'estado',
        label: 'Estado',
        type: 'select',
        config: {
          pipeline: true,
          options: [
            opt('pendiente', 'Pendiente', 'gris'),
            opt('en-curso', 'En curso', 'azul'),
            opt('revision', 'En revisión', 'ambar'),
            { ...opt('hecha', 'Hecha', 'verde'), done: true },
          ],
        },
      },
      { key: 'fecha_limite', label: 'Fecha límite', type: 'date' },
      {
        key: 'prioridad',
        label: 'Prioridad',
        type: 'select',
        config: {
          options: [
            opt('baja', 'Baja', 'gris'),
            opt('media', 'Media', 'azul'),
            opt('alta', 'Alta', 'ambar'),
            opt('urgente', 'Urgente', 'terracota'),
          ],
        },
      },
      {
        key: 'cliente',
        label: 'Cliente',
        type: 'relation',
        config: { target: 'cliente', multiple: false },
      },
      { key: 'checklist', label: 'Checklist', type: 'checklist' },
      {
        key: 'etiquetas',
        label: 'Etiquetas',
        type: 'multiselect',
        config: {
          options: [
            opt('creatividad', 'Creatividad', 'lila'),
            opt('campana', 'Campaña', 'azul'),
            opt('informe', 'Informe', 'verde'),
            opt('admin', 'Administración', 'gris'),
          ],
        },
      },
      { key: 'estimacion', label: 'Estimación (h)', type: 'number', config: { decimals: 1 } },
      { key: 'repeticion', label: 'Repetición', type: 'recurrence' },
      {
        key: 'brief',
        label: 'Brief',
        type: 'relation',
        config: { target: 'brief', multiple: false },
      },
      {
        key: 'notas',
        label: 'Notas',
        type: 'relation',
        config: { target: 'nota', multiple: true },
        visible: false,
      },
      { key: 'adjuntos', label: 'Adjuntos', type: 'files', since: 2 },
    ],
    views: [
      {
        name: 'Tablero',
        kind: 'kanban',
        config: { groupBy: 'estado', cardFields: ['fecha_limite', 'prioridad', 'cliente'] },
      },
      {
        name: 'Hoy',
        kind: 'list',
        config: {
          filters: [
            { fieldId: 'fecha_limite', op: 'today', value: null },
            { fieldId: 'estado', op: 'none_of', value: ['hecha'] },
          ],
          cardFields: ['prioridad', 'cliente', 'checklist'],
        },
      },
      {
        name: 'Atrasadas',
        kind: 'list',
        config: {
          filters: [
            { fieldId: 'fecha_limite', op: 'before_today', value: null },
            { fieldId: 'estado', op: 'none_of', value: ['hecha'] },
          ],
          sorts: [{ fieldId: 'fecha_limite', dir: 'asc' }],
          cardFields: ['fecha_limite', 'prioridad', 'cliente'],
        },
      },
      {
        name: 'Todas',
        kind: 'table',
        config: { sorts: [{ fieldId: 'fecha_limite', dir: 'asc' }] },
      },
      { name: 'Calendario', kind: 'calendar', config: { dateField: 'fecha_limite' } },
    ],
  },
  {
    id: 'brief',
    label: 'Briefs',
    singular: 'brief',
    gender: 'm',
    titleKey: 'titulo',
    seedVersion: 2,
    fields: [
      { key: 'titulo', label: 'Título', type: 'text', system: true, required: true },
      { key: 'contenido', label: 'Contenido', type: 'longtext', system: true },
      {
        key: 'estado',
        label: 'Estado',
        type: 'select',
        config: {
          pipeline: true,
          options: [
            opt('borrador', 'Borrador', 'gris'),
            opt('revision', 'En revisión', 'ambar'),
            { ...opt('aprobado', 'Aprobado', 'verde'), done: true },
            { ...opt('archivado', 'Archivado', 'vino'), done: true },
          ],
        },
      },
      {
        key: 'cliente',
        label: 'Cliente',
        type: 'relation',
        config: { target: 'cliente', multiple: false },
      },
      { key: 'entrega', label: 'Entrega', type: 'date' },
      {
        key: 'tareas',
        label: 'Tareas',
        type: 'relation',
        config: { target: 'tarea', multiple: true },
        inverse: { entity: 'tarea', key: 'brief' },
      },
      { key: 'archivos', label: 'Archivos', type: 'files', since: 2 },
      {
        key: 'creatividades',
        label: 'Creatividades',
        type: 'relation',
        config: { target: 'creatividad', multiple: true },
        inverse: { entity: 'creatividad', key: 'brief' },
        since: 2,
      },
    ],
    views: [
      { name: 'Todos', kind: 'table', config: {} },
      {
        name: 'Por estado',
        kind: 'kanban',
        config: { groupBy: 'estado', cardFields: ['cliente', 'entrega'] },
      },
      { name: 'Tarjetas', kind: 'gallery', config: { cardFields: ['estado', 'cliente'] } },
    ],
  },
  {
    id: 'creatividad',
    label: 'Creatividades',
    singular: 'creatividad',
    gender: 'f',
    titleKey: 'nombre',
    seedVersion: 2,
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', system: true, required: true },
      { key: 'texto', label: 'Copy o guion', type: 'longtext', system: true },
      // Fase 7: si el nombre de un anuncio contiene este código, se vinculan solos.
      { key: 'codigo', label: 'Código', type: 'text', since: 2 },
      {
        key: 'tipo',
        label: 'Tipo',
        type: 'select',
        config: {
          options: [
            opt('imagen', 'Imagen', 'azul'),
            opt('video', 'Vídeo', 'lila'),
            opt('carrusel', 'Carrusel', 'verde'),
            opt('primary', 'Primary text', 'melocoton'),
            opt('headline', 'Headline', 'ambar'),
            opt('descripcion', 'Descripción', 'gris'),
            opt('hook', 'Hook', 'terracota'),
            opt('guion', 'Guion', 'vino'),
            opt('otro', 'Otro', 'gris'),
          ],
        },
      },
      { key: 'archivos', label: 'Archivos', type: 'files' },
      {
        key: 'estado',
        label: 'Estado',
        type: 'select',
        config: {
          pipeline: true,
          options: [
            opt('borrador', 'Borrador', 'gris'),
            opt('aprobada', 'Aprobada', 'verde'),
            opt('activa', 'Activa', 'azul'),
            opt('pausada', 'Pausada', 'ambar'),
            { ...opt('quemada', 'Quemada', 'vino'), done: true },
          ],
        },
      },
      {
        key: 'cliente',
        label: 'Cliente',
        type: 'relation',
        config: { target: 'cliente', multiple: false },
      },
      {
        key: 'angulo',
        label: 'Ángulo',
        type: 'multiselect',
        config: {
          options: [
            opt('dolor', 'Dolor', 'terracota'),
            opt('beneficio', 'Beneficio', 'verde'),
            opt('prueba-social', 'Prueba social', 'azul'),
            opt('oferta', 'Oferta', 'ambar'),
            opt('curiosidad', 'Curiosidad', 'lila'),
          ],
        },
      },
      {
        key: 'hook',
        label: 'Hook',
        type: 'multiselect',
        config: {
          options: [
            opt('pregunta', 'Pregunta', 'azul'),
            opt('dato', 'Dato', 'verde'),
            opt('testimonio', 'Testimonio', 'melocoton'),
            opt('polemica', 'Polémica', 'terracota'),
          ],
        },
      },
      {
        key: 'formato',
        label: 'Formato',
        type: 'select',
        config: {
          options: [
            opt('ugc', 'UGC', 'melocoton'),
            opt('estatico', 'Estático', 'azul'),
            opt('motion', 'Motion', 'lila'),
            opt('talking-head', 'Talking head', 'ambar'),
            opt('demo', 'Demo', 'verde'),
          ],
        },
      },
      {
        key: 'proporcion',
        label: 'Proporción',
        type: 'select',
        config: {
          options: [
            opt('1-1', '1:1', 'gris'),
            opt('4-5', '4:5', 'gris'),
            opt('9-16', '9:16', 'gris'),
            opt('16-9', '16:9', 'gris'),
            opt('191-1', '1,91:1', 'gris'),
          ],
        },
      },
      {
        key: 'consciencia',
        label: 'Nivel de consciencia',
        type: 'select',
        config: {
          options: [
            opt('inconsciente', 'Inconsciente', 'gris'),
            opt('problema', 'Consciente del problema', 'terracota'),
            opt('solucion', 'Consciente de la solución', 'ambar'),
            opt('producto', 'Consciente del producto', 'azul'),
            opt('muy', 'Muy consciente', 'verde'),
          ],
        },
      },
      { key: 'avatar', label: 'Avatar', type: 'multiselect', config: { options: [] } },
      { key: 'oferta', label: 'Oferta', type: 'multiselect', config: { options: [] } },
      { key: 'producto', label: 'Producto', type: 'multiselect', config: { options: [] } },
      {
        key: 'brief',
        label: 'Brief',
        type: 'relation',
        config: { target: 'brief', multiple: false },
      },
      { key: 'referencia', label: 'Referencia (swipe file)', type: 'checkbox' },
      { key: 'enlace', label: 'Enlace (biblioteca de anuncios)', type: 'url' },
    ],
    views: [
      {
        name: 'Biblioteca',
        kind: 'gallery',
        config: {
          filters: [{ fieldId: 'referencia', op: 'is_false', value: null }],
          cardFields: ['tipo', 'estado', 'formato'],
        },
      },
      { name: 'Todas', kind: 'table', config: {} },
      {
        name: 'Por estado',
        kind: 'kanban',
        config: { groupBy: 'estado', cardFields: ['tipo', 'cliente'] },
      },
      {
        name: 'Swipe file',
        kind: 'gallery',
        config: {
          filters: [{ fieldId: 'referencia', op: 'is_true', value: null }],
          cardFields: ['tipo', 'angulo'],
        },
      },
    ],
  },
]

export function findEntity(id: string): EntityDef | undefined {
  return ENTITIES.find((e) => e.id === id)
}
