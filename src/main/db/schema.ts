import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

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
