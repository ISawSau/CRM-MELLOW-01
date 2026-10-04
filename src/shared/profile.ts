import { z } from 'zod'
import { DEFAULT_TIME_ZONE } from './format'

/** Perfil del usuario (SPEC §7.1): datos propios, fiscales y preferencias regionales. */

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('es-ES', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const text = (max: number) => z.string().trim().max(max).default('')

/**
 * Redes sociales del perfil (D-095). Se guarda lo que escribe el usuario: el enlace completo
 * o solo el usuario («@yellowmellow»), y la app arma el enlace con `url`. Las que no tienen
 * `url` solo admiten el enlace completo.
 */
export const SOCIAL_NETWORKS = [
  { id: 'instagram', label: 'Instagram', url: 'https://www.instagram.com/' },
  { id: 'tiktok', label: 'TikTok', url: 'https://www.tiktok.com/@' },
  { id: 'x', label: 'X', url: 'https://x.com/' },
  { id: 'linkedin', label: 'LinkedIn', url: 'https://www.linkedin.com/in/' },
  { id: 'facebook', label: 'Facebook', url: 'https://www.facebook.com/' },
  { id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/@' },
  { id: 'threads', label: 'Threads', url: 'https://www.threads.net/@' },
  { id: 'bluesky', label: 'Bluesky', url: 'https://bsky.app/profile/' },
  { id: 'github', label: 'GitHub', url: 'https://github.com/' },
  { id: 'behance', label: 'Behance', url: 'https://www.behance.net/' },
  { id: 'dribbble', label: 'Dribbble', url: 'https://dribbble.com/' },
  { id: 'pinterest', label: 'Pinterest', url: 'https://www.pinterest.com/' },
  { id: 'twitch', label: 'Twitch', url: 'https://www.twitch.tv/' },
  { id: 'medium', label: 'Medium', url: 'https://medium.com/@' },
  { id: 'telegram', label: 'Telegram', url: 'https://t.me/' },
  { id: 'whatsapp', label: 'WhatsApp', url: 'https://wa.me/' },
  { id: 'discord', label: 'Discord', url: null },
] as const
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]['id']
const SOCIAL_IDS = SOCIAL_NETWORKS.map((n) => n.id) as [SocialNetwork, ...SocialNetwork[]]

const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

/** Enlace de una red a partir de lo escrito; null si no se puede armar. */
export function socialUrl(id: SocialNetwork, value: string): string | null {
  const v = value.trim()
  if (!v) return null
  if (/^https?:\/\//i.test(v)) return isHttpUrl(v) ? v : null
  const net = SOCIAL_NETWORKS.find((n) => n.id === id)
  if (!net?.url) return null
  if (id === 'whatsapp') {
    const digits = v.replace(/[^\d]/g, '')
    return digits.length >= 6 ? net.url + digits : null
  }
  const handle = v.replace(/^@/, '')
  return /^[\w.-]{1,100}$/.test(handle) ? net.url + handle : null
}

const socialsSchema = z
  .partialRecord(z.enum(SOCIAL_IDS), z.string().trim().max(300))
  .default({})
  .superRefine((r, ctx) => {
    for (const [id, v] of Object.entries(r))
      if (v && !socialUrl(id as SocialNetwork, v))
        ctx.addIssue({ code: 'custom', path: [id], message: 'Enlace o usuario no válido' })
  })

/** Clientes destacados del perfil (como los repositorios fijados de GitHub). */
export const MAX_PINNED_CLIENTS = 6

/** Foto pequeña (la app la reduce a 256 px antes de guardarla). */
const MAX_PHOTO_CHARS = 400_000

export const profileSchema = z.object({
  name: text(120),
  company: text(160),
  nif: text(40),
  address: text(300),
  email: z.union([z.literal(''), z.email().max(320)]).default(''),
  phone: text(40),
  iban: text(40),
  website: z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(2000)]).default(''),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('EUR'),
  timeZone: z
    .string()
    .max(64)
    .refine(isTimeZone, 'Zona horaria no válida')
    .default(DEFAULT_TIME_ZONE),
  /** Cargo o a qué te dedicas («Media buyer»). */
  role: text(120),
  location: text(120),
  bio: text(500),
  socials: socialsSchema,
  pinned: z
    .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
    .max(MAX_PINNED_CLIENTS)
    .default([]),
  /** Se ha pasado por la configuración inicial (o se ha saltado). */
  setupDone: z.boolean().default(false),
  photo: z
    .string()
    .max(MAX_PHOTO_CHARS)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Imagen no válida')
    .nullable()
    .default(null),
})
export type Profile = z.infer<typeof profileSchema>

export const DEFAULT_PROFILE: Profile = profileSchema.parse({})

/** El perfil ya está configurado: se pasó por el asistente o tiene nombre (versiones anteriores). */
export const profileReady = (p: Profile) => p.setupDone || p.name !== ''

/** Monedas que se ofrecen en los selectores (SPEC §10: lista final pendiente). */
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'BRL']
