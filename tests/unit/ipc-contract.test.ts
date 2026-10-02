import { describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '../../src/shared/channels'
import { ipcSchemas, MIN_PASSWORD_LENGTH, vaultNameSchema } from '../../src/shared/ipc'

describe('contrato IPC', () => {
  it('la lista blanca del preload coincide exactamente con los esquemas', () => {
    expect([...IPC_CHANNELS].sort()).toEqual(Object.keys(ipcSchemas).sort())
  })

  it('rechaza nombres de carpeta que escapan de la carpeta elegida', () => {
    for (const bad of ['..', '.', 'a/b', 'a\\b', 'C:', 'con\u0000', '']) {
      expect(vaultNameSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
    expect(vaultNameSchema.safeParse('Mi bóveda').success).toBe(true)
  })

  it('exige la longitud mínima de contraseña al crear', () => {
    const r = ipcSchemas['vault:create'].safeParse({
      parentPath: '/tmp',
      name: 'x',
      password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1),
    })
    expect(r.success).toBe(false)
  })
})
