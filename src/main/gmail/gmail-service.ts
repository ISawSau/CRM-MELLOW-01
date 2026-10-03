import { z } from 'zod'
import { AppError } from '@shared/errors'
import {
  normalizeAddresses,
  parseMailbox,
  threadQuery,
  type GmailMessage,
  type GmailStatus,
  type GmailThread,
  type GmailThreadsResult,
} from '@shared/gmail'
import type { LinkRef, RecordRow } from '@shared/data/records'
import type { SqliteDb } from '../db/connection'
import {
  connectGoogle,
  GMAIL_SCOPE,
  refreshAccess,
  REVOKE_URL,
  TOKEN_URL,
  type GoogleClient,
} from '../sync/google-auth'
import type { FetchLike } from '../sync/remote'
import { deleteSetting, readSetting, writeSetting } from '../sync/sync-service'
import type { VaultService } from '../vault/vault-service'

/**
 * Gmail en solo lectura (SPEC §7.12, D-078). Con el permiso `gmail.readonly` busca los
 * hilos en los que aparecen las direcciones de un cliente (y de sus contactos) o de un
 * contacto. Solo lee cabeceras y extractos (formato «metadata»); el cuerpo del correo
 * se abre en Gmail. No guarda correo en la bóveda: los hilos se piden al abrir la ficha
 * y se guardan unos minutos en memoria.
 *
 * Límites oficiales: 6.000 unidades por minuto y usuario; threads.list cuesta 10 y
 * threads.get 40, así que una página de 15 hilos son 610 unidades.
 */

export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1'
const CONFIG_KEY = 'gmail.config'
const PAGE_SIZE = 15
const CACHE_MS = 5 * 60_000
const MAX_ADDRESSES = 20
const PARALLEL = 5

const configSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string(),
  refreshToken: z.string().min(1),
  email: z.string(),
})
type GmailConfig = z.infer<typeof configSchema>

export interface GmailOptions {
  http?: FetchLike
  openBrowser: (url: string) => void
  /** El cliente de Google de Drive, si lo hay. */
  driveClient: () => GoogleClient | null
  apiUrl?: string
  tokenUrl?: string
  revokeUrl?: string
  onChange?: (s: GmailStatus) => void
  now?: () => number
}

interface ApiHeader {
  name: string
  value: string
}
interface ApiMessage {
  id: string
  labelIds?: string[]
  snippet?: string
  internalDate?: string
  payload?: { headers?: ApiHeader[] }
}

export class GmailService {
  private access: { token: string; expiresAt: number } | null = null
  private error: string | null = null
  private readonly cache = new Map<string, { at: number; result: GmailThreadsResult }>()

  constructor(
    private readonly vault: VaultService,
    private readonly opts: GmailOptions,
  ) {}

  private get http(): FetchLike {
    return this.opts.http ?? fetch
  }

  private get api(): string {
    return this.opts.apiUrl ?? GMAIL_API
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now()
  }

  private db(): SqliteDb {
    return this.vault.sqlite
  }

  private config(): GmailConfig | null {
    const r = configSchema.safeParse(readSetting(this.db(), CONFIG_KEY))
    return r.success ? r.data : null
  }

  status(): GmailStatus {
    let cfg: GmailConfig | null = null
    let hasClient = false
    try {
      cfg = this.config()
      hasClient = this.opts.driveClient() !== null
    } catch {
      // Bóveda bloqueada.
    }
    return { connected: cfg !== null, email: cfg?.email ?? null, hasClient, error: this.error }
  }

  private emit(): GmailStatus {
    const s = this.status()
    this.opts.onChange?.(s)
    return s
  }

