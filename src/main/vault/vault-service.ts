import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { AppError } from '@shared/errors'
import type { VaultStatus } from '@shared/ipc'
import {
  appearanceSchema,
  DEFAULT_APPEARANCE,
  type Appearance,
  type AppearancePatch,
} from '@shared/appearance'
import { BUILT_IN_THEMES, customThemesSchema, type Theme } from '@shared/themes'
import { DataService, type DataServiceOptions } from '../data/data-service'
import { FileStore, loadOrCreateFilesKey } from '../files/file-store'
import { backupVault } from '../db/backup'
import {
  closeDb,
  openEncryptedDb,
  rekeyDb,
  toDrizzle,
  type Db,
  type SqliteDb,
} from '../db/connection'
import { runMigrations, type Migration } from '../db/migrate'
import { MIGRATIONS } from '../db/migrations'
import { settings } from '../db/schema'
import { writeFileAtomic } from '../fs-utils'
import {
  DEFAULT_KDF,
  deriveSubkey,
  generateMasterKey,
  generateRecoveryKey,
  normalizeRecoveryKey,
  unwrapMasterKey,
  wrapMasterKey,
  zeroize,
  type KdfParams,
} from './crypto'
import { acquireLock, HEARTBEAT_MS, refreshLock, releaseLock, type LockInfo } from './lock'
import {
  isVaultFolder,
  manifestPath,
  readManifest,
  slotAad,
  VAULT_FILES,
  VAULT_FORMAT,
  VAULT_FORMAT_VERSION,
  vaultManifestSchema,
  writeManifest,
  type VaultManifest,
} from './vault-file'
import { t } from '@shared/i18n'

export const DEFAULT_AUTO_LOCK_MINUTES = 15
const AUTO_LOCK_KEY = 'security.autoLockMinutes'
const APPEARANCE_KEY = 'appearance'
const THEMES_KEY = 'appearance.themes'
const DB_KEY_PURPOSE = 'db/v1'
/** Manifiesto nuevo mientras se rota la clave (ver rotateKey). */
const PENDING_MANIFEST = 'vault.json.pending'

export interface VaultServiceOptions {
  kdf?: KdfParams
  migrations?: readonly Migration[]
  instanceId?: string
  hostname?: string
  onChange?: (status: VaultStatus) => void
  /** Opciones del motor de datos que se crea al desbloquear (false: sin motor, para simular la v0.1 en tests). */
  data?: DataServiceOptions | false
}

interface Unlocked {
  sqlite: SqliteDb
  db: Db
  data: DataService | null
  masterKey: Buffer
  lock: LockInfo
  heartbeat: NodeJS.Timeout
}

/**
 * Estado de la bóveda en el proceso principal. Es el único sitio que conoce la
 * clave maestra, y solo la mantiene en memoria mientras la bóveda está desbloqueada.
 * No depende de Electron para poder probarlo con Vitest.
 */
export class VaultService {
  private readonly kdf: KdfParams
  private readonly migrations: readonly Migration[]
  private readonly instanceId: string
  private readonly hostname: string | undefined
  private readonly onChange: ((s: VaultStatus) => void) | undefined
  private readonly dataOptions: DataServiceOptions | false
  private path: string | null = null
  private unlocked: Unlocked | null = null
  /** Evita dos operaciones de desbloqueo o rotación a la vez. */
  private busy = false

  constructor(opts: VaultServiceOptions = {}) {
    this.kdf = opts.kdf ?? DEFAULT_KDF
    this.migrations = opts.migrations ?? MIGRATIONS
    this.instanceId = opts.instanceId ?? randomUUID()
    this.hostname = opts.hostname
    this.onChange = opts.onChange
    this.dataOptions = opts.data ?? {}
  }

  get schemaVersion(): number {
    return this.migrations.length
  }

  get currentPath(): string | null {
    return this.path
  }

  status(): VaultStatus {
    return {
      state: this.unlocked ? 'unlocked' : this.path ? 'locked' : 'none',
      path: this.path,
      name: this.path ? basename(this.path) : null,
      autoLockMinutes: this.unlocked ? this.getAutoLockMinutes() : null,
      appearance: this.unlocked ? this.getAppearance() : null,
      themes: this.unlocked ? this.getThemes() : null,
    }
  }

