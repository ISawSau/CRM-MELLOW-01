import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigStore } from '../../src/main/config'
import { tempDir } from './helpers'

describe('configuración mínima fuera de la bóveda', () => {
  it('la animación de la pantalla de contraseña es aleatoria por defecto (D-119)', () => {
    const dir = tempDir()
    expect(new ConfigStore(dir).get().lockAnimation).toBe('aleatoria')
    // Hasta la 0.16.9 se guardaba «gravedad» sin que nadie la eligiera: pasa a aleatoria.
    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ lastVaultPath: '/b', locale: 'es', lockAnimation: 'gravedad' }),
    )
    const old = new ConfigStore(dir)
    expect(old.get()).toMatchObject({ lastVaultPath: '/b', lockAnimation: 'aleatoria' })
    // La que elige el usuario en Ajustes se respeta al volver a abrir.
    old.setLockAnimation('ojo')
    expect(new ConfigStore(dir).get().lockAnimation).toBe('ojo')
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toMatchObject({
      lockAnimation: 'ojo',
      lockAnimationChosen: true,
    })
  })
})
