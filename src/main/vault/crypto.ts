import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { argon2id } from 'hash-wasm'

/**
 * Esquema de claves de la bóveda (ver docs/DECISIONS.md, D-005):
 *
 *   clave maestra (32 bytes aleatorios, solo en memoria mientras está desbloqueada)
 *     ├─ cifrada con KEK_contraseña  = Argon2id(contraseña, sal_1)   → ranura "password"
 *     └─ cifrada con KEK_recuperación = Argon2id(clave_recuperación, sal_2) → ranura "recovery"
 *
 *   clave de la base de datos = HKDF-SHA256(clave maestra, "crm-mellow/db/v1")
 *
 * Las ranuras se cifran con AES-256-GCM y llevan como datos asociados el id de la
 * bóveda y el nombre de la ranura, para que no se puedan intercambiar entre bóvedas.
 */

export interface KdfParams {
  algorithm: 'argon2id'
  version: 19
  memoryKiB: number
  iterations: number
  parallelism: number
}

/** ~1 s en un portátil moderno. Se guardan en vault.json, así que se pueden subir en el futuro. */
export const DEFAULT_KDF: KdfParams = {
  algorithm: 'argon2id',
  version: 19,
  memoryKiB: 128 * 1024,
  iterations: 3,
  parallelism: 1,
}

export const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12

export interface WrappedKey {
  salt: string
  iv: string
  ciphertext: string
  tag: string
}

/** Normaliza a NFC para que "ñ" escrita en Windows y en Linux derive la misma clave. */
function normalizeSecret(secret: string): string {
  return secret.normalize('NFC')
}

export async function deriveKek(secret: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  const out = await argon2id({
    password: normalizeSecret(secret),
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    hashLength: KEY_BYTES,
    outputType: 'binary',
  })
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength)
}

export function generateMasterKey(): Buffer {
  return randomBytes(KEY_BYTES)
}

export async function wrapMasterKey(
  masterKey: Buffer,
  secret: string,
  params: KdfParams,
  aad: string,
): Promise<WrappedKey> {
  const salt = randomBytes(SALT_BYTES)
  const kek = await deriveKek(secret, salt, params)
  try {
    const iv = randomBytes(IV_BYTES)
    const cipher = createCipheriv('aes-256-gcm', kek, iv)
    cipher.setAAD(Buffer.from(aad, 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(masterKey), cipher.final()])
    return {
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    }
  } finally {
    zeroize(kek)
  }
}

/** Devuelve la clave maestra, o null si el secreto no es correcto. */
export async function unwrapMasterKey(
  wrapped: WrappedKey,
  secret: string,
  params: KdfParams,
  aad: string,
): Promise<Buffer | null> {
  const kek = await deriveKek(secret, Buffer.from(wrapped.salt, 'base64'), params)
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(wrapped.iv, 'base64'))
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(Buffer.from(wrapped.tag, 'base64'))
    const key = Buffer.concat([
      decipher.update(Buffer.from(wrapped.ciphertext, 'base64')),
      decipher.final(),
    ])
    return key.length === KEY_BYTES ? key : null
  } catch {
    return null
  } finally {
    zeroize(kek)
  }
}

/** Subclave para un uso concreto (base de datos, archivos…). */
export function deriveSubkey(masterKey: Buffer, purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), `crm-mellow/${purpose}`, 32))
}

export function zeroize(buf: Buffer | null | undefined): void {
  if (buf) buf.fill(0)
}

export function keysEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b)
}

// --- Clave de recuperación -------------------------------------------------------
//
// 20 bytes aleatorios (160 bits) en base32 de Crockford: 32 caracteres en 8 grupos
// de 4 (p. ej. "7K2M-QX9D-…"). Sin letras ambiguas (I, L, O, U); al escribirla se
// aceptan minúsculas, espacios y guiones, y se corrigen I/L→1 y O→0.

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RECOVERY_BYTES = 20

export function generateRecoveryKey(): string {
  const bytes = randomBytes(RECOVERY_BYTES)
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  zeroize(bytes)
  return out.match(/.{4}/g)!.join('-')
}

/** Forma canónica (32 caracteres sin guiones) o null si no tiene el formato correcto. */
export function normalizeRecoveryKey(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
  if (s.length !== 32) return null
  for (const ch of s) if (!CROCKFORD.includes(ch)) return null
  return s
}