  /** Acceso a la base de datos para el resto de módulos (lanza si está bloqueada). */
  get db(): Db {
    if (!this.unlocked) throw new AppError('VAULT_IS_LOCKED')
    return this.unlocked.db
  }

  /** Conexión SQLite (solo para el proceso principal: copias y sincronización). */
  get sqlite(): SqliteDb {
    if (!this.unlocked) throw new AppError('VAULT_IS_LOCKED')
    return this.unlocked.sqlite
  }

  /** Id de la bóveda seleccionada (de vault.json). */
  get vaultId(): string | null {
    return this.path ? readManifest(this.path).vaultId : null
  }

  /**
   * Sustituye crm.db y vault.json por los de `srcDir` (descarga de la sincronización
   * o una copia de seguridad), con una copia de los actuales antes. Si la clave actual
   * abre la base de datos nueva, la bóveda se reabre; si no (otra contraseña o clave
   * rotada en otro equipo), queda bloqueada para entrar con la contraseña de entonces.
   */
  async replaceDatabase(srcDir: string, reason: string): Promise<'reopened' | 'locked'> {
    return this.exclusive(async () => {
      const u = this.requireUnlocked()
      const vaultPath = this.requirePath()
      const incoming = readManifest(srcDir)
      if (incoming.vaultId !== readManifest(vaultPath).vaultId)
        throw new AppError('UNKNOWN', undefined, t('Esos datos son de otra bóveda.'))
      this.checkSchema(incoming)
      let canOpen: boolean
      const dbKey = deriveSubkey(u.masterKey, DB_KEY_PURPOSE)
      try {
        closeDb(openEncryptedDb(join(srcDir, VAULT_FILES.db), dbKey))
        canOpen = true
      } catch {
        canOpen = false
      } finally {
        zeroize(dbKey)
      }
      backupVault(vaultPath, u.sqlite, reason)
      const key = canOpen ? Buffer.from(u.masterKey) : null
      this.lockInternal()
      for (const f of [VAULT_FILES.db, VAULT_FILES.manifest]) {
        const tmp = join(vaultPath, `.${f}.entrante`)
        copyFileSync(join(srcDir, f), tmp)
        renameSync(tmp, join(vaultPath, f))
      }
      for (const extra of ['-wal', '-shm'])
        rmSync(join(vaultPath, `${VAULT_FILES.db}${extra}`), { force: true })
      if (key) {
        await this.finishUnlock(key, true)
        this.emit()
        return 'reopened'
      }
      this.emit()
      return 'locked'
    })
  }

  /** Motor de datos de la bóveda desbloqueada (lanza si está bloqueada). */
  get data(): DataService {
    if (!this.unlocked?.data) throw new AppError('VAULT_IS_LOCKED')
    return this.unlocked.data
  }

  // --- Crear y abrir --------------------------------------------------------------

  async create(
    parentPath: string,
    name: string,
    password: string,
  ): Promise<{ recoveryKey: string; status: VaultStatus }> {
    const target = resolve(parentPath, name)
    if (existsSync(target)) {
      if (isVaultFolder(target)) throw new AppError('VAULT_EXISTS')
      if (readdirSync(target).length > 0) throw new AppError('FOLDER_NOT_EMPTY')
    }

    return this.exclusive(async () => {
      this.closeInternal()
      const masterKey = generateMasterKey()
      const recoveryKey = generateRecoveryKey()
      const base = { vaultId: randomUUID(), keyGeneration: 1 }
      try {
        const [passwordSlot, recoverySlot] = await Promise.all([
          wrapMasterKey(masterKey, password, this.kdf, slotAad(base, 'password')),
          wrapMasterKey(
            masterKey,
            normalizeRecoveryKey(recoveryKey)!,
            this.kdf,
            slotAad(base, 'recovery'),
          ),
        ])
        const manifest: VaultManifest = {
          format: VAULT_FORMAT,
          formatVersion: VAULT_FORMAT_VERSION,
          ...base,
          createdAt: new Date().toISOString(),
          schemaVersion: 0,
          kdf: this.kdf,
          keySlots: { password: passwordSlot, recovery: recoverySlot },
        }
        mkdirSync(target, { recursive: true })
        for (const dir of [VAULT_FILES.files, VAULT_FILES.thumbs, VAULT_FILES.backups]) {
          mkdirSync(join(target, dir), { recursive: true })
        }
        writeManifest(target, manifest)
        this.path = target
        await this.finishUnlock(masterKey, false)
      } catch (e) {
        zeroize(masterKey)
        throw e
      }
      return { recoveryKey, status: this.emit() }
    })
  }

