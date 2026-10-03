import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { BackupEntry, SyncStatus } from '@shared/ipc'
import { backupVault } from '../db/backup'
import { checkpoint, type SqliteDb } from '../db/connection'
import { VAULT_FILES } from '../vault/vault-file'
import type { VaultService } from '../vault/vault-service'
import { connectGoogle, refreshAccess, type GoogleClient } from './google-auth'
import { DriveRemote, FolderRemote, type FetchLike, type Remote } from './remote'
import { t } from '@shared/i18n'

/**
 * Sincronización entre equipos y copias de seguridad (SPEC §4).
 *
 * Modelo: la nube guarda una «generación» (sync.json). Cada subida la incrementa.
 * Cada equipo recuerda (dentro de su base de datos cifrada) la generación que tiene y
 * un contador de cambios. Al abrir:
 * - nube más nueva y aquí sin cambios → se descarga;
 * - nube más nueva y aquí con cambios → conflicto: el usuario elige y la otra versión
 *   queda como copia de seguridad;
 * - aquí con cambios y la nube igual → se sube.
 * No se fusiona nada automáticamente (v1).
 */

const CONFIG_KEY = 'sync.config'
const STATE_KEY = 'sync.state'
const BACKUP_CONFIG_KEY = 'backups.config'
const BACKUP_LAST_KEY = 'backups.last'
export const CHANGES_KEY = 'sync.changes'
const FORCE_PUSH_KEY = 'sync.forcePush'
const AUTO_REASON = 'automatica'
const PERIODIC_MS = 30 * 60_000

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

const stateSchema = z.object({
  generation: z.number().int().min(0).default(0),
  changeMark: z.number().int().min(0).default(0),
  lastSyncAt: z.string().nullable().default(null),
})
type SyncState = z.infer<typeof stateSchema>

export const backupConfigSchema = z.object({
  intervalDays: z.number().int().min(1).max(60).default(3),
  keepLast: z.number().int().min(1).max(100).default(10),
  keepMonthly: z.boolean().default(true),
})
export type BackupConfig = z.infer<typeof backupConfigSchema>

const manifestSchema = z.object({
  format: z.literal('crm-mellow-sync'),
  version: z.literal(1),
  vaultId: z.string(),
  generation: z.number().int().min(1),
  device: z.string(),
  uploadedAt: z.string(),
})
type RemoteManifest = z.infer<typeof manifestSchema>

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

export interface SyncServiceOptions {
  hostname: string
  openBrowser: (url: string) => void
  onChange?: (s: SyncStatus) => void
  http?: FetchLike
  now?: () => Date
}

