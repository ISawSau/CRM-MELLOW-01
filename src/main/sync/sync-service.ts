import { createHash, randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { BackupEntry, SyncProgress, SyncStatus } from '@shared/ipc'
import { backupVault } from '../db/backup'
import type { SqliteDb } from '../db/connection'
import { SCHEMA_VERSION } from '../db/migrations'
import { loadOrCreateFilesKey } from '../files/file-store'
import { deriveSubkey, zeroize } from '../vault/crypto'
import {
  VAULT_FILES,
  readManifest,
  vaultManifestSchema,
  writeManifest,
  type VaultManifest,
} from '../vault/vault-file'
import type { VaultService } from '../vault/vault-service'
import { ChangeLog, type AppliedChanges, type PackRow } from './changes'
import {
  connectGoogle,
  refreshAccess,
  type ConnectOptions,
  type GoogleClient,
  type GoogleLogins,
} from './google-auth'
import { openPack, sealPack, type Pack } from './packs'
import {
  DRIVE_ROOT_PREFIX,
  DriveRemote,
  FolderRemote,
  isNetworkError,
  type DriveTiming,
  type DriveUrls,
  type FetchLike,
  type Remote,
} from './remote'
import { t, tn } from '@shared/i18n'

/**
 * Sincronización entre equipos y copias de seguridad (SPEC §4).
 *
 * Por cambios (D-125). Cada equipo apunta las filas que cambia (`ChangeLog`) y las sube en
 * paquetes pequeños y cifrados, `changes/<época>/<equipo>-<n>.bin`. Los demás bajan solo
 * los paquetes que aún no tienen y los aplican: si dos equipos cambian la misma fila, gana
 * el cambio más reciente. No hay avisos de conflicto.
 *
 * Para que la nube no crezca sin fin, de vez en cuando un equipo sube una instantánea
 * completa (`snapshots/<id>/crm.db`) que dice qué paquetes incluye, y se borran los que ya
 * cubría la anterior. Un equipo que llega tarde (sus paquetes ya no están) se pone al día
 * desde la instantánea sin perder lo que tenía sin subir.
 *
 * Una «época» empieza con una instantánea: al pasar del formato anterior, al rotar la clave
 * maestra (la base de datos se vuelve a cifrar) o al restaurar una copia de seguridad.
 * Los equipos que vienen de otra época se ponen al día desde su instantánea.
 *
 * `sync.json`: formato, época, instantánea actual y la anterior. El formato 1 (la base de
 * datos entera cada vez, con conflictos) solo se lee para pasar al 2.
 */

const CONFIG_KEY = 'sync.config'
const STATE_KEY = 'sync.state'
const V2_KEY = 'sync.v2'
/** Qué instantánea es esta base de datos (va dentro de cada instantánea, D-125). */
const SNAPSHOT_KEY = 'sync.snapshot'
const BACKUP_CONFIG_KEY = 'backups.config'
const BACKUP_LAST_KEY = 'backups.last'
export const CHANGES_KEY = 'sync.changes'
/** Tras restaurar una copia: lo restaurado empieza una época nueva. */
const FORCE_PUSH_KEY = 'sync.forcePush'
/** Este equipo: con datos móviles, bajar también libros y archivos (D-131; `sync.*` no viaja). */
const MOBILE_FILES_KEY = 'sync.mobileFiles'
const AUTO_REASON = 'automatica'
const SYNC_BACKUP_REASON = 'antes-de-sincronizar'
/** Copias «antes de sincronizar» que se guardan (antes se guardaban todas). */
const KEEP_SYNC_BACKUPS = 3
const PERIODIC_MS = 30 * 60_000
/** Identidad de este equipo, en la carpeta de la bóveda (no va en la base de datos). */
const DEVICE_FILE = '.equipo.json'
/**
 * Cambios de aquí sin subir mientras se cambia de instantánea, cifrados como un paquete: si
 * la nueva pide otra contraseña, esperan aquí a que se desbloquee.
 */
const STASH_FILE = '.cambios-pendientes.bin'
/** Filas por paquete y tamaño máximo (la subida simple de Drive admite hasta 5 MB). */
const PACK_ROWS = 4000
const PACK_MAX_BYTES = 4 * 1024 * 1024
/**
 * Instantánea nueva (la base de datos entera) solo cuando compensa (D-133): si los paquetes
 * ya pesan la mitad que la última instantánea (y al menos esto), o si son muchísimos. Nunca
 * por antigüedad: con paquetes pequeños, subir cientos de MB no ahorra nada a nadie.
 */
const COMPACT_PACKS = 2000
const COMPACT_MIN_BYTES = 32 * 1024 * 1024
const PACK_NAME = /^([a-f0-9]{12})-(\d{8})\.bin$/

const configSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder'), path: z.string().min(1) }),
  z.object({
    kind: z.literal('drive'),
    clientId: z.string().min(1),
    clientSecret: z.string(),
    refreshToken: z.string().min(1),
    rootName: z.string().min(1),
  }),
])
type SyncConfig = z.infer<typeof configSchema>

/** Estado del formato 1 (solo para pasar al 2). */
const stateSchema = z.object({
  generation: z.number().int().min(0).default(0),
  changeMark: z.number().int().min(0).default(0),
  lastSyncAt: z.string().nullable().default(null),
})
type SyncState = z.infer<typeof stateSchema>

/** Estado de este equipo en el formato 2. */
const v2StateSchema = z.object({
  device: z.string(),
  epoch: z.string(),
  /** Último paquete propio subido. */
  seq: z.number().int().min(0),
  /** Último paquete aplicado de cada equipo (también el propio). */
  applied: z.record(z.string(), z.number().int().min(0)),
  snapshot: z.string(),
  keyGeneration: z.number().int(),
  /** Huella del vault.json ya compartido (cambio de contraseña, D-125). */
  manifestHash: z.string(),
  lastSyncAt: z.string().nullable(),
})
type V2State = z.infer<typeof v2StateSchema>

export const backupConfigSchema = z.object({
  intervalDays: z.number().int().min(1).max(60).default(3),
  keepLast: z.number().int().min(1).max(100).default(10),
  keepMonthly: z.boolean().default(true),
  /**
   * Subir también cada copia a la nube (D-133). Cada una es la base de datos entera y la
   * nube ya guarda la bóveda (instantánea y cambios): por defecto, solo en este equipo.
   */
  cloud: z.boolean().default(false),
})
export type BackupConfig = z.infer<typeof backupConfigSchema>

/** `sync.json` del formato 1. */
export const manifestSchema = z.object({
  format: z.literal('crm-mellow-sync'),
  version: z.literal(1),
  vaultId: z.string(),
  generation: z.number().int().min(1),
  device: z.string(),
  uploadedAt: z.string(),
})
type RemoteManifest = z.infer<typeof manifestSchema>

const snapshotSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{16}$/),
  device: z.string(),
  createdAt: z.string(),
  /** Bytes de su crm.db (D-133; falta en las anteriores). */
  size: z.number().int().min(0).optional(),
  /** Último paquete de cada equipo que ya va dentro. */
  covers: z.record(z.string(), z.number().int().min(0)),
})

/** `sync.json` del formato 2 (D-125). */
export const manifestV2Schema = z.object({
  format: z.literal('crm-mellow-sync'),
  version: z.literal(2),
  vaultId: z.string(),
  epoch: z.string().regex(/^[a-f0-9]{16}$/),
  /** Migraciones de la instantánea (una app más antigua no la puede abrir). */
  schema: z.number().int().min(0),
  keyGeneration: z.number().int(),
  snapshot: snapshotSchema,
  previous: snapshotSchema.nullable().default(null),
  updatedAt: z.string(),
  /** Nombre del equipo que la escribió (se enseña al elegir en un conflicto). */
  deviceName: z.string(),
  /**
   * La época viene de restaurar una copia: los demás equipos la toman tal cual, sin juntar
   * lo suyo (si no, deshacerlo no serviría de nada). Las demás épocas juntan (D-126).
   */
  authoritative: z.boolean().default(false),
})
export type ManifestV2 = z.infer<typeof manifestV2Schema>

export function readSetting(db: SqliteDb, key: string): unknown {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined
  return r ? JSON.parse(r.value) : undefined
}

export function writeSetting(db: SqliteDb, key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, JSON.stringify(value), new Date().toISOString())
}

export function deleteSetting(db: SqliteDb, key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key)
}