  async connect(input: { clientId: string; clientSecret: string }): Promise<GmailStatus> {
    const client: GoogleClient | null = input.clientId
      ? { clientId: input.clientId, clientSecret: input.clientSecret }
      : this.opts.driveClient()
    if (!client)
      throw new AppError(
        'INVALID_INPUT',
        undefined,
        'Escribe el id de cliente de tu proyecto de Google (o conecta antes Google Drive).',
      )
    let tokens
    try {
      tokens = await connectGoogle(client, this.opts.openBrowser, this.http, {
        scope: GMAIL_SCOPE,
        ...(this.opts.tokenUrl ? { tokenUrl: this.opts.tokenUrl } : {}),
      })
    } catch (e) {
      throw new AppError('GMAIL_ERROR', undefined, e instanceof Error ? e.message : String(e))
    }
    this.access = { token: tokens.accessToken, expiresAt: tokens.expiresAt }
    const profile = (await this.get('/users/me/profile')) as { emailAddress?: string }
    writeSetting(this.db(), CONFIG_KEY, {
      ...client,
      refreshToken: tokens.refreshToken,
      email: profile.emailAddress ?? '',
    })
    this.error = null
    this.cache.clear()
    return this.emit()
  }

  /** Desconecta y revoca el permiso en Google (si se puede). */
  async disconnect(): Promise<GmailStatus> {
    const cfg = this.config()
    deleteSetting(this.db(), CONFIG_KEY)
    this.access = null
    this.error = null
    this.cache.clear()
    if (cfg)
      await this.http(this.opts.revokeUrl ?? REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: cfg.refreshToken }),
      }).catch(() => {})
    return this.emit()
  }

  /** Al bloquear: fuera el token de acceso y la caché de correo. */
  dispose(): void {
    this.access = null
    this.cache.clear()
  }

  // --- Hilos --------------------------------------------------------------------------

  /** Direcciones de un registro: sus campos de email y, en un cliente, las de sus contactos. */
  addressesFor(recordId: string): string[] {
    const data = this.vault.data
    const rec = data.get(recordId)
    if (!rec) throw new AppError('INVALID_INPUT', undefined, 'Ese registro no existe.')
    const emailsOf = (r: RecordRow) =>
      data
        .listFields(r.entity)
        .filter((f) => f.type === 'email')
        .map((f) => r.values[f.id])
    const list = emailsOf(rec)
    if (rec.entity === 'cliente') {
      const contactos = data.listFields('cliente').find((f) => f.key === 'contactos')
      const links = (contactos ? (rec.values[contactos.id] as LinkRef[] | undefined) : []) ?? []
      for (const l of links) {
        const c = data.get(l.id)
        if (c) list.push(...emailsOf(c))
      }
    }
    return normalizeAddresses(list).slice(0, MAX_ADDRESSES)
  }

  async threads(input: {
    recordId: string
    pageToken: string | null
    refresh: boolean
  }): Promise<GmailThreadsResult> {
    const cfg = this.config()
    if (!cfg) throw new AppError('GMAIL_ERROR', undefined, 'Gmail no está conectado.')
    const addresses = this.addressesFor(input.recordId)
    if (!addresses.length) return { addresses, threads: [], nextPageToken: null }
    const key = `${addresses.join(',')}|${input.pageToken ?? ''}`
    const hit = this.cache.get(key)
    if (hit && !input.refresh && this.now() - hit.at < CACHE_MS) return hit.result

    const params = new URLSearchParams({ q: threadQuery(addresses), maxResults: String(PAGE_SIZE) })
    if (input.pageToken) params.set('pageToken', input.pageToken)
    const list = (await this.get(`/users/me/threads?${params}`)) as {
      threads?: { id: string; snippet?: string }[]
      nextPageToken?: string
    }
    const ids = list.threads ?? []
    const threads: GmailThread[] = []
    for (let i = 0; i < ids.length; i += PARALLEL) {
      const batch = await Promise.all(
        ids.slice(i, i + PARALLEL).map((t) => this.thread(t.id, t.snippet ?? '', cfg.email)),
      )
      threads.push(...batch)
    }
    const result: GmailThreadsResult = {
      addresses,
      threads,
      nextPageToken: list.nextPageToken ?? null,
    }
    this.cache.set(key, { at: this.now(), result })
    if (this.error) {
      this.error = null
      this.emit()
    }
    return result
  }

  private async thread(id: string, snippet: string, me: string): Promise<GmailThread> {
    const params = new URLSearchParams({ format: 'metadata' })
    for (const h of ['From', 'Subject']) params.append('metadataHeaders', h)
    const t = (await this.get(`/users/me/threads/${encodeURIComponent(id)}?${params}`)) as {
      messages?: ApiMessage[]
    }
    const messages: GmailMessage[] = (t.messages ?? []).map((m) => {
      const header = (n: string) =>
        m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? ''
      const from = parseMailbox(header('From'))
      return {
        id: m.id,
        from: from.address === me.toLowerCase() ? 'Yo' : from.name,
        date: new Date(Number(m.internalDate ?? 0)).toISOString(),
        snippet: decodeEntities(m.snippet ?? ''),
        unread: m.labelIds?.includes('UNREAD') ?? false,
      }
    })
    const first = t.messages?.[0]
    const subject =
      first?.payload?.headers?.find((h) => h.name.toLowerCase() === 'subject')?.value.trim() ||
      '(sin asunto)'
    return {
      id,
      subject,
      participants: [...new Set(messages.map((m) => m.from))],
      lastDate: messages.reduce((d, m) => (m.date > d ? m.date : d), ''),
      count: messages.length,
      snippet: decodeEntities(snippet),
      unread: messages.some((m) => m.unread),
      messages,
    }
  }

  // --- HTTP ---------------------------------------------------------------------------

  private async token(): Promise<string> {
    if (this.access && this.access.expiresAt - 60_000 > this.now()) return this.access.token
    const cfg = this.config()
    if (!cfg) throw new AppError('GMAIL_ERROR', undefined, 'Gmail no está conectado.')
    try {
      const fresh = await refreshAccess(cfg, cfg.refreshToken, this.http, {
        service: 'Gmail',
        tokenUrl: this.opts.tokenUrl ?? TOKEN_URL,
      })
      this.access = { token: fresh.accessToken, expiresAt: fresh.expiresAt }
      return fresh.accessToken
    } catch (e) {
      this.fail(e instanceof Error ? e.message : 'No se pudo renovar el acceso a Gmail.')
    }
  }

  private fail(message: string): never {
    this.error = message
    this.emit()
    throw new AppError('GMAIL_ERROR', undefined, message)
  }

  /** GET a la API de Gmail: renueva el token una vez si caduca y traduce los errores. */
  private async get(path: string, retried = false): Promise<unknown> {
    const token = await this.token()
    let res: Response
    try {
      res = await this.http(`${this.api}${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      })
    } catch {
      throw new AppError('GMAIL_ERROR', undefined, 'Sin conexión con Gmail.')
    }
    if (res.status === 401 && !retried) {
      this.access = null
      return this.get(path, true)
    }
    if (res.ok) return res.json()
    const body = (await res.json().catch(() => ({}))) as {
      error?: { errors?: { reason?: string }[]; message?: string }
    }
    const reason = body.error?.errors?.[0]?.reason ?? ''
    if (res.status === 429 || /rateLimitExceeded|dailyLimitExceeded/i.test(reason))
      throw new AppError(
        'GMAIL_ERROR',
        undefined,
        'Gmail pide esperar un poco (límite de uso). Vuelve a intentarlo en un minuto.',
      )
    if (res.status === 403 && /accessNotConfigured|SERVICE_DISABLED/i.test(JSON.stringify(body)))
      this.fail('Activa la API de Gmail en tu proyecto de Google Cloud (Ajustes lo explica).')
    if (res.status === 401 || res.status === 403)
      this.fail('Gmail ha rechazado el acceso: vuelve a conectar Gmail en Ajustes.')
    throw new AppError(
      'GMAIL_ERROR',
      undefined,
      `Gmail ha respondido con un error (${res.status}).`,
    )
  }
}

/** Los extractos de Gmail vienen con entidades HTML («&#39;», «&amp;»…). */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}