export class SyncService {
  private phase: SyncStatus['phase'] = 'idle'
  private error: string | null = null
  private conflict: SyncStatus['conflict'] = null
  private running: Promise<void> | null = null
  private access: { token: string; expiresAt: number } | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly vault: VaultService,
    private readonly opts: SyncServiceOptions,
  ) {}

  private get http(): FetchLike {
    return this.opts.http ?? fetch
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date()
  }

  private db(): SqliteDb {
    return this.vault.sqlite
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

  private changes(): number {
    const v = readSetting(this.db(), CHANGES_KEY)
    return typeof v === 'number' ? v : 0
  }

  backupConfig(): BackupConfig {
    return backupConfigSchema.parse(readSetting(this.db(), BACKUP_CONFIG_KEY) ?? {})
  }

  setBackupConfig(cfg: BackupConfig): SyncStatus {
    writeSetting(this.db(), BACKUP_CONFIG_KEY, backupConfigSchema.parse(cfg))
    return this.emit()
  }

  status(): SyncStatus {
    let cfg: SyncConfig | null = null
    let st: SyncState | null = null
    let last: string | null = null
    let dirty = false
    try {
      cfg = this.config()
      st = this.state()
      dirty = this.changes() > st.changeMark
      const l = readSetting(this.db(), BACKUP_LAST_KEY)
      last = typeof l === 'string' ? l : null
    } catch {
      // Bóveda bloqueada.
    }
    return {
      kind: cfg?.kind ?? null,
      label: cfg ? this.remoteFor(cfg).label : null,
      phase: this.phase,
      error: this.error,
      conflict: this.conflict,
      lastSyncAt: st?.lastSyncAt ?? null,
      pending: dirty,
      lastBackupAt: last,
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
        const fresh = await refreshAccess(client, cfg.refreshToken, this.http)
        this.access = { token: fresh.accessToken, expiresAt: fresh.expiresAt }
        return fresh.accessToken
      },
      this.http,
    )
  }

  private remote(): Remote | null {
    const cfg = this.config()
    return cfg ? this.remoteFor(cfg) : null
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
    this.resetState()
    return this.emit()
  }

  async configureDrive(client: GoogleClient): Promise<SyncStatus> {
    const tokens = await connectGoogle(client, this.opts.openBrowser, this.http)
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
    const id = (this.vault.vaultId ?? 'boveda').slice(0, 8)
    writeSetting(this.db(), CONFIG_KEY, {
      kind: 'drive',
      ...client,
      refreshToken: tokens.refreshToken,
      rootName: `CRM Mellow · ${id}`,
    })
    this.resetState()
    return this.emit()
  }

  disconnect(): SyncStatus {
    deleteSetting(this.db(), CONFIG_KEY)
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
  }

  // --- Ciclo de sincronización ---------------------------------------------------

  /** Tras desbloquear: sincroniza, copia de seguridad si toca y arranca el ciclo periódico. */
  async afterUnlock(): Promise<void> {
    this.stopTimer()
    await this.sync()
    try {
      await this.maybeBackup()
    } catch (e) {
      this.fail(e)
    }
    this.timer = setInterval(() => {
      void (async () => {
        try {
          if (this.status().pending) await this.sync()
          await this.maybeBackup()
        } catch {
          // Se reintenta en la siguiente vuelta.
        }
      })()
    }, PERIODIC_MS)
    this.timer.unref?.()
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Antes de bloquear o cerrar: sube lo pendiente (con límite de tiempo). */
  async beforeClose(timeoutMs = 60_000): Promise<void> {
    this.stopTimer()
    let pending: boolean
    try {
      pending = !!this.config() && this.changes() > this.state().changeMark
    } catch {
      return
    }
    if (!pending || this.conflict) return
    await Promise.race([this.sync(), new Promise<void>((r) => setTimeout(r, timeoutMs))])
  }

  /** «Sincronizar ahora». */
  sync(): Promise<void> {
    if (this.running) return this.running
    this.running = this.doSync().finally(() => {
      this.running = null
    })
    return this.running
  }

  private fail(e: unknown): void {
    this.phase = 'error'
    this.error = e instanceof Error ? e.message : t('Error de sincronización.')
    this.emit()
  }

  private async readManifest(remote: Remote): Promise<RemoteManifest | null> {
    const text = await remote.readText('sync.json')
    if (!text) return null
    const m = manifestSchema.safeParse(JSON.parse(text))
    if (!m.success) throw new Error(t('El destino tiene un sync.json que no es de CRM Mellow.'))
    if (m.data.vaultId !== this.vault.vaultId)
      throw new Error(t('El destino tiene otra bóveda: elige otra carpeta o desconecta.'))
    return m.data
  }

  private async doSync(): Promise<void> {
    const remote = this.remote()
    if (!remote) return
    this.phase = 'syncing'
    this.error = null
    this.emit()
    try {
      const m = await this.readManifest(remote)
      const st = this.state()
      const dirty = this.changes() > st.changeMark
      const remoteGen = m?.generation ?? 0
      if (readSetting(this.db(), FORCE_PUSH_KEY) === true) {
        // Tras restaurar una copia: lo restaurado pasa a ser la versión buena.
        await this.push(remote, remoteGen)
        deleteSetting(this.db(), FORCE_PUSH_KEY)
      } else if (m && remoteGen > st.generation) {
        if (dirty) {
          this.conflict = { device: m.device, uploadedAt: m.uploadedAt }
          this.phase = 'conflict'
          this.emit()
          return
        }
        const result = await this.pull(remote, m)
        if (result === 'locked') return
      } else if (dirty || !m || remoteGen < st.generation) {
        await this.push(remote, remoteGen)
      }
      await this.downloadMissing(remote)
      this.conflict = null
      this.phase = 'idle'
      this.emit()
    } catch (e) {
      this.fail(e)
    }
  }

  private tmpDir(): string {
    const dir = join(this.vault.currentPath!, '.sincronizacion')
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    return dir
  }

  private async pull(remote: Remote, m: RemoteManifest): Promise<'reopened' | 'locked'> {
    const dir = this.tmpDir()
    try {
      if (!(await remote.get('crm.db', join(dir, VAULT_FILES.db))))
        throw new Error(t('Falta crm.db en el destino.'))
      if (!(await remote.get('vault.json', join(dir, VAULT_FILES.manifest))))
        throw new Error(t('Falta vault.json en el destino.'))
      const r = await this.vault.replaceDatabase(dir, 'antes-de-sincronizar')
      if (r === 'locked') {
        this.phase = 'idle'
        this.error = t(
          'Los datos de la nube usan otra contraseña: desbloquea con la contraseña actual.',
        )
        this.emit()
        return 'locked'
      }
      writeSetting(this.db(), STATE_KEY, {
        generation: m.generation,
        changeMark: this.changes(),
        lastSyncAt: this.now().toISOString(),
      })
      return 'reopened'
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  private async push(remote: Remote, baseGen: number): Promise<void> {
    const vaultPath = this.vault.currentPath!
    // 1. Archivos que la nube aún no tiene (están cifrados; el nombre es su HMAC).
    for (const kind of ['files', 'thumbs'] as const) {
      const there = new Set(await remote.list(kind))
      const local = this.localBlobs(kind)
      for (const id of local)
        if (!there.has(`${id}.bin`))
          await remote.put(`${kind}/${id}.bin`, join(vaultPath, kind, id.slice(0, 2), `${id}.bin`))
    }
    // 2. ¿Alguien ha subido mientras tanto?
    const latest = await this.readManifest(remote)
    if ((latest?.generation ?? 0) !== baseGen)
      throw new Error(t('La nube ha cambiado: vuelve a sincronizar.'))
    // 3. La base de datos lleva ya su nueva generación (así el otro equipo la conoce).
    const before = this.state()
    const gen = baseGen + 1
    const at = this.now().toISOString()
    writeSetting(this.db(), STATE_KEY, {
      generation: gen,
      changeMark: this.changes(),
      lastSyncAt: at,
    })
    const dir = this.tmpDir()
    try {
      checkpoint(this.db())
      copyFileSync(join(vaultPath, VAULT_FILES.db), join(dir, VAULT_FILES.db))
      copyFileSync(join(vaultPath, VAULT_FILES.manifest), join(dir, VAULT_FILES.manifest))
      await remote.put('crm.db', join(dir, VAULT_FILES.db))
      await remote.put('vault.json', join(dir, VAULT_FILES.manifest))
      // 4. sync.json al final: es lo que confirma la subida.
      const manifest: RemoteManifest = {
        format: 'crm-mellow-sync',
        version: 1,
        vaultId: this.vault.vaultId!,
        generation: gen,
        device: this.opts.hostname,
        uploadedAt: at,
      }
      await remote.writeText('sync.json', JSON.stringify(manifest, null, 2))
    } catch (e) {
      writeSetting(this.db(), STATE_KEY, before)
      throw e
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  private localBlobs(kind: 'files' | 'thumbs'): string[] {
    const root = join(this.vault.currentPath!, kind)
    if (!existsSync(root)) return []
    return readdirSync(root)
      .filter((d) => /^[a-f0-9]{2}$/.test(d))
      .flatMap((d) => readdirSync(join(root, d)))
      .filter((n) => /^[a-f0-9]{64}\.bin$/.test(n))
      .map((n) => n.slice(0, 64))
  }

  /** Archivos que usa la base de datos y aún no están en este equipo. */
  private async downloadMissing(remote: Remote): Promise<void> {
    const vaultPath = this.vault.currentPath!
    const rows = this.db().prepare('SELECT id, has_thumb FROM files').all() as {
      id: string
      has_thumb: number
    }[]
    for (const r of rows) {
      for (const kind of ['files', 'thumbs'] as const) {
        if (kind === 'thumbs' && !r.has_thumb) continue
        const dest = join(vaultPath, kind, r.id.slice(0, 2), `${r.id}.bin`)
        if (!existsSync(dest)) await remote.get(`${kind}/${r.id}.bin`, dest)
      }
    }
  }

  /** Resuelve un conflicto; la versión descartada queda como copia de seguridad. */
  async resolve(keep: 'local' | 'remote'): Promise<void> {
    const remote = this.remote()
    if (!remote || !this.conflict) return
    try {
      this.phase = 'syncing'
      this.emit()
      const m = await this.readManifest(remote)
      if (!m) throw new Error(t('El destino ya no tiene datos.'))
      if (keep === 'local') {
        // La versión de la nube se guarda aquí como copia antes de sustituirla.
        const stamp = this.now()
          .toISOString()
          .replace(/\.\d+Z$/, '')
          .replace(/[-:]/g, '')
          .replace('T', '-')
        const dir = join(this.vault.currentPath!, VAULT_FILES.backups, `${stamp}-conflicto-nube`)
        mkdirSync(dir, { recursive: true })
        await remote.get('crm.db', join(dir, VAULT_FILES.db))
        await remote.get('vault.json', join(dir, VAULT_FILES.manifest))
        await this.push(remote, m.generation)
      } else {
        const r = await this.pull(remote, m)
        if (r === 'locked') return
      }
      await this.downloadMissing(remote)
      this.conflict = null
      this.phase = 'idle'
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
    const vaultPath = this.vault.currentPath!
    const dir = backupVault(vaultPath, this.db(), reason, this.now())
    const name = dir.split(/[\\/]/).pop()!
    if (reason === AUTO_REASON) writeSetting(this.db(), BACKUP_LAST_KEY, this.now().toISOString())
    const remote = this.remote()
    const cfg = this.backupConfig()
    const localDir = join(vaultPath, VAULT_FILES.backups)
    for (const n of backupsToPrune(readdirSync(localDir), cfg))
      rmSync(join(localDir, n), { recursive: true, force: true })
    if (remote) {
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
    const localDir = join(this.vault.currentPath!, VAULT_FILES.backups)
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
    const dir = join(this.vault.currentPath!, VAULT_FILES.backups, name)
    if (!existsSync(join(dir, VAULT_FILES.db))) {
      const remote = this.remote()
      if (!remote) throw new AppError('INVALID_INPUT', undefined, t('La copia no existe.'))
      mkdirSync(dir, { recursive: true })
      const ok =
        (await remote.get(`backups/${name}/crm.db`, join(dir, VAULT_FILES.db))) &&
        (await remote.get(`backups/${name}/vault.json`, join(dir, VAULT_FILES.manifest)))
      if (!ok) throw new AppError('INVALID_INPUT', undefined, t('La copia no existe.'))
    }
    const r = await this.vault.replaceDatabase(dir, 'antes-de-restaurar')
    if (r === 'reopened') {
      // Lo restaurado se sube en la próxima sincronización, aunque la nube sea más nueva.
      writeSetting(this.db(), CHANGES_KEY, this.changes() + 1)
      writeSetting(this.db(), FORCE_PUSH_KEY, true)
    }
    this.emit()
    return r
  }

  dispose(): void {
    this.stopTimer()
  }
}