/** «20261003-012345-automatica» → fecha ISO, motivo. */
export function parseBackupName(name: string): { date: string; reason: string } | null {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)$/.exec(name)
  if (!m) return null
  return { date: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`, reason: m[7]! }
}

/**
 * Qué copias automáticas sobran: se conservan las `keepLast` más recientes y, si
 * `keepMonthly`, la más reciente de cada mes. Devuelve los nombres a borrar.
 */
export function backupsToPrune(names: string[], cfg: BackupConfig): string[] {
  const autos = names
    .filter((n) => parseBackupName(n)?.reason.startsWith(AUTO_REASON))
    .sort()
    .reverse()
  const keep = new Set(autos.slice(0, cfg.keepLast))
  if (cfg.keepMonthly) {
    const months = new Set<string>()
    for (const n of autos) {
      const month = n.slice(0, 6)
      if (!months.has(month)) {
        months.add(month)
        keep.add(n)
      }
    }
  }
  return autos.filter((n) => !keep.has(n))
}

const randomId = () => randomBytes(8).toString('hex')
const pad = (n: number) => String(n).padStart(8, '0')

/** Huella del vault.json sin el número de migraciones (eso es de cada equipo). */
function manifestHash(m: VaultManifest): string {
  return createHash('sha256')
    .update(JSON.stringify({ ...m, schemaVersion: 0 }))
    .digest('hex')
}

export interface SyncServiceOptions {
  hostname: string
  /**
   * Archivos que se bajan solos de la nube: los de este tamaño o menos (en el móvil, para
   * no llenarlo de vídeos, D-101). Las miniaturas se bajan siempre. Sin límite si no se da.
   */
  maxAutoDownloadBytes?: number
  /** Archivos que se bajan aunque pasen de `maxAutoDownloadBytes` (los libros, D-123). */
  alwaysDownload?: () => Set<string>
  openBrowser: (url: string) => void
  /** Inicio de sesión con Google en curso (pegar la dirección, cancelar, D-118). */
  logins?: GoogleLogins
  /** Direcciones de Google (tests). */
  connect?: Pick<ConnectOptions, 'authUrl' | 'tokenUrl'>
  driveUrls?: DriveUrls
  onChange?: (s: SyncStatus) => void
  /** Han llegado cambios de otro equipo: la interfaz y los servicios se refrescan. */
  onApplied?: (changes: AppliedChanges) => void
  /** Hay un cambio local nuevo (para subirlo enseguida, D-125). */
  onLocalChange?: () => void
  /**
   * Mientras sincroniza (D-124): en Android, servicio en primer plano y pantalla encendida,
   * para que el sistema no congele la app ni le corte la red a mitad. Devuelve cómo soltarlo.
   */
  hold?: (text: string) => () => void
  /** Paquetes a partir de los que se hace una instantánea nueva (tests). */
  compactPacks?: number
  /** Bytes de paquetes a partir de los que compensa una instantánea (tests, D-133). */
  compactMinBytes?: number
  /**
   * ¿Puede este equipo subir instantáneas (la base de datos entera) para resumir los
   * paquetes? El móvil no (D-133): lo hace el ordenador, y nunca con datos móviles.
   */
  compact?: boolean
  /** Espera tras un cambio antes de subirlo (tests). */
  changeDelayMs?: number
  /** Mínimo entre subidas automáticas (tests, D-131). */
  minPushGapMs?: number
  /**
   * ¿La red es de pago por uso (datos móviles, D-131)? Entonces solo viajan los cambios:
   * los archivos y libros se bajan con wifi o al abrirlos.
   */
  metered?: () => Promise<boolean>
  http?: FetchLike
  /** Tiempos de Drive (tests). */
  driveTiming?: Partial<DriveTiming>
  now?: () => Date
}

/** Cada cuánto, como mucho, se avisa a la interfaz del progreso. */
const PROGRESS_EMIT_MS = 400
/** Tras un cambio, se sube a los pocos segundos (se juntan los que vienen seguidos). */
const CHANGE_DELAY_MS = 4_000
/**
 * Las subidas automáticas, como mucho una cada tanto (D-131): leyendo, cada página es un
 * cambio y cada subida un paquete que el otro equipo baja. Al cerrar, bloquear, pasar a
 * segundo plano o a mano se sube al momento.
 */
const MIN_PUSH_GAP_MS = 2 * 60_000
/** Cuánto se reutilizan los ids de Drive ya buscados. */
const REMOTE_TTL_MS = 15 * 60_000
/** Un archivo que no estaba en la nube no se vuelve a buscar hasta pasado esto. */
const ABSENT_RETRY_MS = 30 * 60_000
/** Paquetes que se bajan a la vez (cada uno es una petición a Drive, D-131). */
const PULL_PARALLEL = 6
/** Con la app abierta, se mira si hay algo nuevo cada minuto. */
const LIVE_MS = 60_000
/** Una sincronización automática se enseña si mueve más que esto. */
const VISIBLE_BYTES = 256 * 1024

/**
 * `manual`: «Sincronizar ahora» (se ve y mantiene el móvil despierto). `auto`: tras un
 * cambio, cada minuto o al volver a la app (no se ve salvo que mueva algo grande).
 * `background`: al cerrar o pasar a segundo plano (no se ve, pero mantiene la app viva).
 */
export type SyncMode = 'manual' | 'auto' | 'background'

export class SyncService {
  private phase: SyncStatus['phase'] = 'idle'
  /** Cómo se lanzó la sincronización en curso. */
  private mode: SyncMode = 'manual'
  /** Cuándo se subió el último paquete (para no subir uno por página leída, D-131). */
  private lastPushAt = 0
  private cachedRemote: { key: string; remote: Remote; at: number } | null = null
  /** Archivos que no estaban en la nube la última vez que se buscaron, y cuándo. */
  private readonly absent = new Map<string, number>()
  /** Archivos que se están bajando al abrirlos (D-131). */
  private readonly fetching = new Map<string, Promise<boolean>>()
  private error: string | null = null
  private conflict: SyncStatus['conflict'] = null
  private running: Promise<void> | null = null
  private again: SyncMode | null = null
  /** Sincronización automática: no se enseña salvo que mueva algo grande (D-125). */
  private quiet = false
  private visible = false
  private appliedSomething = false
  private lazyHold: (() => void) | null = null
  private changeTimer: ReturnType<typeof setTimeout> | null = null
  private liveTimer: ReturnType<typeof setInterval> | null = null
  private active = true
  private access: { token: string; expiresAt: number } | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private progress: SyncProgress | null = null
  private lastProgressEmit = 0
  private log: ChangeLog | null = null
  /** Los archivos de la nube ya se han comparado en esta sesión. */
  private blobsChecked = false
  private deviceCache: { path: string; id: string } | null = null
  /** Hay destino configurado: solo entonces se apuntan los cambios. */
  private configured = false

  constructor(
    private readonly vault: VaultService,
    private readonly opts: SyncServiceOptions,
  ) {
    this.vault.onUnlocked(() => this.attach())
    try {
      this.attach()
    } catch {
      // Bloqueada: se instala al desbloquear.
    }
  }

  /** Registro de cambios sobre la conexión abierta (se rehace al reabrir la bóveda). */
  private attach(): ChangeLog {
    const db = this.vault.sqlite
    if (this.log?.db !== db) {
      this.log = new ChangeLog(db, {
        device: () => this.deviceId(),
        onChange: () => this.opts.onLocalChange?.(),
        active: () => this.configured,
      })
      this.blobsChecked = false
      this.configured = !!this.config()
    }
    return this.log
  }

  private get http(): FetchLike {
    return this.opts.http ?? fetch
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date()
  }

  private db(): SqliteDb {
    return this.vault.sqlite
  }

  private vaultPath(): string {
    return this.vault.currentPath!
  }

  /**
   * Id de este equipo (12 hexadecimales). Vive en la carpeta de la bóveda con el nombre del
   * equipo y la ruta: una copia de la carpeta en otro sitio es otro equipo.
   */
  deviceId(): string {
    const path = this.vaultPath()
    if (this.deviceCache?.path === path) return this.deviceCache.id
    const file = join(path, DEVICE_FILE)
    let id: string | null = null
    try {
      const d = JSON.parse(readFileSync(file, 'utf8')) as {
        id?: string
        host?: string
        path?: string
      }
      if (
        typeof d.id === 'string' &&
        /^[a-f0-9]{12}$/.test(d.id) &&
        d.host === this.opts.hostname &&
        d.path === path
      )
        id = d.id
    } catch {
      // Aún no tiene.
    }
    if (!id) {
      id = randomBytes(6).toString('hex')
      writeFileSync(file, JSON.stringify({ id, host: this.opts.hostname, path }, null, 2) + '\n')
    }
    this.deviceCache = { path, id }
    return id
  }

  private config(): SyncConfig | null {
    const r = configSchema.safeParse(readSetting(this.db(), CONFIG_KEY))
    return r.success ? r.data : null
  }

  /** El cliente de Google de Drive, para reutilizarlo en Gmail (mismo proyecto). */
  googleClient(): GoogleClient | null {
    try {
      const c = this.config()
      return c?.kind === 'drive' ? { clientId: c.clientId, clientSecret: c.clientSecret } : null
    } catch {
      return null
    }
  }

  private state(): SyncState {
    return stateSchema.parse(readSetting(this.db(), STATE_KEY) ?? {})
  }

  private v2(): V2State | null {
    const r = v2StateSchema.safeParse(readSetting(this.db(), V2_KEY))
    const device = this.deviceId()
    if (r.success && r.data.device === device) return r.data
    // La base de datos viene de otro equipo (traída de Drive, o la carpeta se ha copiado o
    // movido): este equipo empieza en la instantánea que es. Volver a aplicar paquetes que
    // ya tenía no cambia nada (gana el más reciente, y es el mismo).
    const snap = z
      .object({ epoch: z.string(), id: z.string(), covers: z.record(z.string(), z.number()) })
      .safeParse(readSetting(this.db(), SNAPSHOT_KEY))
    if (!snap.success) return null
    const local = readManifest(this.vaultPath())
    const st: V2State = {
      device,
      epoch: snap.data.epoch,
      seq: snap.data.covers[device] ?? 0,
      applied: { ...snap.data.covers },
      snapshot: snap.data.id,
      keyGeneration: local.keyGeneration,
      manifestHash: manifestHash(local),
      lastSyncAt: null,
    }
    this.saveV2(st)
    return st
  }

  private saveV2(st: V2State): void {
    writeSetting(this.db(), V2_KEY, st)
  }

  private changes(): number {
    const v = readSetting(this.db(), CHANGES_KEY)
    return typeof v === 'number' ? v : 0
  }

  /** Cambios del formato 1 sin subir (solo cuenta antes de pasar al 2). */
  private v1Dirty(): boolean {
    const v = readSetting(this.db(), STATE_KEY)
    if (v === undefined) return false
    const st = this.state()
    return st.generation > 0 && this.changes() > st.changeMark
  }

  backupConfig(): BackupConfig {
    return backupConfigSchema.parse(readSetting(this.db(), BACKUP_CONFIG_KEY) ?? {})
  }

  setBackupConfig(cfg: BackupConfig): SyncStatus {
    writeSetting(this.db(), BACKUP_CONFIG_KEY, backupConfigSchema.parse(cfg))
    return this.emit()
  }

  /** ¿Hay algo de aquí sin subir? */
  private hasPending(): boolean {
    if (readSetting(this.db(), FORCE_PUSH_KEY) === true) return true
    const st = this.v2()
    if (!st) return this.v1Dirty() || (this.attach().pending() > 0 && !!this.config())
    if (this.attach().pending() > 0) return true
    const local = readManifest(this.vaultPath())
    return manifestHash(local) !== st.manifestHash && local.keyGeneration === st.keyGeneration
  }

  status(): SyncStatus {
    let cfg: SyncConfig | null = null
    let lastSync: string | null = null
    let last: string | null = null
    let pending = false
    try {
      cfg = this.config()
      lastSync = this.v2()?.lastSyncAt ?? this.state().lastSyncAt
      pending = !!cfg && this.hasPending()
      const l = readSetting(this.db(), BACKUP_LAST_KEY)
      last = typeof l === 'string' ? l : null
    } catch {
      // Bóveda bloqueada.
    }
    return {
      kind: cfg?.kind ?? null,
      label: cfg ? this.remoteFor(cfg).label : null,
      phase: this.phase === 'syncing' && !this.visible ? 'idle' : this.phase,
      error: this.error,
      conflict: this.conflict,
      lastSyncAt: lastSync,
      pending,
      lastBackupAt: last,
      progress: this.phase === 'syncing' ? this.progress : null,
      mobileFiles: this.mobileFiles(),
    }
  }

  private mobileFiles(): boolean {
    try {
      return readSetting(this.db(), MOBILE_FILES_KEY) === true
    } catch {
      return false
    }
  }

  /** Con datos móviles, bajar también libros y archivos (D-131). */
  setMobileFiles(on: boolean): SyncStatus {
    writeSetting(this.db(), MOBILE_FILES_KEY, on)
    if (on && this.configured) void this.sync('auto').catch(() => {})
    return this.emit()
  }

  /** ¿Red de pago por uso? Si no se sabe, se supone que sí (D-133). */
  private async onMetered(): Promise<boolean> {
    return this.opts.metered ? this.opts.metered().catch(() => true) : false
  }

  /** ¿Solo viajan los cambios? Con datos móviles, salvo que se haya pedido lo contrario. */
  private async light(): Promise<boolean> {
    if (!this.opts.metered || this.mobileFiles()) return false
    return this.opts.metered().catch(() => false)
  }

  /**
   * Un archivo (un libro) que aún no está en este equipo: se baja ahora, al abrirlo, aunque
   * sea con datos móviles (D-131). True si ya está aquí.
   */
  async fetchFile(id: string): Promise<boolean> {
    if (!/^[0-9a-f]{64}$/.test(id)) return false
    const dest = join(this.vaultPath(), 'files', id.slice(0, 2), `${id}.bin`)
    if (existsSync(dest)) return true
    // Si ya se está bajando (el visor pide el mismo archivo varias veces), se espera a esa.
    const busy = this.fetching.get(id)
    if (busy) return busy
    const run = this.fetchNow(id, dest).finally(() => this.fetching.delete(id))
    this.fetching.set(id, run)
    return run
  }

  private async fetchNow(id: string, dest: string): Promise<boolean> {
    const remote = this.remote()
    if (!remote) return false
    const size = (
      this.db().prepare('SELECT size FROM files WHERE id = ?').get(id) as
        { size: number } | undefined
    )?.size
    if (size === undefined) return false
    // Con una sincronización en marcha, su progreso manda; si no, se enseña esta bajada.
    const shown = !this.running
    const report = (bytes: number, force = false) => {
      if (!shown || this.running) return
      this.phase = 'syncing'
      this.visible = true
      this.report({ step: 'bajando', done: 0, total: 1, bytes, totalBytes: size }, force)
    }
    report(0, true)
    try {
      const got = await remote.get(`files/${id}.bin`, dest, (bytes) => report(bytes))
      return got && existsSync(dest)
    } catch {
      return false
    } finally {
      if (shown && !this.running) {
        this.phase = this.error ? 'error' : 'idle'
        this.progress = null
        this.emit()
      }
    }
  }

  private emit(): SyncStatus {
    const s = this.status()
    this.opts.onChange?.(s)
    return s
  }

  private remoteFor(cfg: SyncConfig): Remote {
    if (cfg.kind === 'folder') return new FolderRemote(cfg.path)
    const client: GoogleClient = { clientId: cfg.clientId, clientSecret: cfg.clientSecret }
    return new DriveRemote(
      cfg.rootName,
      async () => {
        if (this.access && this.access.expiresAt - 60_000 > Date.now()) return this.access.token
        const fresh = await refreshAccess(client, cfg.refreshToken, this.http, {
          ...(this.opts.connect?.tokenUrl ? { tokenUrl: this.opts.connect.tokenUrl } : {}),
        })
        this.access = { token: fresh.accessToken, expiresAt: fresh.expiresAt }
        return fresh.accessToken
      },
      this.http,
      this.opts.driveUrls,
      this.opts.driveTiming,
    )
  }

  /**
   * El destino se reutiliza entre sincronizaciones (D-131): recuerda los ids de Drive de sus
   * carpetas y archivos, y la comprobación de cada minuto no los vuelve a buscar. Se olvida
   * a mano, tras un error y cada rato, por si alguien toca la carpeta en Drive.
   */
  private remote(): Remote | null {
    const cfg = this.config()
    if (!cfg) return null
    const key = JSON.stringify(cfg)
    const now = this.now().getTime()
    const c = this.cachedRemote
    if (c && c.key === key && now - c.at < REMOTE_TTL_MS) return c.remote
    const remote = this.remoteFor(cfg)
    this.cachedRemote = { key, remote, at: now }
    return remote
  }

  // --- Configuración -------------------------------------------------------------

  configureFolder(path: string): SyncStatus {
    if (!existsSync(path))
      throw new AppError('INVALID_INPUT', undefined, t('La carpeta no existe.'))
    const vaultPath = this.vault.currentPath
    if (vaultPath && (path.startsWith(vaultPath) || vaultPath.startsWith(path)))
      throw new AppError(
        'INVALID_INPUT',
        undefined,
        t('Elige una carpeta fuera de la bóveda (y que no la contenga).'),
      )
    writeSetting(this.db(), CONFIG_KEY, { kind: 'folder', path })
    this.configured = true
    this.resetState()
    return this.emit()
  }

  async configureDrive(client: GoogleClient): Promise<SyncStatus> {
    const tokens = await connectGoogle(client, this.opts.openBrowser, this.http, {
      ...this.opts.connect,
      ...(this.opts.logins ? { logins: this.opts.logins } : {}),
    })
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
    const id = (this.vault.vaultId ?? 'boveda').slice(0, 8)
    writeSetting(this.db(), CONFIG_KEY, {
      kind: 'drive',
      ...client,
      refreshToken: tokens.refreshToken,
      rootName: `${DRIVE_ROOT_PREFIX}${id}`,
    })
    this.configured = true
    this.resetState()
    return this.emit()
  }

  disconnect(): SyncStatus {
    deleteSetting(this.db(), CONFIG_KEY)
    this.configured = false
    this.resetState()
    this.access = null
    this.conflict = null
    this.error = null
    this.phase = 'idle'
    return this.emit()
  }

  /**
   * Destino nuevo: aún no se ha sincronizado nada con él. Lo que ya hay aquí no cuenta
   * como pendiente: si el destino está vacío se sube igualmente, y si ya tiene datos
   * (otro equipo) se descargan (lo de aquí queda como copia de seguridad).
   */
  private resetState(): void {
    writeSetting(this.db(), STATE_KEY, {
      generation: 0,
      changeMark: this.changes(),
      lastSyncAt: null,
    })
    deleteSetting(this.db(), V2_KEY)
    this.attach().clear()
    this.blobsChecked = false
  }

  // --- Ciclo de sincronización ---------------------------------------------------

  /** Tras desbloquear: sincroniza, copia de seguridad si toca y arranca los ciclos. */
  async afterUnlock(): Promise<void> {
    this.stopTimer()
    await this.sync('auto')
    try {
      await this.maybeBackup()
    } catch (e) {
      this.fail(e)
    }
    this.startLive()
    this.timer = setInterval(() => {
      void this.maybeBackup().catch(() => {})
    }, PERIODIC_MS)
    this.timer.unref?.()
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.liveTimer) clearInterval(this.liveTimer)
    if (this.changeTimer) clearTimeout(this.changeTimer)
    this.timer = null
    this.liveTimer = null
    this.changeTimer = null
  }

  /** Antes de bloquear o cerrar: sube lo pendiente (con límite de tiempo). */
  async beforeClose(timeoutMs = 60_000): Promise<void> {
    this.stopTimer()
    let pending: boolean
    try {
      pending = !!this.config() && this.hasPending()
    } catch {
      return
    }
    if (!pending || this.conflict) return
    await Promise.race([
      this.sync('background'),
      new Promise<void>((r) => setTimeout(r, timeoutMs)),
    ])
  }

  /** Sincroniza. Si ya está sincronizando, se repite al terminar. */
  sync(mode: SyncMode = 'manual'): Promise<void> {
    if (this.running) {
      if (mode === 'manual' && this.quiet) {
        // Se ha pedido a mano mientras iba sola: a partir de ahora se ve.
        this.quiet = false
        this.visible = true
        this.lazyHold?.()
        this.emit()
      }
      this.again = this.again === 'manual' || mode === 'manual' ? 'manual' : mode
      return this.running
    }
    this.running = (async () => {
      let next: SyncMode | null = mode
      while (next) {
        const run = next
        this.again = null
        await this.held(run, () => this.doSync())
        next = this.again && this.phase === 'idle' ? this.again : null
      }
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  /**
   * Mantiene el equipo despierto mientras dura `run` (D-124): siempre a mano o al cerrar;
   * en las automáticas, solo si resulta que hay mucho que mover.
   */
  private async held<T>(mode: SyncMode, run: () => Promise<T>): Promise<T> {
    this.mode = mode
    // A mano, todo se vuelve a buscar en Drive (por si se ha tocado algo allí).
    if (mode === 'manual') this.cachedRemote = null
    this.quiet = mode !== 'manual'
    this.visible = !this.quiet
    this.appliedSomething = false
    let release = null as (() => void) | null
    const acquire = () => {
      if (!release && this.config())
        release = this.opts.hold?.(t('Sincronizando la bóveda…')) ?? null
    }
    if (mode !== 'auto') acquire()
    else this.lazyHold = acquire
    try {
      return await run()
    } finally {
      this.progress = null
      this.lazyHold = null
      this.quiet = false
      release?.()
    }
  }

  /** Hay un cambio aquí: se sube a los pocos segundos (D-125). */
  notifyLocalChange(): void {
    if (!this.configured) return
    if (this.changeTimer) clearTimeout(this.changeTimer)
    // En segundo plano (la app se acaba de cerrar): enseguida y con la app viva hasta subir.
    const background = !this.active
    // A la vista, como mucho una subida cada MIN_PUSH_GAP_MS: los cambios seguidos se juntan.
    const wait = Math.max(
      this.opts.changeDelayMs ?? CHANGE_DELAY_MS,
      this.lastPushAt + this.pushGap() - this.now().getTime(),
    )
    this.changeTimer = setTimeout(
      () => {
        this.changeTimer = null
        void this.sync(background ? 'background' : 'auto').catch(() => {})
      },
      background ? 300 : wait,
    )
    this.changeTimer.unref?.()
  }

  /**
   * App a la vista (true) o en segundo plano (false). A la vista mira cada minuto si hay
   * algo nuevo; al pasar a segundo plano sube lo pendiente y para.
   */
  setActive(active: boolean): void {
    this.active = active
    if (!active) {
      if (this.liveTimer) clearInterval(this.liveTimer)
      this.liveTimer = null
      return
    }
    this.startLive()
  }

  private startLive(): void {
    if (this.liveTimer) clearInterval(this.liveTimer)
    this.liveTimer = setInterval(() => {
      if (this.configured && this.active && this.phase !== 'conflict')
        void this.sync('auto').catch(() => {})
    }, LIVE_MS)
    this.liveTimer.unref?.()
  }

  /** Progreso del paso actual; se avisa a la interfaz como mucho cada 400 ms. */
  private report(p: SyncProgress, force = false): void {
    this.progress = p
    if (this.quiet && !this.visible && (p.totalBytes > VISIBLE_BYTES || p.total > 5)) {
      // Una automática que resulta grande (un libro nuevo, la primera vez): se ve y el
      // móvil no se duerme hasta que acabe.
      this.visible = true
      this.lazyHold?.()
      force = true
    }
    if (!this.visible) return
    const now = Date.now()
    if (!force && now - this.lastProgressEmit < PROGRESS_EMIT_MS) return
    this.lastProgressEmit = now
    this.emit()
  }

  private fail(e: unknown): void {
    this.cachedRemote = null
    this.progress = null
    if (this.quiet && !this.visible && isNetworkError(e)) {
      // Sin red en una automática: no es un error que enseñar; se reintenta luego.
      this.phase = 'idle'
      return
    }
    this.phase = 'error'
    this.error = e instanceof Error ? e.message : t('Error de sincronización.')
    this.emit()
  }

  /** `sync.json` de la nube (null si está vacía). */
  private async readRemote(
    remote: Remote,
  ): Promise<{ v1: RemoteManifest; v2?: undefined } | { v2: ManifestV2; v1?: undefined } | null> {
    const text = await remote.readText('sync.json')
    if (!text) return null
    const raw = JSON.parse(text) as { format?: unknown; version?: unknown; vaultId?: unknown }
    if (raw?.format !== 'crm-mellow-sync')
      throw new Error(t('El destino tiene un sync.json que no es de CRM Mellow.'))
    if (raw.vaultId !== this.vault.vaultId)
      throw new Error(t('El destino tiene otra bóveda: elige otra carpeta o desconecta.'))
    if (raw.version === 1) {
      const m = manifestSchema.safeParse(raw)
      if (!m.success) throw new Error(t('El destino tiene un sync.json que no es de CRM Mellow.'))
      return { v1: m.data }
    }
    const m = manifestV2Schema.safeParse(raw)
    if (!m.success)
      throw new Error(
        t('La nube usa un formato más nuevo: actualiza la app en este equipo para sincronizar.'),
      )
    return { v2: m.data }
  }

  private async doSync(): Promise<void> {
    // Tras desbloquear con la contraseña nueva: lo que esperaba vuelve primero.
    this.applyStash()
    const remote = this.remote()
    if (!remote) return
    this.phase = 'syncing'
    this.error = null
    this.progress = { step: 'comprobando', done: 0, total: 0, bytes: 0, totalBytes: 0 }
    if (this.visible) this.emit()
    try {
      const r = await this.readRemote(remote)
      const st = this.v2()
      const local = readManifest(this.vaultPath())
      if (!r) {
        await this.newEpoch(remote)
      } else if (r.v1) {
        if (!(await this.fromV1(remote, r.v1))) return
        await this.newEpoch(remote)
      } else {
        const m = r.v2
        const rotated = !!st && st.epoch === m.epoch && local.keyGeneration > st.keyGeneration
        if (readSetting(this.db(), FORCE_PUSH_KEY) === true) {
          // Lo restaurado es la versión buena: los demás la toman tal cual.
          await this.newEpoch(remote, true)
        } else if (rotated) {
          // Clave maestra nueva: antes se traen los cambios de los demás (los paquetes no
          // dependen de esa clave) y luego empieza una época con la base de datos recifrada.
          await this.pullChanges(remote, m)
          await this.newEpoch(remote)
        } else if (!st || st.epoch !== m.epoch) {
          // Otra época: se trae y se junta con lo de aquí (D-126), sin preguntar.
          if (!(await this.rebase(remote, m))) return
          await this.exchange(remote, m)
        } else {
          await this.exchange(remote, m)
        }
      }
      await this.downloadMissing(remote)
      this.pruneSyncBackups()
      const done = this.v2()
      if (done) this.saveV2({ ...done, lastSyncAt: this.now().toISOString() })
      this.conflict = null
      this.phase = 'idle'
      this.progress = null
      // Una automática que no ha traído nada no molesta a la interfaz.
      if (this.visible || this.appliedSomething) this.emit()
    } catch (e) {
      this.fail(e)
    }
  }

  private pushGap(): number {
    return this.opts.minPushGapMs ?? MIN_PUSH_GAP_MS
  }

  /** Lo de aquí sube, lo de los demás baja y, si toca, instantánea nueva. */
  private async exchange(remote: Remote, m: ManifestV2): Promise<void> {
    // La comprobación de cada minuto solo baja; lo de aquí sube cuando toca (D-131).
    const early = this.mode === 'auto' && this.now().getTime() - this.lastPushAt < this.pushGap()
    if (early) {
      if (this.hasPending()) this.notifyLocalChange()
    } else await this.pushChanges(remote)
    let pulled = await this.pullChanges(remote, m)
    if (pulled.gap) {
      // Sus paquetes ya no están: se pone al día desde la instantánea, con lo suyo.
      if (!(await this.rebase(remote, m))) return
      await this.pushChanges(remote)
      pulled = await this.pullChanges(remote, m)
    }
    await this.maybeCompact(remote, m, pulled.names, pulled.bytes)
  }

  private tmpDir(): string {
    const dir = join(this.vaultPath(), '.sincronizacion')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /** Clave de los paquetes: sale de la de los archivos (igual en todos los equipos). */
  private packKey(): Buffer {
    const files = loadOrCreateFilesKey(this.db())
    try {
      return deriveSubkey(files, 'sync-pack/v1')
    } finally {
      zeroize(files)
    }
  }

  // --- Formato 1 → 2 ---------------------------------------------------------------

  /**
   * La nube aún está en el formato 1. Si es más nueva, se baja y se junta con lo de aquí
   * (D-126): antes había que elegir una de las dos y la otra se perdía. False si hay que parar.
   */
  private async fromV1(remote: Remote, m: RemoteManifest): Promise<boolean> {
    const st = this.state()
    if (m.generation > st.generation) return (await this.pullV1(remote, m)) === 'reopened'
    return true
  }

  private async pullV1(remote: Remote, m: RemoteManifest): Promise<'reopened' | 'locked'> {
    const dir = this.tmpDir()
    try {
      const step = { step: 'bajando' as const, done: 0, total: 1 }
      const got = await remote.get('crm.db', join(dir, VAULT_FILES.db), (bytes, total) =>
        this.report({ ...step, bytes, totalBytes: total ?? bytes }),
      )
      if (!got) throw new Error(t('Falta crm.db en el destino.'))
      if (!(await remote.get('vault.json', join(dir, VAULT_FILES.manifest))))
        throw new Error(t('Falta vault.json en el destino.'))
      this.stash([], this.attach().dump())
      const r = await this.replace(dir)
      if (r === 'locked') return 'locked'
      writeSetting(this.db(), STATE_KEY, {
        generation: m.generation,
        changeMark: this.changes(),
        lastSyncAt: this.now().toISOString(),
      })
      this.applyStash()
      return 'reopened'
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  // --- Épocas e instantáneas -------------------------------------------------------

  /** Sustituye la base de datos conservando lo que es solo de este equipo. */
  private async replace(dir: string): Promise<'reopened' | 'locked'> {
    // Lo de este equipo se queda; «qué instantánea es» viene con la base de datos nueva.
    const local = "(key LIKE 'sync.%' AND key <> 'sync.snapshot') OR key = 'backups.last'"
    const keep = this.db().prepare(`SELECT key, value FROM settings WHERE ${local}`).all() as {
      key: string
      value: string
    }[]
    const r = await this.vault.replaceDatabase(dir, SYNC_BACKUP_REASON)
    if (r === 'locked') {
      this.phase = 'idle'
      this.error = t(
        'Los datos de la nube usan otra contraseña: desbloquea con la contraseña actual.',
      )
      this.emit()
      return 'locked'
    }
    const db = this.db()
    db.transaction(() => {
      db.prepare(`DELETE FROM settings WHERE ${local}`).run()
      const put = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      const at = new Date().toISOString()
      for (const k of keep) put.run(k.key, k.value, at)
    })()
    // La cola que traía la base de datos de otro equipo no es de este.
    this.attach().clear()
    return 'reopened'
  }

  /** Sube la base de datos entera como instantánea `snapshots/<id>/`. */
  private async uploadSnapshot(
    remote: Remote,
    id: string,
    epoch: string,
    covers: Record<string, number>,
  ): Promise<number> {
    const vaultPath = this.vaultPath()
    const dir = this.tmpDir()
    try {
      writeSetting(this.db(), SNAPSHOT_KEY, { epoch, id, covers })
      // Una copia compacta (D-133): sin el hueco que deja lo borrado y cifrada con la misma
      // clave. Una copia del archivo tal cual subía también todo ese espacio vacío.
      this.db().prepare('VACUUM INTO ?').run(join(dir, VAULT_FILES.db))
      copyFileSync(join(vaultPath, VAULT_FILES.manifest), join(dir, VAULT_FILES.manifest))
      const total = statSync(join(dir, VAULT_FILES.db)).size
      const step = { step: 'subiendo' as const, what: 'base' as const, total: 1 }
      this.report({ ...step, done: 0, bytes: 0, totalBytes: total }, true)
      await remote.put(`snapshots/${id}/crm.db`, join(dir, VAULT_FILES.db), (sent) =>
        this.report({ ...step, done: 0, bytes: sent, totalBytes: total }),
      )
      await remote.put(`snapshots/${id}/vault.json`, join(dir, VAULT_FILES.manifest))
      this.report({ ...step, done: 1, bytes: total, totalBytes: total }, true)
      return total
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  private manifestFor(
    epoch: string,
    snapshot: ManifestV2['snapshot'],
    previous: ManifestV2['previous'],
    authoritative = false,
  ): ManifestV2 {
    const local = readManifest(this.vaultPath())
    return {
      format: 'crm-mellow-sync',
      version: 2,
      vaultId: this.vault.vaultId!,
      epoch,
      schema: SCHEMA_VERSION,
      keyGeneration: local.keyGeneration,
      snapshot,
      previous,
      updatedAt: this.now().toISOString(),
      deviceName: this.opts.hostname,
      authoritative,
    }
  }

  /**
   * Época nueva desde la base de datos de este equipo: instantánea, `sync.json` y fuera lo
   * de las épocas anteriores (y los archivos del formato 1).
   */
  private async newEpoch(remote: Remote, authoritative = false): Promise<void> {
    const device = this.deviceId()
    const epoch = randomId()
    const sid = randomId()
    await this.uploadBlobs(remote)
    const size = await this.uploadSnapshot(remote, sid, epoch, {})
    const at = this.now().toISOString()
    const m = this.manifestFor(
      epoch,
      { id: sid, device, createdAt: at, covers: {}, size },
      null,
      authoritative,
    )
    await remote.writeText('sync.json', JSON.stringify(m, null, 2))
    this.attach().clear()
    const local = readManifest(this.vaultPath())
    this.saveV2({
      device,
      epoch,
      seq: 0,
      applied: {},
      snapshot: sid,
      keyGeneration: local.keyGeneration,
      manifestHash: manifestHash(local),
      lastSyncAt: at,
    })
    deleteSetting(this.db(), FORCE_PUSH_KEY)
    for (const n of await remote.list('changes'))
      if (n !== epoch) await remote.remove(`changes/${n}`)
    for (const n of await remote.list('snapshots'))
      if (n !== sid) await remote.remove(`snapshots/${n}`)
    await remote.remove('crm.db')
    await remote.remove('vault.json')
  }

  /**
   * Pone este equipo al día desde la instantánea de la nube. Lo que tenía sin subir se
   * vuelve a aplicar encima y se sube después (con su hora, así que gana solo si es más
   * reciente); si era otra época, además se junta todo lo suyo. False si hay que parar
   * (otra contraseña).
   */
  private async rebase(remote: Remote, m: ManifestV2): Promise<boolean> {
    if (m.schema > SCHEMA_VERSION)
      throw new Error(
        t('Otro equipo usa una versión más nueva de la app: actualiza esta para sincronizar.'),
      )
    const log = this.attach()
    const carried: PackRow[] = log.collect(Number.MAX_SAFE_INTEGER).rows
    const device = this.deviceId()
    // Antes de cambiar la base de datos se guarda, cifrado, lo de este equipo (D-126): lo
    // que tenía sin subir, sus ajustes propios y, si viene de otra época (otra historia),
    // todo lo suyo para juntarlo después. En la misma época basta con lo que tenía sin
    // subir: lo demás ya estaba en la nube, y así no vuelve lo que otro borró. Si la
    // instantánea pide otra contraseña, espera aquí a que se desbloquee.
    const diverged = this.v2()?.epoch !== m.epoch
    this.stash(carried, diverged && !m.authoritative ? log.dump() : [])
    const dir = this.tmpDir()
    try {
      const step = { step: 'bajando' as const, done: 0, total: 1 }
      const got = await remote.get(
        `snapshots/${m.snapshot.id}/crm.db`,
        join(dir, VAULT_FILES.db),
        (bytes, total) => this.report({ ...step, bytes, totalBytes: total ?? bytes }),
      )
      if (!got) throw new Error(t('Falta crm.db en el destino.'))
      if (
        !(await remote.get(
          `snapshots/${m.snapshot.id}/vault.json`,
          join(dir, VAULT_FILES.manifest),
        ))
      )
        throw new Error(t('Falta vault.json en el destino.'))
      if ((await this.replace(dir)) === 'locked') return false
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const local = readManifest(this.vaultPath())
    this.saveV2({
      device,
      epoch: m.epoch,
      seq: m.snapshot.covers[device] ?? 0,
      applied: { ...m.snapshot.covers },
      snapshot: m.snapshot.id,
      keyGeneration: local.keyGeneration,
      manifestHash: manifestHash(local),
      lastSyncAt: null,
    })
    this.appliedSomething = true
    deleteSetting(this.db(), FORCE_PUSH_KEY)
    writeSetting(this.db(), STATE_KEY, {
      generation: 0,
      changeMark: this.changes(),
      lastSyncAt: null,
    })
    // Primero lo que los demás subieron después de la instantánea y luego lo de aquí: así se
    // compara con lo más reciente de verdad.
    await this.pullChanges(remote, m)
    this.applyStash()
    return true
  }

  private stash(rows: PackRow[], merge: PackRow[] = []): void {
    const local = this.db()
      .prepare(
        "SELECT key, value FROM settings WHERE (key LIKE 'sync.%' AND key NOT IN ('sync.v2', 'sync.snapshot')) OR key = 'backups.last'",
      )
      .all() as { key: string; value: string }[]
    const key = this.packKey()
    try {
      const pack: Pack = {
        format: 'crm-mellow-pack',
        version: 1,
        epoch: 'pendiente',
        device: this.deviceId(),
        seq: 1,
        createdAt: this.now().toISOString(),
        schema: SCHEMA_VERSION,
        rows,
        local,
        ...(merge.length ? { merge } : {}),
      }
      writeFileSync(join(this.vaultPath(), STASH_FILE), sealPack(pack, key, STASH_FILE))
    } finally {
      zeroize(key)
    }
  }

  /** Lo que quedó sin subir al cambiar de instantánea vuelve a la cola (con su hora). */
  private applyStash(): void {
    const file = join(this.vaultPath(), STASH_FILE)
    if (!existsSync(file)) return
    const key = this.packKey()
    try {
      const pack = openPack(readFileSync(file), key, STASH_FILE)
      const db = this.db()
      const put = db.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      for (const l of pack.local ?? []) put.run(l.key, l.value, new Date().toISOString())
      const log = this.attach()
      if (pack.rows.length) log.apply(pack.rows, true)
      if (pack.merge?.length) {
        const res = log.merge(pack.merge)
        if (res.tables.size) {
          this.appliedSomething = true
          this.vault.data.afterRemoteChanges(res)
          this.opts.onApplied?.(res)
        }
      }
    } finally {
      zeroize(key)
    }
    rmSync(file, { force: true })
  }

  /**
   * Instantánea nueva solo si compensa (D-133): los paquetes ya pesan la mitad que la última
   * (y al menos COMPACT_MIN_BYTES) o son muchísimos. Solo el ordenador y nunca con datos
   * móviles: es subir la base de datos entera.
   */
  private async maybeCompact(
    remote: Remote,
    m: ManifestV2,
    names: string[],
    bytes: number,
  ): Promise<void> {
    if (this.opts.compact === false) return
    const st = this.v2()
    if (!st || st.epoch !== m.epoch) return
    const many = names.length >= (this.opts.compactPacks ?? COMPACT_PACKS)
    const minBytes = this.opts.compactMinBytes ?? COMPACT_MIN_BYTES
    if (!many && bytes < minBytes) return
    if (!many) {
      // Lo que pesa la instantánea de ahora (las anteriores a D-133 no lo apuntan).
      const snap =
        m.snapshot.size ??
        (await remote.sizes(`snapshots/${m.snapshot.id}`)).get(VAULT_FILES.db) ??
        0
      if (bytes < snap / 2) return
    }
    if (await this.onMetered()) return
    // Solo quien tiene todo aplicado: la instantánea tiene que incluir lo que dice.
    for (const n of names) {
      const p = PACK_NAME.exec(n)
      if (p && Number(p[2]) > (st.applied[p[1]!] ?? 0)) return
    }
    const sid = randomId()
    const covers = { ...st.applied, [st.device]: st.seq }
    const size = await this.uploadSnapshot(remote, sid, m.epoch, covers)
    const latest = await this.readRemote(remote)
    if (!latest?.v2 || latest.v2.epoch !== m.epoch || latest.v2.snapshot.id !== m.snapshot.id) {
      // Otro equipo se ha adelantado: vale la suya.
      await remote.remove(`snapshots/${sid}`)
      return
    }
    const next = this.manifestFor(
      m.epoch,
      { id: sid, device: st.device, createdAt: this.now().toISOString(), covers, size },
      m.snapshot,
    )
    await remote.writeText('sync.json', JSON.stringify(next, null, 2))
    this.saveV2({ ...this.v2()!, snapshot: sid })
    // Fuera los paquetes que ya cubría la instantánea anterior y las que no se usan.
    if (m.previous)
      for (const n of names) {
        const p = PACK_NAME.exec(n)
        if (p && Number(p[2]) <= (m.previous.covers[p[1]!] ?? 0))
          await remote.remove(`changes/${m.epoch}/${n}`)
      }
    for (const n of await remote.list('snapshots'))
      if (n !== sid && n !== m.snapshot.id) await remote.remove(`snapshots/${n}`)
  }

  // --- Paquetes ----------------------------------------------------------------------

  /** Sube lo que ha cambiado aquí (primero los archivos que nombra). */
  private async pushChanges(remote: Remote): Promise<void> {
    const st = this.v2()
    if (!st) return
    const log = this.attach()
    const filesChanged = this.db()
      .prepare("SELECT 1 FROM sync_outbox WHERE tbl = 'files' LIMIT 1")
      .get()
    if (!this.blobsChecked || filesChanged) await this.uploadBlobs(remote)
    const key = this.packKey()
    try {
      const local = readManifest(this.vaultPath())
      const hash = manifestHash(local)
      let manifest =
        hash !== st.manifestHash && local.keyGeneration === st.keyGeneration
          ? readFileSync(join(this.vaultPath(), VAULT_FILES.manifest), 'utf8')
          : undefined
      let sent = 0
      // En las automáticas, solo lo que había al empezar: lo que llega mientras sube (otra
      // página leída) espera al siguiente hueco en lugar de ir en otro paquete (D-131).
      const upTo = this.mode === 'auto' ? log.lastQueued() : undefined
      for (;;) {
        const { rows, maxId } = log.collect(PACK_ROWS, upTo)
        if (!rows.length && !manifest) {
          if (maxId) log.ack(maxId)
          if (maxId) continue
          break
        }
        await this.writePacks(remote, st, key, rows, manifest)
        this.lastPushAt = this.now().getTime()
        sent += rows.length
        this.report({
          step: 'subiendo',
          done: sent,
          total: sent + log.pending(),
          bytes: 0,
          totalBytes: 0,
        })
        if (maxId) log.ack(maxId)
        if (manifest) {
          manifest = undefined
          st.manifestHash = hash
        }
        this.saveV2(st)
      }
    } finally {
      zeroize(key)
    }
  }

  /** Escribe uno o varios paquetes (si no caben en uno, se parten). */
  private async writePacks(
    remote: Remote,
    st: V2State,
    key: Buffer,
    rows: PackRow[],
    manifest: string | undefined,
  ): Promise<void> {
    const seq = st.seq + 1
    const path = `changes/${st.epoch}/${st.device}-${pad(seq)}.bin`
    const pack: Pack = {
      format: 'crm-mellow-pack',
      version: 1,
      epoch: st.epoch,
      device: st.device,
      seq,
      createdAt: this.now().toISOString(),
      schema: SCHEMA_VERSION,
      rows,
      ...(manifest ? { manifest } : {}),
    }
    const data = sealPack(pack, key, path)
    if (data.length > PACK_MAX_BYTES && rows.length > 1) {
      const half = Math.ceil(rows.length / 2)
      await this.writePacks(remote, st, key, rows.slice(0, half), manifest)
      await this.writePacks(remote, st, key, rows.slice(half), undefined)
      return
    }
    await remote.writeBytes(path, data, { fresh: true })
    st.seq = seq
    st.applied[st.device] = seq
    this.saveV2(st)
  }

  /**
   * Baja y aplica los paquetes nuevos de cada equipo, en orden. `gap`: faltan paquetes que
   * ya se han borrado (este equipo llevaba tiempo sin sincronizar).
   */
  private async pullChanges(
    remote: Remote,
    m: ManifestV2,
  ): Promise<{ gap: boolean; names: string[]; bytes: number }> {
    const st = this.v2()
    if (!st) return { gap: false, names: [], bytes: 0 }
    const log = this.attach()
    // Con su tamaño, en la misma petición: para saber si compensa una instantánea (D-133).
    const listing = await remote.sizes(`changes/${m.epoch}`)
    const names = [...listing.keys()]
    const bytes = [...listing.values()].reduce((a, b) => a + b, 0)
    const byDevice = new Map<string, number[]>()
    for (const n of names) {
      const p = PACK_NAME.exec(n)
      if (!p) continue
      const list = byDevice.get(p[1]!) ?? []
      list.push(Number(p[2]))
      byDevice.set(p[1]!, list)
    }
    const todo: { device: string; seq: number }[] = []
    let ownMax = 0
    for (const [device, seqs] of byDevice) {
      const sorted = [...new Set(seqs)].sort((a, b) => a - b)
      if (device === st.device) ownMax = sorted.at(-1) ?? 0
      let have = st.applied[device] ?? 0
      const next = sorted.filter((s) => s > have)
      if (!next.length) continue
      if (next[0] !== have + 1) {
        if ((m.snapshot.covers[device] ?? 0) > have) return { gap: true, names, bytes }
        // El siguiente aún no se ve (se está subiendo): la próxima vez.
        continue
      }
      for (const s of next) {
        if (s !== have + 1) break
        todo.push({ device, seq: s })
        have = s
      }
    }
    const key = this.packKey()
    const merged: AppliedChanges = {
      tables: new Set(),
      settings: new Set(),
      records: new Set(),
      skipped: 0,
    }
    let newer = false
    // Se bajan varios a la vez y se aplican en orden (D-131): con datos móviles, cada
    // paquete es una espera de Drive, y uno detrás de otro tardaba mucho.
    const pathOf = (i: number) => `changes/${m.epoch}/${todo[i]!.device}-${pad(todo[i]!.seq)}.bin`
    const loads = new Map<number, Promise<Buffer | null>>()
    const load = (i: number) => {
      if (i >= todo.length) return
      if (!loads.has(i)) {
        const p = remote.readBytes(pathOf(i))
        p.catch(() => {})
        loads.set(i, p)
      }
    }
    try {
      const stopped = new Set<string>()
      for (const [i, p] of todo.entries()) {
        for (let j = i; j < i + PULL_PARALLEL; j++) load(j)
        if (stopped.has(p.device)) continue
        this.report({ step: 'bajando', done: i, total: todo.length, bytes: 0, totalBytes: 0 })
        const path = pathOf(i)
        const data = await loads.get(i)!
        loads.delete(i)
        if (!data) {
          stopped.add(p.device)
          continue
        }
        const pack = openPack(data, key, path)
        if (pack.schema > SCHEMA_VERSION) {
          // Lo ha hecho una versión más nueva de la app: se espera a actualizar.
          newer = true
          stopped.add(p.device)
          continue
        }
        const res = log.apply(pack.rows)
        for (const tb of res.tables) merged.tables.add(tb)
        for (const k of res.settings) merged.settings.add(k)
        for (const r of res.records) merged.records.add(r)
        merged.skipped += res.skipped
        if (pack.manifest) this.adoptManifest(pack.manifest)
        const cur = this.v2()!
        cur.applied[p.device] = p.seq
        this.saveV2(cur)
      }
    } finally {
      zeroize(key)
    }
    const cur = this.v2()!
    if (cur.seq < ownMax) {
      // Nunca se reutiliza un número de paquete propio.
      cur.seq = ownMax
      this.saveV2(cur)
    }
    if (merged.tables.size) {
      this.appliedSomething = true
      // La búsqueda y lo guardado en memoria, al día ya (no depende de la interfaz).
      this.vault.data.afterRemoteChanges(merged)
      this.opts.onApplied?.(merged)
    }
    if (newer)
      throw new Error(
        t('Otro equipo usa una versión más nueva de la app: actualiza esta para sincronizar.'),
      )
    return { gap: false, names, bytes }
  }

  /** vault.json de otro equipo (contraseña o clave de recuperación nuevas). */
  private adoptManifest(text: string): void {
    const r = vaultManifestSchema.safeParse(JSON.parse(text))
    if (!r.success) return
    const vaultPath = this.vaultPath()
    const local = readManifest(vaultPath)
    if (r.data.vaultId !== local.vaultId || r.data.keyGeneration !== local.keyGeneration) return
    const next = { ...r.data, schemaVersion: local.schemaVersion }
    writeManifest(vaultPath, next)
    const st = this.v2()
    if (st) this.saveV2({ ...st, manifestHash: manifestHash(next) })
  }

  // --- Archivos ------------------------------------------------------------------------

  /** Archivos cifrados que la nube aún no tiene (su nombre es su HMAC). */
  private async uploadBlobs(remote: Remote): Promise<void> {
    const vaultPath = this.vaultPath()
    const missing: { path: string; src: string; size: number }[] = []
    for (const kind of ['files', 'thumbs'] as const) {
      const there = new Set(await remote.list(kind))
      for (const id of this.localBlobs(kind))
        if (!there.has(`${id}.bin`)) {
          const src = join(vaultPath, kind, id.slice(0, 2), `${id}.bin`)
          missing.push({ path: `${kind}/${id}.bin`, src, size: statSync(src).size })
        }
    }
    const totalBytes = missing.reduce((a, f) => a + f.size, 0)
    const total = missing.length
    let doneBytes = 0
    let done = 0
    for (const f of missing) {
      await remote.put(f.path, f.src, (sent) =>
        this.report({
          step: 'subiendo',
          what: 'archivos',
          done,
          total,
          bytes: doneBytes + sent,
          totalBytes,
        }),
      )
      doneBytes += f.size
      done++
      this.report(
        { step: 'subiendo', what: 'archivos', done, total, bytes: doneBytes, totalBytes },
        true,
      )
    }
    this.blobsChecked = true
  }

  private localBlobs(kind: 'files' | 'thumbs'): string[] {
    const root = join(this.vaultPath(), kind)
    if (!existsSync(root)) return []
    return readdirSync(root)
      .filter((d) => /^[a-f0-9]{2}$/.test(d))
      .flatMap((d) => readdirSync(join(root, d)))
      .filter((n) => /^[a-f0-9]{64}\.bin$/.test(n))
      .map((n) => n.slice(0, 64))
  }

  /**
   * Archivos que usa la base de datos y aún no están en este equipo. Si alguno falla, se
   * siguen bajando los demás y al final se avisa (D-124).
   */
  private async downloadMissing(remote: Remote): Promise<void> {
    const vaultPath = this.vaultPath()
    const rows = this.db().prepare('SELECT id, size, has_thumb FROM files').all() as {
      id: string
      size: number
      has_thumb: number
    }[]
    const limit = this.opts.maxAutoDownloadBytes ?? Infinity
    const always =
      limit === Infinity ? new Set<string>() : (this.opts.alwaysDownload?.() ?? new Set())
    // Con datos móviles, solo las miniaturas: los archivos esperan al wifi o a abrirlos.
    const light = await this.light()
    const now = this.now().getTime()
    const todo: { path: string; dest: string; size: number }[] = []
    for (const r of rows) {
      for (const kind of ['files', 'thumbs'] as const) {
        if (kind === 'thumbs' && !r.has_thumb) continue
        if (kind === 'files' && light) continue
        if (kind === 'files' && r.size > limit && !always.has(r.id)) continue
        const dest = join(vaultPath, kind, r.id.slice(0, 2), `${r.id}.bin`)
        const path = `${kind}/${r.id}.bin`
        // Lo que aún no está en la nube no se busca cada minuto (D-131); a mano, sí.
        const missed = this.absent.get(path)
        if (missed && this.mode !== 'manual' && now - missed < ABSENT_RETRY_MS) continue
        if (!existsSync(dest)) todo.push({ path, dest, size: kind === 'files' ? r.size : 0 })
      }
    }
    if (!todo.length) return
    // Primero lo pequeño: las miniaturas y los archivos ligeros salen antes en pantalla.
    todo.sort((a, b) => a.size - b.size)
    const total = todo.length
    const totalBytes = todo.reduce((a, f) => a + f.size, 0)
    let done = 0
    let doneBytes = 0
    let firstError: unknown = null
    let failed = 0
    this.report({ step: 'bajando', done, total, bytes: 0, totalBytes }, true)
    for (const f of todo) {
      try {
        const got = await remote.get(f.path, f.dest, (received) =>
          this.report({
            step: 'bajando',
            done,
            total,
            bytes: doneBytes + Math.min(received, f.size || received),
            totalBytes,
          }),
        )
        if (got) this.absent.delete(f.path)
        else this.absent.set(f.path, now)
      } catch (e) {
        firstError ??= e
        failed++
      }
      done++
      doneBytes += f.size
      this.report({ step: 'bajando', done, total, bytes: doneBytes, totalBytes }, true)
    }
    if (failed)
      throw new Error(
        tn(
          failed,
          'No se pudo bajar {n} archivo de la nube: {error}',
          'No se pudieron bajar {n} archivos de la nube: {error}',
          { error: firstError instanceof Error ? firstError.message : String(firstError) },
        ),
      )
  }

  /** Las copias «antes de sincronizar»: solo las últimas (D-125). */
  private pruneSyncBackups(): void {
    const dir = join(this.vaultPath(), VAULT_FILES.backups)
    if (!existsSync(dir)) return
    const names = readdirSync(dir)
      .filter((n) => parseBackupName(n)?.reason === SYNC_BACKUP_REASON)
      .sort()
      .reverse()
    for (const n of names.slice(KEEP_SYNC_BACKUPS))
      rmSync(join(dir, n), { recursive: true, force: true })
  }

  /** Resuelve un conflicto; la versión descartada queda como copia de seguridad. */
  async resolve(keep: 'local' | 'remote'): Promise<void> {
    const remote = this.remote()
    if (!remote || !this.conflict) return
    return this.held('manual', () => this.doResolve(remote, keep))
  }

  private async doResolve(remote: Remote, keep: 'local' | 'remote'): Promise<void> {
    try {
      this.phase = 'syncing'
      this.emit()
      const r = await this.readRemote(remote)
      if (!r) throw new Error(t('El destino ya no tiene datos.'))
      if (keep === 'local') {
        // La versión de la nube se guarda aquí como copia antes de sustituirla.
        const stamp = this.now()
          .toISOString()
          .replace(/\.\d+Z$/, '')
          .replace(/[-:]/g, '')
          .replace('T', '-')
        const dir = join(this.vaultPath(), VAULT_FILES.backups, `${stamp}-conflicto-nube`)
        mkdirSync(dir, { recursive: true })
        const base = r.v2 ? `snapshots/${r.v2.snapshot.id}/` : ''
        await remote.get(`${base}crm.db`, join(dir, VAULT_FILES.db))
        await remote.get(`${base}vault.json`, join(dir, VAULT_FILES.manifest))
        await this.newEpoch(remote)
      } else if (r.v1) {
        if ((await this.pullV1(remote, r.v1)) === 'locked') return
        await this.newEpoch(remote)
      } else {
        if (!(await this.rebase(remote, r.v2))) return
        await this.exchange(remote, r.v2)
      }
      await this.downloadMissing(remote)
      this.conflict = null
      this.phase = 'idle'
      this.progress = null
      this.emit()
    } catch (e) {
      this.fail(e)
    }
  }

  // --- Copias de seguridad -------------------------------------------------------

  async maybeBackup(): Promise<string | null> {
    const cfg = this.backupConfig()
    const last = readSetting(this.db(), BACKUP_LAST_KEY)
    const due =
      typeof last !== 'string' ||
      this.now().getTime() - Date.parse(last) >= cfg.intervalDays * 86_400_000
    return due ? this.createBackup(AUTO_REASON) : null
  }

  /** Copia ahora (local y, si hay destino, también allí) y aplica la retención. */
  async createBackup(reason = 'manual'): Promise<string> {
    const vaultPath = this.vaultPath()
    const dir = backupVault(vaultPath, this.db(), reason, this.now())
    const name = dir.split(/[\\/]/).pop()!
    if (reason === AUTO_REASON) writeSetting(this.db(), BACKUP_LAST_KEY, this.now().toISOString())
    const remote = this.remote()
    const cfg = this.backupConfig()
    const localDir = join(vaultPath, VAULT_FILES.backups)
    for (const n of backupsToPrune(readdirSync(localDir), cfg))
      rmSync(join(localDir, n), { recursive: true, force: true })
    // A la nube solo si se ha pedido y nunca con datos móviles: es la base de datos entera
    // (D-133). La nube ya guarda la bóveda; la copia de cada equipo se queda en él.
    if (remote && cfg.cloud && !(await this.onMetered())) {
      try {
        await remote.put(`backups/${name}/crm.db`, join(dir, VAULT_FILES.db))
        await remote.put(`backups/${name}/vault.json`, join(dir, VAULT_FILES.manifest))
        for (const n of backupsToPrune(await remote.list('backups'), cfg))
          await remote.remove(`backups/${n}`)
      } catch (e) {
        this.fail(e)
      }
    }
    this.emit()
    return name
  }

  async listBackups(): Promise<BackupEntry[]> {
    const localDir = join(this.vaultPath(), VAULT_FILES.backups)
    const local = existsSync(localDir) ? readdirSync(localDir) : []
    let remoteNames: string[] = []
    const remote = this.remote()
    if (remote) {
      try {
        remoteNames = await remote.list('backups')
      } catch {
        remoteNames = []
      }
    }
    const names = [...new Set([...local, ...remoteNames])]
    return names
      .map((name) => {
        const p = parseBackupName(name)
        if (!p) return null
        const db = join(localDir, name, VAULT_FILES.db)
        return {
          name,
          date: p.date,
          reason: p.reason,
          size: existsSync(db) ? statSync(db).size : null,
          local: local.includes(name),
          remote: remoteNames.includes(name),
        }
      })
      .filter((x): x is BackupEntry => x !== null)
      .sort((a, b) => b.name.localeCompare(a.name))
  }

  /** Restaura una copia (si solo está en la nube, la descarga antes). */
  async restoreBackup(name: string): Promise<'reopened' | 'locked'> {
    if (!parseBackupName(name)) throw new AppError('INVALID_INPUT')
    const dir = join(this.vaultPath(), VAULT_FILES.backups, name)
    if (!existsSync(join(dir, VAULT_FILES.db))) {
      const remote = this.remote()
      if (!remote) throw new AppError('INVALID_INPUT', undefined, t('La copia no existe.'))
      mkdirSync(dir, { recursive: true })
      const ok =
        (await remote.get(`backups/${name}/crm.db`, join(dir, VAULT_FILES.db))) &&
        (await remote.get(`backups/${name}/vault.json`, join(dir, VAULT_FILES.manifest)))
      if (!ok) throw new AppError('INVALID_INPUT', undefined, t('La copia no existe.'))
    }
    const keep = this.db()
      .prepare("SELECT key, value FROM settings WHERE key LIKE 'sync.%'")
      .all() as { key: string; value: string }[]
    const r = await this.vault.replaceDatabase(dir, 'antes-de-restaurar')
    if (r === 'reopened') {
      // Lo restaurado empieza una época nueva en la próxima sincronización: es la buena.
      const db = this.db()
      db.prepare("DELETE FROM settings WHERE key LIKE 'sync.%'").run()
      const put = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)')
      for (const k of keep) put.run(k.key, k.value, new Date().toISOString())
      this.attach().clear()
      writeSetting(db, CHANGES_KEY, this.changes() + 1)
      writeSetting(db, FORCE_PUSH_KEY, true)
    }
    this.emit()
    return r
  }

  dispose(): void {
    this.stopTimer()
  }
}
