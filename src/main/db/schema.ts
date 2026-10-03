import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Esquema de la base de datos (Drizzle). Las migraciones SQL se generan con
 * `npm run db:generate` a partir de este archivo y se guardan en `drizzle/`.
 */

/** Ajustes de la app que viven dentro de la bóveda (valor en JSON). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull(),
})

// --- Motor de datos (fase 1, SPEC §6) ------------------------------------------
//
// Todas las entidades (notas, y más adelante clientes, tareas…) comparten la tabla
// `records`. Los valores de los campos van en la columna JSON `data`, con el id del
// campo como clave (así renombrar un campo no toca los datos).

/** Registros de cualquier entidad. `deleted_at` no nulo = en la papelera. */
export const records = sqliteTable(
  'records',
  {
    id: text('id').primaryKey(),
    entity: text('entity').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('records_entity_idx').on(t.entity, t.deletedAt),
    index('records_updated_idx').on(t.updatedAt),
  ],
)

/** Definición de los campos de cada entidad (de sistema y personalizados). */
export const fieldDefs = sqliteTable(
  'field_defs',
  {
    id: text('id').primaryKey(),
    entity: text('entity').notNull(),
    /** Nombre corto para las fórmulas (a-z, 0-9 y _). */
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: text('type').notNull(),
    config: text('config', { mode: 'json' }).notNull(),
    position: integer('position').notNull(),
    visible: integer('visible', { mode: 'boolean' }).notNull(),
    required: integer('required', { mode: 'boolean' }).notNull(),
    system: integer('system', { mode: 'boolean' }).notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    /** Campo eliminado (restaurable): sus valores siguen en `records.data`. */
    deletedAt: text('deleted_at'),
  },
  (t) => [uniqueIndex('field_defs_entity_key_idx').on(t.entity, t.key)],
)

/** Vínculos de los campos de tipo relación: registro origen → registro destino. */
export const links = sqliteTable(
  'links',
  {
    fieldId: text('field_id').notNull(),
    fromId: text('from_id').notNull(),
    toId: text('to_id').notNull(),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fieldId, t.fromId, t.toId] }),
    index('links_from_idx').on(t.fromId),
    index('links_to_idx').on(t.toId),
  ],
)

/** Vistas guardadas (tabla, lista, kanban, calendario, galería). */
export const views = sqliteTable(
  'views',
  {
    id: text('id').primaryKey(),
    entity: text('entity').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    config: text('config', { mode: 'json' }).notNull(),
    position: integer('position').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('views_entity_idx').on(t.entity)],
)

/** Historial de cambios por registro. */
export const history = sqliteTable(
  'history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recordId: text('record_id').notNull(),
    entity: text('entity').notNull(),
    at: text('at').notNull(),
    /** create | update | delete | restore */
    action: text('action').notNull(),
    /** { [fieldId]: { from, to } } */
    changes: text('changes', { mode: 'json' }).notNull(),
  },
  (t) => [index('history_record_idx').on(t.recordId, t.at)],
)

/**
 * Archivos de la bóveda (fase 4). El contenido va cifrado en `files/`; aquí solo
 * los metadatos. El id es un HMAC del contenido (deduplica sin revelar su hash).
 */
export const files = sqliteTable('files', {
  id: text('id').primaryKey(),
  size: integer('size').notNull(),
  mime: text('mime').notNull(),
  width: integer('width'),
  height: integer('height'),
  /** Duración en segundos (vídeo y audio). */
  duration: integer('duration'),
  hasThumb: integer('has_thumb').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

/** Versiones guardadas de un registro (creatividades y copies, fase 4). */
export const versions = sqliteTable(
  'versions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    recordId: text('record_id').notNull(),
    number: integer('number').notNull(),
    note: text('note').notNull().default(''),
    /** Copia de los valores guardados del registro en ese momento. */
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('versions_record_number').on(t.recordId, t.number)],
)
