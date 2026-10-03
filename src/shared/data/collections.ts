import { z } from 'zod'
import type { EntityDef } from './entities'

/**
 * Colecciones personalizadas (SPEC §6, fase 12): tablas que crea el usuario con los campos
 * que quiera. Funcionan sobre el mismo motor que las entidades de sistema (campos, vistas,
 * relaciones, fórmulas, papelera, historial y búsqueda). Su definición se guarda en la
 * bóveda; los registros, campos y vistas van a las mismas tablas que el resto.
 */
export const collectionIdSchema = z.string().regex(/^col-[a-z0-9-]{1,40}$/)

export const collectionInputSchema = z.object({
  /** Nombre en plural, el de la barra lateral: «Proveedores». */
  label: z.string().trim().min(1).max(40),
  /** En singular, para los botones: «Nuevo proveedor». */
  singular: z.string().trim().min(1).max(40),
  gender: z.enum(['f', 'm']),
  /** Letra de la barra lateral. */
  letter: z
    .string()
    .trim()
    .regex(/^[A-ZÑ0-9]$/u, 'La letra debe ser una sola letra o cifra.'),
})
export type CollectionInput = z.infer<typeof collectionInputSchema>

export const collectionSchema = collectionInputSchema.extend({
  id: collectionIdSchema,
  createdAt: z.string(),
})
export type Collection = z.infer<typeof collectionSchema>
export const collectionsSchema = z.array(collectionSchema).max(50)

/** Campos y vistas con los que nace una colección (el resto los añade el usuario). */
export function collectionEntity(c: Collection): EntityDef {
  return {
    id: c.id,
    label: c.label,
    singular: c.singular.toLowerCase(),
    gender: c.gender,
    titleKey: 'nombre',
    seedVersion: 1,
    fields: [
      { key: 'nombre', label: 'Nombre', type: 'text', system: true, required: true },
      { key: 'notas', label: 'Notas', type: 'longtext' },
    ],
    views: [
      { name: 'Todos', kind: 'table', config: { sorts: [{ fieldId: 'updatedAt', dir: 'desc' }] } },
    ],
  }
}

/** Id a partir del nombre: «Proveedores» → «col-proveedores». */
export function collectionIdFor(label: string, taken: (id: string) => boolean): string {
  const base =
    label
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'coleccion'
  let id = `col-${base}`
  for (let n = 2; taken(id); n++) id = `col-${base}-${n}`
  return id
}
