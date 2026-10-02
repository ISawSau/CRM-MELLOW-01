import journal from '../../../drizzle/meta/_journal.json'
import type { Migration } from './migrate'

/**
 * Migraciones generadas por drizzle-kit en `drizzle/`. Vite las incrusta en el
 * bundle del proceso principal, así que no hace falta empaquetar la carpeta.
 */
const files = import.meta.glob<string>('../../../drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export const MIGRATIONS: readonly Migration[] = journal.entries.map((e) => {
  const sql = files[`../../../drizzle/${e.tag}.sql`]
  if (sql === undefined) throw new Error(`Falta el archivo de migración ${e.tag}.sql`)
  return { idx: e.idx, tag: e.tag, sql }
})

export const SCHEMA_VERSION = MIGRATIONS.length
