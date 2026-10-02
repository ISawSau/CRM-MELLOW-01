import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KDF,
  deriveSubkey,
  generateMasterKey,
  generateRecoveryKey,
  keysEqual,
  normalizeRecoveryKey,
  unwrapMasterKey,
  wrapMasterKey,
} from '../../src/main/vault/crypto'
import { TEST_KDF } from './helpers'

describe('ranuras de clave', () => {
  it('recupera la clave maestra con el secreto correcto', async () => {
    const key = generateMasterKey()
    const slot = await wrapMasterKey(key, 'contraseña larga', TEST_KDF, 'aad')
    const out = await unwrapMasterKey(slot, 'contraseña larga', TEST_KDF, 'aad')
    expect(out && keysEqual(out, key)).toBe(true)
  })

  it('devuelve null con un secreto incorrecto', async () => {
    const slot = await wrapMasterKey(generateMasterKey(), 'buena', TEST_KDF, 'aad')
    expect(await unwrapMasterKey(slot, 'mala', TEST_KDF, 'aad')).toBeNull()
  })

  it('devuelve null si la ranura se usa en otra bóveda (AAD distinto)', async () => {
    const slot = await wrapMasterKey(generateMasterKey(), 'buena', TEST_KDF, 'boveda-a')
    expect(await unwrapMasterKey(slot, 'buena', TEST_KDF, 'boveda-b')).toBeNull()
  })

  it('detecta una ranura manipulada', async () => {
    const slot = await wrapMasterKey(generateMasterKey(), 'buena', TEST_KDF, 'aad')
    const ct = Buffer.from(slot.ciphertext, 'base64')
    ct[0] = ct[0]! ^ 1
    const tampered = { ...slot, ciphertext: ct.toString('base64') }
    expect(await unwrapMasterKey(tampered, 'buena', TEST_KDF, 'aad')).toBeNull()
  })

  it('trata igual una "ñ" compuesta y descompuesta (Windows y Linux)', async () => {
    const key = generateMasterKey()
    const slot = await wrapMasterKey(key, 'contraseña', TEST_KDF, 'aad')
    const out = await unwrapMasterKey(slot, 'contraseña', TEST_KDF, 'aad')
    expect(out && keysEqual(out, key)).toBe(true)
  })

  it('usa sal aleatoria: dos ranuras del mismo secreto son distintas', async () => {
    const key = generateMasterKey()
    const a = await wrapMasterKey(key, 'x', TEST_KDF, 'aad')
    const b = await wrapMasterKey(key, 'x', TEST_KDF, 'aad')
    expect(a.salt).not.toBe(b.salt)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('los parámetros por defecto superan el mínimo de OWASP para Argon2id', () => {
    expect(DEFAULT_KDF.memoryKiB).toBeGreaterThanOrEqual(19 * 1024)
    expect(DEFAULT_KDF.iterations).toBeGreaterThanOrEqual(2)
  })
})

describe('subclaves', () => {
  it('son deterministas y distintas por uso', () => {
    const key = generateMasterKey()
    expect(keysEqual(deriveSubkey(key, 'db/v1'), deriveSubkey(key, 'db/v1'))).toBe(true)
    expect(keysEqual(deriveSubkey(key, 'db/v1'), deriveSubkey(key, 'files/v1'))).toBe(false)
  })
})

describe('clave de recuperación', () => {
  it('tiene 8 grupos de 4 caracteres sin letras ambiguas', () => {
    const k = generateRecoveryKey()
    expect(k).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
  })

  it('es distinta cada vez', () => {
    expect(generateRecoveryKey()).not.toBe(generateRecoveryKey())
  })

  it('acepta minúsculas, espacios y confusiones I/L/O', () => {
    const k = generateRecoveryKey()
    const canonical = k.replace(/-/g, '')
    const messy = k.toLowerCase().replace(/-/g, ' ').replace(/1/g, 'l').replace(/0/g, 'o')
    expect(normalizeRecoveryKey(messy)).toBe(canonical)
  })

  it('rechaza longitudes o caracteres incorrectos', () => {
    expect(normalizeRecoveryKey('ABCD')).toBeNull()
    expect(normalizeRecoveryKey('U'.repeat(32))).toBeNull()
  })
})