  /** Selecciona una bóveda existente (queda bloqueada hasta introducir la contraseña). */
  open(vaultPath: string): VaultStatus {
    const target = resolve(vaultPath)
    const manifest = readManifest(target)
    this.checkSchema(manifest)
    this.closeInternal()
    this.path = target
    return this.emit()
  }

  // --- Desbloquear --------------------------------------------------------------

  async unlock(password: string, force = false): Promise<VaultStatus> {
    return this.exclusive(async () => {
      const vaultPath = this.requirePath()
      if (this.unlocked) return this.status()
      const manifest = readManifest(vaultPath)
      this.checkSchema(manifest)
      const masterKey = await unwrapMasterKey(
        manifest.keySlots.password,
        password,
        manifest.kdf,
        slotAad(manifest, 'password'),
      )
      if (!masterKey) {
        // ¿Se cortó una rotación de clave a medias? Probar con el manifiesto pendiente.
        const recovered = await this.tryPendingManifest(password, force)
        if (recovered) return this.emit()
        throw new AppError('WRONG_PASSWORD')
      }
      try {
        await this.finishUnlock(masterKey, force)
      } catch (e) {
        // La contraseña abre la ranura vieja pero crm.db ya se re-cifró con la clave nueva.
        const interrupted = e instanceof AppError && e.code === 'VAULT_CORRUPT'
        if (interrupted && (await this.tryPendingManifest(password, force))) return this.emit()
        throw e
      }
      // Si quedó un manifiesto pendiente pero la clave actual abre crm.db, la rotación
      // no llegó a re-cifrar nada: el pendiente sobra.
      rmSync(join(vaultPath, PENDING_MANIFEST), { force: true })
      return this.emit()
    })
  }

  async recover(recoveryKey: string, newPassword: string, force = false): Promise<VaultStatus> {
    return this.exclusive(async () => {
      const vaultPath = this.requirePath()
      const canonical = normalizeRecoveryKey(recoveryKey)
      if (!canonical) throw new AppError('WRONG_RECOVERY_KEY')
      const manifest = readManifest(vaultPath)
      this.checkSchema(manifest)
      const masterKey = await unwrapMasterKey(
        manifest.keySlots.recovery,
        canonical,
        manifest.kdf,
        slotAad(manifest, 'recovery'),
      )
      if (!masterKey) throw new AppError('WRONG_RECOVERY_KEY')
      if (!this.unlocked) await this.finishUnlock(masterKey, force)
      // Con la bóveda ya abierta (y el lock tomado), se sustituye la contraseña.
      const password = await wrapMasterKey(
        this.unlocked!.masterKey,
        newPassword,
        manifest.kdf,
        slotAad(manifest, 'password'),
      )
      writeManifest(vaultPath, { ...manifest, keySlots: { ...manifest.keySlots, password } })
      return this.emit()
    })
  }

  private async finishUnlock(masterKey: Buffer, force: boolean): Promise<void> {
    const vaultPath = this.requirePath()
    let lock: LockInfo | null = null
    let sqlite: SqliteDb | null = null
    try {
      lock = acquireLock(vaultPath, {
        instanceId: this.instanceId,
        force,
        ...(this.hostname ? { hostname: this.hostname } : {}),
      })
      const dbKey = deriveSubkey(masterKey, DB_KEY_PURPOSE)
      try {
        sqlite = openEncryptedDb(join(vaultPath, VAULT_FILES.db), dbKey)
      } catch (e) {
        // La clave maestra es correcta (descifró la ranura) pero no abre crm.db.
        if (e instanceof AppError && e.code === 'WRONG_PASSWORD')
          throw new AppError('VAULT_CORRUPT')
        throw e
      } finally {
        zeroize(dbKey)
      }
      const db = sqlite
      const result = runMigrations(db, this.migrations, {
        beforeMigrate: (from, to) =>
          backupVault(vaultPath, db, `antes-de-migrar-v${from}-a-v${to}`),
      })
      const manifest = readManifest(vaultPath)
      if (manifest.schemaVersion !== result.to) {
        writeManifest(vaultPath, { ...manifest, schemaVersion: result.to })
      }
      let data: DataService | null = null
      if (this.dataOptions !== false) {
        const filesKey = loadOrCreateFilesKey(sqlite)
        const files = new FileStore(filesKey, vaultPath)
        zeroize(filesKey)
        data = new DataService(sqlite, { ...this.dataOptions, files })
      }
      const heartbeat = setInterval(() => {
        if (this.unlocked) this.unlocked.lock = refreshLock(vaultPath, this.unlocked.lock)
      }, HEARTBEAT_MS)
      heartbeat.unref()
      this.unlocked = { sqlite, db: toDrizzle(sqlite), data, masterKey, lock, heartbeat }
    } catch (e) {
      if (sqlite?.open) sqlite.close()
      if (lock) releaseLock(vaultPath, this.instanceId)
      zeroize(masterKey)
      if (e instanceof AppError) throw e
      throw new AppError('MIGRATION_FAILED', { cause: String(e) })
    }
  }

