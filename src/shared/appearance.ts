import { z } from 'zod'

/**
 * Preferencias de apariencia. Se guardan dentro de la bóveda (son datos del usuario);
 * antes de desbloquear se usan los valores por defecto.
 *
 * `theme` es el id de un tema: los predefinidos ("mellow", el de serie, y los clásicos
 * "oscuro" y "claro") o uno creado por el usuario (SPEC §7.14).
 */
export const DENSITIES = ['compacta', 'comoda'] as const
export type Density = (typeof DENSITIES)[number]

export const themeIdSchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/)

/** Iconos elegidos por sección (id de sección → nombre del icono). Vacío: los de serie. */
const sectionIconsSchema = z
  .record(z.string().regex(/^[a-z0-9-]{1,64}$/), z.string().regex(/^[a-z0-9-]{1,48}$/))
  .refine((r) => Object.keys(r).length <= 200, 'Demasiados iconos.')

/** Barra inferior del móvil (D-129): las secciones, en orden. Vacía: las de serie. */
export const MAX_MOBILE_TABS = 5
const mobileTabsSchema = z.array(z.string().regex(/^[a-z0-9-]{1,64}$/)).max(MAX_MOBILE_TABS)

export const appearanceSchema = z.object({
  theme: themeIdSchema,
  density: z.enum(DENSITIES),
  icons: sectionIconsSchema.default({}),
  tabs: mobileTabsSchema.default([]),
})
export type Appearance = z.infer<typeof appearanceSchema>

/** Cambios de apariencia: lo que no llega se queda como estaba. */
export const appearancePatchSchema = z.object({
  theme: themeIdSchema.optional(),
  density: z.enum(DENSITIES).optional(),
  icons: sectionIconsSchema.optional(),
  tabs: mobileTabsSchema.optional(),
})
export type AppearancePatch = z.infer<typeof appearancePatchSchema>

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'mellow',
  density: 'compacta',
  icons: {},
  tabs: [],
}
