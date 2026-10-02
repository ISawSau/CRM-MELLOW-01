import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { AppError } from '@shared/errors'
import * as schema from './schema'

export type SqliteDb = Database.Database
export type Db = BetterSQLite3Database<typeof schema>

/**
 * Cifrado compatible con SQLCipher 4 (AES-256-CBC + HMAC-SHA512 por página).
 * Se usa la clave en bruto (hex) derivada de la clave maestra; SQLCipher no aplica
 * su propio PBKDF2 porque la derivación ya la hace Argon2id.
 */
function applyKey(db: SqliteDb, key: Buffer, pragma: 'key' | 'rekey'): void {
  if (key.length !== 32) throw new Error('La clave de la base de datos debe tener 32 bytes')
  if (pragma === 'key') {
    db.pragma(`cipher='sqlcipher'`)
    db.pragma('legacy=4')
  }
  db.pragma(`${pragma}="x'${key.toString('hex')}'"`)
}

/**
 * Abre (o crea) la base de datos cifrada. Lanza WRONG_PASSWORD si la clave no
 * descifra el archivo.
 */
export function openEncryptedDb(path: string, key: Buffer): SqliteDb {
  const db = new Database(path)
  try {
    applyKey(db, key, 'key')
    // Primera lectura real: aquí falla con SQLITE_NOTADB si la clave no es la correcta.
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch (e) {
    db.close()
    if ((e as { code?: string }).code === 'SQLITE_NOTADB') throw new AppError('WRONG_PASSWORD')
    throw e
  }
  db.pragma('journal_mode = WAL')
  // FULL: cada transacción confirmada sobrevive a un corte de luz. Para un solo
  // usuario el coste en rendimiento es irrelevante y los datos importan más.
  db.pragma('synchronous = FULL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  return db
}

export function toDrizzle(db: SqliteDb): Db {
  return drizzle(db, { schema })
}

/** Vuelca el WAL al archivo principal para que crm.db quede consistente por sí solo. */
export function checkpoint(db: SqliteDb): void {
  db.pragma('wal_checkpoint(TRUNCATE)')
}

/** Cierra dejando un único archivo, sin -wal ni -shm (SPEC §3). */
export function closeDb(db: SqliteDb): void {
  if (!db.open) return
  checkpoint(db)
  db.close()
}

/** Re-cifra toda la base de datos con una clave nueva. */
export function rekeyDb(db: SqliteDb, newKey: Buffer): void {
  applyKey(db, newKey, 'rekey')
  db.prepare('SELECT count(*) FROM sqlite_master').get()
}
