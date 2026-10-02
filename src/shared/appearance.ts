import { z } from 'zod'

/**
 * Preferencias de apariencia. Se guardan dentro de la bóveda (son datos del usuario);
 * antes de desbloquear se usan los valores por defecto.
 *
 * `theme` es el id de un tema. Hoy existen los predefinidos ("oscuro", "claro");
 * más adelante el usuario podrá crear los suyos desde la app (SPEC §7.14).
 */
export const DENSITIES = ['compacta', 'comoda'] as const
export type Density = (typeof DENSITIES)[number]

export const themeIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/)

export const appearanceSchema = z.object({
  theme: themeIdSchema,
  density: z.enum(DENSITIES),
})
export type Appearance = z.infer<typeof appearanceSchema>

export const DEFAULT_APPEARANCE: Appearance = { theme: 'oscuro', density: 'compacta' }
