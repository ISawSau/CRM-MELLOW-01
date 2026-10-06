import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { AppError } from '@shared/errors'
import { CLONE_IDLE, type CloneStatus } from '@shared/google'
import { t } from '@shared/i18n'
import { VAULT_FILES } from '../vault/vault-file'
import {
  asGoogleError,
  cleanGoogleClient,
  connectGoogle,
  type ConnectOptions,
  type GoogleClient,
  type GoogleLogins,
} from './google-auth'
import { DRIVE_URLS, DriveRemote, type DriveUrls, type FetchLike } from './remote'
import { manifestSchema } from './sync-service'

/** Una petición a Drive que no contesta en este tiempo se da por perdida. */
const HEADERS_TIMEOUT_MS = 30_000

export interface CloneOptions {
  client: GoogleClient
  /** Carpeta donde se crea la copia (una subcarpeta nueva). */
  parentPath: string
  openBrowser: (url: string) => void
  http?: FetchLike
  logins?: GoogleLogins
  /** Direcciones y tiempos de Google (tests). */
  connect?: Pick<ConnectOptions, 'authUrl' | 'tokenUrl' | 'timeoutMs' | 'retryMs' | 'retryDelayMs'>
  driveUrls?: DriveUrls
  signal?: AbortSignal
  /** Avance: Google ha respondido, se busca la bóveda y se baja (bytes y total). */
  onPhase?: (
    phase: 'token' | 'search' | 'download',
    received?: number,
    total?: number | null,
  ) => void
}

/**
 * Peticiones a Drive que se cancelan con `signal` y que no se quedan esperando una
 * respuesta para siempre (red móvil que deja de contestar).
 */
function guarded(http: FetchLike, signal?: AbortSignal): FetchLike {
  return async (input, init = {}) => {
    const ctrl = new AbortController()
    const timer = setTimeout(
      () => ctrl.abort(new Error(t('Google Drive no responde. Comprueba la conexión a internet.'))),
      HEADERS_TIMEOUT_MS,
    )
    const signals = [
      ctrl.signal,
      ...(signal ? [signal] : []),
      ...(init.signal ? [init.signal] : []),
    ]
    try {
      return await http(input, { ...init, signal: AbortSignal.any(signals) })
    } finally {
      clearTimeout(timer)
    }
  }
}

/**
 * Trae una bóveda desde Google Drive a un equipo o móvil nuevo (D-101): conecta con
 * Google, busca la bóveda (la más reciente si hay varias) y baja `crm.db` y `vault.json`,
 * que vienen cifrados. Los archivos los baja después la sincronización, al desbloquear con
 * la contraseña de siempre. Devuelve la carpeta de la bóveda nueva.
 */
export async function cloneFromDrive(o: CloneOptions): Promise<string> {
  const http = guarded(o.http ?? fetch, o.signal)
  const urls = o.driveUrls ?? DRIVE_URLS
  const tokens = await connectGoogle(o.client, o.openBrowser, o.http ?? fetch, {
    ...o.connect,
    ...(o.logins ? { logins: o.logins } : {}),
    ...(o.signal ? { signal: o.signal } : {}),
    onCode: () => o.onPhase?.('token'),
  })
  o.onPhase?.('search')
  const token = () => Promise.resolve(tokens.accessToken)
  const found: { remote: DriveRemote; uploadedAt: string }[] = []
  for (const name of await DriveRemote.vaultFolders(token, http, urls)) {
    const remote = new DriveRemote(name, token, http, urls)
    const text = await remote.readText('sync.json')
    if (!text) continue
    const m = manifestSchema.safeParse(JSON.parse(text))
    if (m.success) found.push({ remote, uploadedAt: m.data.uploadedAt })
  }
  found.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
  const latest = found[0]
  if (!latest)
    throw new AppError(
      'INVALID_INPUT',
      undefined,
      t(
        'No hay ninguna bóveda de CRM Mellow en este Google Drive. Comprueba que has entrado con la misma cuenta de Google que en el ordenador y que allí está activada la sincronización con Google Drive (con un id de cliente del mismo proyecto de Google Cloud).',
      ),
    )
  let target = join(o.parentPath, 'CRM-Boveda')
  for (let i = 2; existsSync(target); i++) target = join(o.parentPath, `CRM-Boveda-${i}`)
  mkdirSync(target, { recursive: true })
  try {
    o.onPhase?.('download', 0, null)
    if (!(await latest.remote.get('vault.json', join(target, VAULT_FILES.manifest))))
      throw new Error(t('Falta vault.json en el destino.'))
    const progress = (received: number, total: number | null) =>
      o.onPhase?.('download', received, total)
    if (!(await latest.remote.get('crm.db', join(target, VAULT_FILES.db), progress)))
      throw new Error(t('Falta crm.db en el destino.'))
  } catch (e) {
    rmSync(target, { recursive: true, force: true })
    throw e
  }
  return target
}

