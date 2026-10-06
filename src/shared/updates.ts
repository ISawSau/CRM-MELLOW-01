import { z } from 'zod'

/**
 * Aviso de versión nueva (D-114). Con el repositorio público, la app consulta sin token
 * la última versión publicada en GitHub Releases (documentación de la API REST de GitHub,
 * «Get the latest release»: solo devuelve versiones publicadas, sin borradores ni
 * prereleases).
 */
export const RELEASES_LATEST_API =
  'https://api.github.com/repos/ISawSau/CRM-MELLOW-01/releases/latest'
/** Página de descarga, para cuando la respuesta no trae un enlace válido. */
export const RELEASES_PAGE = 'https://github.com/ISawSau/CRM-MELLOW-01/releases/latest'
const RELEASES_PREFIX = 'https://github.com/ISawSau/CRM-MELLOW-01/releases/'
/** Solo se bajan archivos de las versiones publicadas de este repositorio (D-120). */
export const DOWNLOAD_PREFIX = 'https://github.com/ISawSau/CRM-MELLOW-01/releases/download/'

export const updateSettingsSchema = z.object({
  /** Consultar si hay versión nueva (al abrir la bóveda y cada hora, D-120). */
  check: z.boolean().default(true),
  /** Versión cuyo aviso se ha cerrado: no se vuelve a mostrar hasta la siguiente. */
  dismissed: z.string().max(32).nullable().default(null),
})
export type UpdateSettings = z.infer<typeof updateSettingsSchema>

/**
 * Actualizar desde la app (D-120):
 *   downloading  bajando el archivo de la versión nueva
 *   installing   comprobado: se está instalando (la app se cierra y se abre la nueva)
 *   command      bajado y comprobado; hay que instalarlo con un comando (Arch, .pacman)
 *   permission   Android necesita que se permita a la app instalar apps
 *   error        no se ha podido (sin red, huella que no coincide…)
 */
export type UpdatePhase = 'idle' | 'downloading' | 'installing' | 'command' | 'permission' | 'error'

export interface UpdateDownload {
  phase: UpdatePhase
  received: number
  total: number | null
  /** Mensaje del error. */
  message: string | null
  /** Comando para instalar (fase `command`) y archivo bajado. */
  command: string | null
  file: string | null
}

export const DOWNLOAD_IDLE: UpdateDownload = {
  phase: 'idle',
  received: 0,
  total: null,
  message: null,
  command: null,
  file: null,
}

export interface UpdateStatus {
  current: string
  /** Última versión publicada que se conoce (null si aún no se ha consultado). */
  latest: string | null
  /** Página de la versión nueva. */
  url: string
  /** Hay una versión nueva, la consulta está activada y su aviso no se ha cerrado. */
  show: boolean
  /** Hay una versión posterior a la instalada (aunque su aviso se haya cerrado). */
  newer: boolean
  /** Última consulta a GitHub con respuesta (ms) y fallo de la última, si lo hubo. */
  checkedAt: number | null
  checking: boolean
  checkError: string | null
  /** Esta instalación se puede actualizar desde la app (y la versión nueva trae su archivo). */
  canInstall: boolean
  download: UpdateDownload
}

/** Un archivo de la versión publicada (API de GitHub: `assets`). */
export interface ReleaseAsset {
  name: string
  url: string
  size: number
  /** «sha256:…» que calcula GitHub al subirlo, si lo da. */
  digest: string | null
}

export interface LatestRelease {
  version: string
  url: string
  assets: ReleaseAsset[]
}

/** «v1.2.3» o «1.2.3» → [1, 2, 3]. Las prereleases («1.2.3-beta») no cuentan. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** ¿`latest` es posterior a `current`? */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

const assetSchema = z.object({
  name: z.string().max(200),
  browser_download_url: z.string().max(1000),
  size: z.number().int().nonnegative().optional(),
  digest: z.string().max(200).nullable().optional(),
})

const releaseSchema = z.object({
  tag_name: z.string().max(64),
  html_url: z.string().max(500).optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  assets: z.array(z.unknown()).max(100).optional(),
})

/**
 * Lee la respuesta de la API. El enlace solo se acepta si apunta a los Releases de este
 * repositorio; si no, se usa la página de descarga.
 */
export function parseLatestRelease(json: unknown): LatestRelease | null {
  const r = releaseSchema.safeParse(json)
  if (!r.success || r.data.draft || r.data.prerelease) return null
  const parts = parseVersion(r.data.tag_name)
  if (!parts) return null
  const url = r.data.html_url?.startsWith(RELEASES_PREFIX) ? r.data.html_url : RELEASES_PAGE
  const assets: ReleaseAsset[] = []
  for (const raw of r.data.assets ?? []) {
    const a = assetSchema.safeParse(raw)
    // Solo archivos de las versiones de este repositorio, con un nombre sin rutas.
    if (!a.success || !a.data.browser_download_url.startsWith(DOWNLOAD_PREFIX)) continue
    if (!/^[\w.-]+$/.test(a.data.name)) continue
    assets.push({
      name: a.data.name,
      url: a.data.browser_download_url,
      size: a.data.size ?? 0,
      digest: a.data.digest ?? null,
    })
  }
  return { version: parts.join('.'), url, assets }
}

/** Huella SHA-256 (en hexadecimal) de `name` según un SHA256SUMS.txt («huella  nombre»). */
export function sumFor(sums: string, name: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
    if (m && m[2]!.trim() === name) return m[1]!.toLowerCase()
  }
  return null
}
