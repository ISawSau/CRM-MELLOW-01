import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { z } from 'zod'
import type { PackRow } from './changes'

/**
 * Paquete de cambios de un equipo (D-125): filas cambiadas, comprimidas y cifradas con
 * AES-256-GCM. La clave sale de la de los archivos de la bóveda, la misma en todos los
 * equipos y que no cambia al rotar la clave maestra. El nombre del paquete va como datos
 * asociados: no se puede hacer pasar un paquete por otro.
 */
const MAGIC = Buffer.from('CRMPACK1')
/** Un paquete descomprimido nunca debería pasar de esto (miles de filas). */
const MAX_INFLATED = 256 * 1024 * 1024

export const packSchema = z.object({
  format: z.literal('crm-mellow-pack'),
  version: z.literal(1),
  epoch: z.string(),
  device: z.string(),
  seq: z.number().int().min(1),
  createdAt: z.string(),
  /** Migraciones de la base de datos del equipo que lo hizo. */
  schema: z.number().int().min(0),
  rows: z.array(z.custom<PackRow>((r) => typeof r === 'object' && r !== null)),
  /** vault.json nuevo (cambio de contraseña o de clave de recuperación). */
  manifest: z.string().optional(),
  /** Solo en los cambios pendientes guardados aquí: los ajustes propios de este equipo. */
  local: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  /** Solo ahí: todo lo que había en este equipo, para juntarlo (D-126). */
  merge: z.array(z.custom<PackRow>((r) => typeof r === 'object' && r !== null)).optional(),
})
export type Pack = z.infer<typeof packSchema>

export function sealPack(pack: Pack, key: Buffer, name: string): Buffer {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  c.setAAD(Buffer.from(name))
  const body = Buffer.concat([
    c.update(deflateRawSync(Buffer.from(JSON.stringify(pack)))),
    c.final(),
  ])
  return Buffer.concat([MAGIC, iv, body, c.getAuthTag()])
}

export function openPack(data: Buffer, key: Buffer, name: string): Pack {
  if (data.length < MAGIC.length + 28 || !data.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error('Paquete de sincronización no válido')
  const iv = data.subarray(MAGIC.length, MAGIC.length + 12)
  const tag = data.subarray(data.length - 16)
  const d = createDecipheriv('aes-256-gcm', key, iv)
  d.setAAD(Buffer.from(name))
  d.setAuthTag(tag)
  const raw = Buffer.concat([
    d.update(data.subarray(MAGIC.length + 12, data.length - 16)),
    d.final(),
  ])
  return packSchema.parse(
    JSON.parse(inflateRawSync(raw, { maxOutputLength: MAX_INFLATED }).toString('utf8')),
  )
}
