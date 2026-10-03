import { z } from 'zod'

/**
 * Gmail (SPEC §7.12, fase 10): hilos de correo en la ficha de cada cliente y contacto,
 * en solo lectura, con el mismo proyecto de Google que Drive.
 */

export interface GmailStatus {
  connected: boolean
  /** Cuenta conectada. */
  email: string | null
  /** Ya hay un id de cliente de Google (el de Drive) que se puede reutilizar. */
  hasClient: boolean
  error: string | null
}

export const gmailConnectSchema = z.object({
  /** Vacíos: se reutiliza el cliente de Google Drive. */
  clientId: z.string().trim().max(300).default(''),
  clientSecret: z.string().trim().max(300).default(''),
})

export const gmailThreadsSchema = z.object({
  recordId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  pageToken: z.string().max(200).nullable().default(null),
  /** Saltarse la caché (botón «Actualizar»). */
  refresh: z.boolean().default(false),
})

export interface GmailMessage {
  id: string
  from: string
  /** Fecha ISO (de internalDate). */
  date: string
  snippet: string
  unread: boolean
}

export interface GmailThread {
  id: string
  subject: string
  /** Nombres de quienes escriben, sin repetir, por orden de aparición. */
  participants: string[]
  lastDate: string
  count: number
  snippet: string
  unread: boolean
  messages: GmailMessage[]
}

export interface GmailThreadsResult {
  /** Direcciones que se han buscado (las del registro y, en un cliente, sus contactos). */
  addresses: string[]
  threads: GmailThread[]
  nextPageToken: string | null
}

/** Direcciones de correo válidas y sin repetir, en minúscula. */
export function normalizeAddresses(list: readonly unknown[]): string[] {
  const out = new Set<string>()
  for (const v of list) {
    if (typeof v !== 'string') continue
    const a = v.trim().toLowerCase()
    if (/^[^\s@{}()"]+@[^\s@{}()"]+\.[^\s@{}()"]+$/.test(a)) out.add(a)
  }
  return [...out]
}

/**
 * Búsqueda de Gmail con las direcciones en remitente, destinatario o copia. Las llaves
 * agrupan con O: «{from:a to:a cc:a}» (operadores de búsqueda oficiales de Gmail).
 */
export function threadQuery(addresses: readonly string[]): string {
  const terms = addresses.flatMap((a) => [`from:${a}`, `to:${a}`, `cc:${a}`])
  return `{${terms.join(' ')}}`
}

/** «Ana López <ana@acme.com>» → { name: 'Ana López', address: 'ana@acme.com' } */
export function parseMailbox(header: string): { name: string; address: string } {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(header)
  if (m) {
    const address = m[2]!.trim().toLowerCase()
    return { name: m[1]!.trim() || address, address }
  }
  const address = header.trim().toLowerCase()
  return { name: address, address }
}

/** Enlace al hilo en Gmail (se abre en el navegador del sistema). */
export function gmailThreadUrl(threadId: string, email: string | null): string {
  const user = email ? `?authuser=${encodeURIComponent(email)}` : ''
  return `https://mail.google.com/mail/u/0/${user}#all/${encodeURIComponent(threadId)}`
}