export interface CloneJobOptions extends Pick<
  CloneOptions,
  'openBrowser' | 'http' | 'logins' | 'connect' | 'driveUrls'
> {
  /** Mantiene viva la app mientras dura (Android: servicio en primer plano, D-118). */
  hold?: (text: string) => () => void
  /** Abre la bóveda traída (queda bloqueada, a la espera de la contraseña). */
  opened: (path: string) => void
  onChange?: (status: CloneStatus) => void
}

/**
 * «Traer desde Google Drive» como trabajo del motor (D-118): la interfaz lo arranca y
 * consulta su estado, en lugar de esperar una respuesta que puede tardar minutos (y que en
 * el móvil se puede perder mientras la app está en segundo plano). Uno a la vez.
 */
export class CloneJob {
  private current: CloneStatus = CLONE_IDLE
  private ctrl: AbortController | null = null

  constructor(private readonly o: CloneJobOptions) {}

  status(): CloneStatus {
    return this.current
  }

  private set(next: CloneStatus): void {
    this.current = next
    this.o.onChange?.(next)
  }

  start(client: GoogleClient, parentPath: string): CloneStatus {
    // Un id mal copiado se dice ya, antes de abrir el navegador.
    cleanGoogleClient(client)
    this.ctrl?.abort()
    const ctrl = new AbortController()
    this.ctrl = ctrl
    this.set({ ...CLONE_IDLE, phase: 'login' })
    const release = this.o.hold?.(t('Trayendo la bóveda desde Google Drive…')) ?? (() => {})
    const live = () => this.ctrl === ctrl && !ctrl.signal.aborted
    void cloneFromDrive({
      client,
      parentPath,
      openBrowser: this.o.openBrowser,
      signal: ctrl.signal,
      ...(this.o.http ? { http: this.o.http } : {}),
      ...(this.o.logins ? { logins: this.o.logins } : {}),
      ...(this.o.connect ? { connect: this.o.connect } : {}),
      ...(this.o.driveUrls ? { driveUrls: this.o.driveUrls } : {}),
      onPhase: (phase, received = 0, total = null) => {
        if (live()) this.set({ phase, received, total, error: null })
      },
    })
      .then((path) => {
        if (!live()) return rmSync(path, { recursive: true, force: true })
        this.o.opened(path)
        this.set({ ...this.current, phase: 'done', error: null })
      })
      .catch((e: unknown) => {
        if (!live()) return
        const err = asGoogleError(e)
        this.set({
          ...this.current,
          phase: 'error',
          error: { code: err.code, message: err.message },
        })
      })
      .finally(() => {
        release()
        if (this.ctrl === ctrl) this.ctrl = null
      })
    return this.current
  }

  /** Cancela lo que esté en marcha y deja el estado en reposo (también tras un error). */
  cancel(): CloneStatus {
    this.ctrl?.abort()
    this.ctrl = null
    this.set(CLONE_IDLE)
    return this.current
  }
}