  // --- Bloquear y cerrar ----------------------------------------------------------

  lock(): VaultStatus {
    this.lockInternal()
    return this.emit()
  }

  /** Bloquea y olvida la bóveda seleccionada (vuelve a la pantalla de bienvenida). */
  close(): VaultStatus {
    this.closeInternal()
    return this.emit()
  }

  /** Para el cierre de la app: deja la bóveda consistente y sin lock. */
  dispose(): void {
    this.lockInternal()
  }

  private lockInternal(): void {
    const u = this.unlocked
    if (!u) return
    this.unlocked = null
    clearInterval(u.heartbeat)
    u.data?.dispose()
    try {
      closeDb(u.sqlite)
    } finally {
      zeroize(u.masterKey)
      if (this.path) releaseLock(this.path, this.instanceId)
    }
  }

  private closeInternal(): void {
    this.lockInternal()
    this.path = null
  }

  // --- Contraseña y claves --------------------------------------------------------

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await this.exclusive(async () => {
      const u = this.requireUnlocked()
      const vaultPath = this.requirePath()
      const manifest = readManifest(vaultPath)
      const check = await unwrapMasterKey(
        manifest.keySlots.password,
        currentPassword,
        manifest.kdf,
        slotAad(manifest, 'password'),
      )
      if (!check) throw new AppError('WRONG_PASSWORD')
      zeroize(check)
      const password = await wrapMasterKey(
        u.masterKey,
        newPassword,
        manifest.kdf,
        slotAad(manifest, 'password'),
      )
      writeManifest(vaultPath, { ...manifest, keySlots: { ...manifest.keySlots, password } })
    })
  }

  /**
   * Genera una clave maestra nueva, re-cifra crm.db y crea una clave de
   * recuperación nueva (la anterior deja de servir).
   *
   * Orden pensado para sobrevivir a un corte a mitad:
   *   1. copia de seguridad,
   *   2. se escribe el manifiesto nuevo como vault.json.pending,
   *   3. se re-cifra crm.db,
   *   4. vault.json.pending sustituye a vault.json.
   * Si se corta entre 3 y 4, al desbloquear se detecta y se completa (tryPendingManifest).
   */
  async rotateKey(password: string): Promise<{ recoveryKey: string }> {
    return this.exclusive(async () => {
      const u = this.requireUnlocked()
      const vaultPath = this.requirePath()
      const manifest = readManifest(vaultPath)
      const check = await unwrapMasterKey(
        manifest.keySlots.password,
        password,
        manifest.kdf,
        slotAad(manifest, 'password'),
      )
      if (!check) throw new AppError('WRONG_PASSWORD')
      zeroize(check)

      backupVault(vaultPath, u.sqlite, 'antes-de-rotar-clave')

      const newMaster = generateMasterKey()
      const recoveryKey = generateRecoveryKey()
      const base = { vaultId: manifest.vaultId, keyGeneration: manifest.keyGeneration + 1 }
      const [passwordSlot, recoverySlot] = await Promise.all([
        wrapMasterKey(newMaster, password, manifest.kdf, slotAad(base, 'password')),
        wrapMasterKey(
          newMaster,
          normalizeRecoveryKey(recoveryKey)!,
          manifest.kdf,
          slotAad(base, 'recovery'),
        ),
      ])
      const next: VaultManifest = {
        ...manifest,
        ...base,
        keySlots: { password: passwordSlot, recovery: recoverySlot },
      }
      const pendingPath = join(vaultPath, PENDING_MANIFEST)
      writeFileAtomic(pendingPath, JSON.stringify(next, null, 2) + '\n')
      const newDbKey = deriveSubkey(newMaster, DB_KEY_PURPOSE)
      try {
        rekeyDb(u.sqlite, newDbKey)
      } finally {
        zeroize(newDbKey)
      }
      renameSync(pendingPath, manifestPath(vaultPath))
      zeroize(u.masterKey)
      u.masterKey = newMaster
      return { recoveryKey }
    })
  }

  /** Completa una rotación de clave interrumpida. Devuelve true si desbloqueó. */
  private async tryPendingManifest(password: string, force: boolean): Promise<boolean> {
    const vaultPath = this.requirePath()
    const pendingPath = join(vaultPath, PENDING_MANIFEST)
    if (!existsSync(pendingPath)) return false
    let pending: VaultManifest
    try {
      pending = vaultManifestSchema.parse(JSON.parse(readFileSync(pendingPath, 'utf8')))
    } catch {
      return false
    }
    const masterKey = await unwrapMasterKey(
      pending.keySlots.password,
      password,
      pending.kdf,
      slotAad(pending, 'password'),
    )
    if (!masterKey) return false
    // Solo se da por buena si esa clave abre de verdad crm.db.
    const dbKey = deriveSubkey(masterKey, DB_KEY_PURPOSE)
    try {
      const probe = openEncryptedDb(join(vaultPath, VAULT_FILES.db), dbKey)
      closeDb(probe)
    } catch {
      zeroize(masterKey)
      return false
    } finally {
      zeroize(dbKey)
    }
    renameSync(pendingPath, manifestPath(vaultPath))
    await this.finishUnlock(masterKey, force)
    return true
  }

  // --- Ajustes dentro de la bóveda --------------------------------------------

  getAutoLockMinutes(): number {
    const v = this.getSetting(AUTO_LOCK_KEY)
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : DEFAULT_AUTO_LOCK_MINUTES
  }

  setAutoLockMinutes(minutes: number): VaultStatus {
    this.putSetting(AUTO_LOCK_KEY, minutes)
    return this.emit()
  }

  getAppearance(): Appearance {
    const parsed = appearanceSchema.safeParse(this.getSetting(APPEARANCE_KEY))
    return parsed.success ? parsed.data : DEFAULT_APPEARANCE
  }

  setAppearance(patch: AppearancePatch): VaultStatus {
    const next = { ...this.getAppearance(), ...patch }
    this.putSetting(APPEARANCE_KEY, appearanceSchema.parse(next))
    return this.emit()
  }

  /** Temas creados por el usuario (fase 12). */
  getThemes(): Theme[] {
    const parsed = customThemesSchema.safeParse(this.getSetting(THEMES_KEY) ?? [])
    return parsed.success ? parsed.data : []
  }

  /** Guarda los temas propios. Si el tema en uso ya no existe, se vuelve al oscuro. */
  setThemes(themes: Theme[]): VaultStatus {
    const list = customThemesSchema.parse(themes)
    this.putSetting(THEMES_KEY, list)
    const a = this.getAppearance()
    if (![...BUILT_IN_THEMES, ...list].some((t) => t.id === a.theme))
      this.putSetting(APPEARANCE_KEY, { ...a, theme: DEFAULT_APPEARANCE.theme })
    return this.emit()
  }

  private getSetting(key: string): unknown {
    return this.db.select().from(settings).where(eq(settings.key, key)).get()?.value
  }

  private putSetting(key: string, value: unknown): void {
    const now = new Date().toISOString()
    this.db
      .insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } })
      .run()
  }

  // --- Utilidades -------------------------------------------------------------

  private checkSchema(manifest: VaultManifest): void {
    if (manifest.schemaVersion > this.schemaVersion) throw new AppError('VAULT_TOO_NEW')
  }

  private requirePath(): string {
    if (!this.path) throw new AppError('VAULT_NOT_OPEN')
    return this.path
  }

  private requireUnlocked(): Unlocked {
    if (!this.unlocked) throw new AppError('VAULT_IS_LOCKED')
    return this.unlocked
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new AppError('UNKNOWN', undefined, t('Hay otra operación en curso.'))
    this.busy = true
    try {
      return await fn()
    } finally {
      this.busy = false
    }
  }

  private emit(): VaultStatus {
    const s = this.status()
    this.onChange?.(s)
    return s
  }
}
