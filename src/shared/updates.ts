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

export const updateSettingsSchema = z.object({
  /** Consultar una vez al día si hay versión nueva. */
  check: z.boolean().default(true),
  /** Versión cuyo aviso se ha cerrado: no se vuelve a mostrar hasta la siguiente. */
  dismissed: z.string().max(32).nullable().default(null),
})
export type UpdateSettings = z.infer<typeof updateSettingsSchema>

export interface UpdateStatus {
  current: string
  /** Última versión publicada que se conoce (null si aún no se ha consultado). */
  latest: string | null
  /** Página de la versión nueva. */
  url: string
  /** Hay una versión nueva, la consulta está activada y su aviso no se ha cerrado. */
  show: boolean
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

const releaseSchema = z.object({
  tag_name: z.string().max(64),
  html_url: z.string().max(500).optional(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
})

/**
 * Lee la respuesta de la API. El enlace solo se acepta si apunta a los Releases de este
 * repositorio; si no, se usa la página de descarga.
 */
export function parseLatestRelease(json: unknown): { version: string; url: string } | null {
  const r = releaseSchema.safeParse(json)
  if (!r.success || r.data.draft || r.data.prerelease) return null
  const parts = parseVersion(r.data.tag_name)
  if (!parts) return null
  const url = r.data.html_url?.startsWith(RELEASES_PREFIX) ? r.data.html_url : RELEASES_PAGE
  return { version: parts.join('.'), url }
}
