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
  photo: z
    .string()
    .max(MAX_PHOTO_CHARS)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Imagen no válida')
    .nullable()
    .default(null),
})
export type Profile = z.infer<typeof profileSchema>

export const DEFAULT_PROFILE: Profile = profileSchema.parse({})

/** Monedas que se ofrecen en los selectores (SPEC §10: lista final pendiente). */
export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'MXN', 'ARS', 'COP', 'CLP', 'PEN', 'BRL']
