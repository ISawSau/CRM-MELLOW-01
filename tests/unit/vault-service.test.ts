import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { closeDb, openEncryptedDb, rekeyDb } from '../../src/main/db/connection'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { deriveSubkey, generateMasterKey } from '../../src/main/vault/crypto'
import { acquireLock } from '../../src/main/vault/lock'
import { readManifest, writeManifest } from '../../src/main/vault/vault-file'
import { VaultService } from '../../src/main/vault/vault-service'
import { TEST_KDF, tempDir } from './helpers'

const PASSWORD = 'una contraseña de prueba'

function service(extra: ConstructorParameters<typeof VaultService>[0] = {}) {
  return new VaultService({ kdf: TEST_KDF, hostname: 'equipo-test', ...extra })
}

async function newVault(svc = service()) {
  const parent = tempDir()
  const { recoveryKey, status } = await svc.create(parent, 'Mi bóveda', PASSWORD)
  return { svc, path: status.path!, recoveryKey }
}

const expectCode = (code: string) => expect.objectContaining({ code })

describe('crear bóveda', () => {
  it('crea la estructura de SPEC §3 y queda desbloqueada', async () => {
    const { svc, path } = await newVault()
    expect(svc.status()).toMatchObject({ state: 'unlocked', name: 'Mi bóveda' })
    for (const f of ['vault.json', 'crm.db', 'files', 'thumbs', 'backups', '.lock']) {
      expect(existsSync(join(path, f)), f).toBe(true)
    }
    const manifest = readManifest(path)
    expect(manifest.schemaVersion).toBe(MIGRATIONS.length)
    svc.dispose()
  })

  it('la base de datos está cifrada en disco', async () => {
    const { svc, path } = await newVault()
    svc.setAutoLockMinutes(42)
    svc.dispose()
    const raw = readFileSync(join(path, 'crm.db'))
    expect(raw.subarray(0, 16).toString('latin1')).not.toContain('SQLite format')
    expect(raw.includes(Buffer.from('security.autoLockMinutes'))).toBe(false)
  })

  it('vault.json no contiene la contraseña ni la clave en claro', async () => {
    const { svc, path, recoveryKey } = await newVault()
    svc.dispose()
    const text = readFileSync(join(path, 'vault.json'), 'utf8')
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain(recoveryKey.replace(/-/g, ''))
  })

  it('no crea una bóveda sobre otra ni en una carpeta con archivos', async () => {
    const { svc, path } = await newVault()
    svc.dispose()
    const parent = join(path, '..')
    await expect(service().create(parent, 'Mi bóveda', PASSWORD)).rejects.toThrowError(
      expectCode('VAULT_EXISTS'),
    )
    const busy = tempDir()
    writeFileSync(join(busy, 'algo.txt'), 'x')
    await expect(service().create(dirname(busy), basename(busy), PASSWORD)).rejects.toThrowError(
      expectCode('FOLDER_NOT_EMPTY'),
    )
  })
})

describe('bloquear y desbloquear', () => {
  it('al bloquear cierra la base de datos sin -wal ni -shm y libera el lock', async () => {
    const { svc, path } = await newVault()
    svc.setAutoLockMinutes(5)
    expect(svc.lock().state).toBe('locked')
    const files = readdirSync(path)
    expect(files).not.toContain('crm.db-wal')
    expect(files).not.toContain('crm.db-shm')
    expect(files).not.toContain('.lock')
  })

  it('desbloquea con la contraseña y conserva los datos', async () => {
    const { svc } = await newVault()
    svc.setAutoLockMinutes(7)
    svc.lock()
    const status = await svc.unlock(PASSWORD)
    expect(status).toMatchObject({ state: 'unlocked', autoLockMinutes: 7 })
    svc.dispose()
  })

  it('rechaza una contraseña incorrecta', async () => {
    const { svc } = await newVault()
    svc.lock()
    await expect(svc.unlock('otra cosa')).rejects.toThrowError(expectCode('WRONG_PASSWORD'))
    expect(svc.status().state).toBe('locked')
  })

  it('se puede abrir desde otra instancia de la app (otro equipo)', async () => {
    const { svc, path } = await newVault()
    svc.dispose()
    const other = service({ hostname: 'otro-equipo' })
    expect(other.open(path).state).toBe('locked')
    expect((await other.unlock(PASSWORD)).state).toBe('unlocked')
    other.dispose()
  })

  it('avisa si está abierta en otro equipo y permite forzar', async () => {
    const { svc, path } = await newVault()
    const other = service({ hostname: 'otro-equipo' })
    other.open(path)
    await expect(other.unlock(PASSWORD)).rejects.toThrowError(expectCode('VAULT_LOCKED_ELSEWHERE'))
    svc.dispose()
    acquireLock(path, { instanceId: 'tercero', hostname: 'tercer-equipo' })
    expect((await other.unlock(PASSWORD, true)).state).toBe('unlocked')
    other.dispose()
  })

  it('se niega a abrir una bóveda con esquema más nuevo', async () => {
    const { svc, path } = await newVault()
    svc.dispose()
    const m = readManifest(path)
    writeManifest(path, { ...m, schemaVersion: m.schemaVersion + 1 })
    expect(() => service().open(path)).toThrowError(expectCode('VAULT_TOO_NEW'))
  })

  it('una carpeta cualquiera no es una bóveda', () => {
    expect(() => service().open(tempDir())).toThrowError(expectCode('NOT_A_VAULT'))
  })
})

describe('apariencia', () => {
  it('por defecto: tema oscuro y densidad compacta', async () => {
    const { svc } = await newVault()
    expect(svc.status().appearance).toEqual({ theme: 'oscuro', density: 'compacta' })
    svc.dispose()
  })

  it('se guarda dentro de la bóveda y sobrevive al bloqueo', async () => {
    const { svc } = await newVault()
    svc.setAppearance({ theme: 'claro', density: 'comoda' })
    svc.lock()
    expect(svc.status().appearance).toBeNull()
    expect((await svc.unlock(PASSWORD)).appearance).toEqual({ theme: 'claro', density: 'comoda' })
    svc.dispose()
  })
})

describe('recuperación y cambio de contraseña', () => {
  it('la clave de recuperación permite poner una contraseña nueva', async () => {
    const { svc, recoveryKey } = await newVault()
    svc.lock()
    await svc.recover(recoveryKey.toLowerCase(), 'contraseña nueva 123')
    svc.lock()
    await expect(svc.unlock(PASSWORD)).rejects.toThrowError(expectCode('WRONG_PASSWORD'))
    expect((await svc.unlock('contraseña nueva 123')).state).toBe('unlocked')
    svc.dispose()
  })

  it('rechaza una clave de recuperación incorrecta', async () => {
    const { svc } = await newVault()
    svc.lock()
    await expect(
      svc.recover('0000-0000-0000-0000-0000-0000-0000-0000', 'nueva clave'),
    ).rejects.toThrowError(expectCode('WRONG_RECOVERY_KEY'))
  })

  it('cambiar la contraseña exige la actual y no toca crm.db', async () => {
    const { svc, path } = await newVault()
    await expect(svc.changePassword('mal', 'nueva contraseña')).rejects.toThrowError(
      expectCode('WRONG_PASSWORD'),
    )
    svc.lock()
    const before = readFileSync(join(path, 'crm.db'))
    await svc.unlock(PASSWORD)
    await svc.changePassword(PASSWORD, 'nueva contraseña')
    svc.lock()
    expect(readFileSync(join(path, 'crm.db')).equals(before)).toBe(true)
    expect((await svc.unlock('nueva contraseña')).state).toBe('unlocked')
    svc.dispose()
  })
})

describe('rotar la clave maestra', () => {
  it('re-cifra la base de datos, invalida la clave de recuperación anterior y hace copia', async () => {
    const { svc, path, recoveryKey } = await newVault()
    svc.setAutoLockMinutes(9)
    svc.lock()
    const before = readFileSync(join(path, 'crm.db'))
    await svc.unlock(PASSWORD)
    const { recoveryKey: newRecovery } = await svc.rotateKey(PASSWORD)
    expect(newRecovery).not.toBe(recoveryKey)
    svc.lock()
    expect(
      readFileSync(join(path, 'crm.db')).subarray(0, 4096).equals(before.subarray(0, 4096)),
    ).toBe(false)
    expect(readManifest(path).keyGeneration).toBe(2)
    expect(readdirSync(join(path, 'backups')).some((d) => d.includes('antes-de-rotar-clave'))).toBe(
      true,
    )

    await expect(svc.recover(recoveryKey, 'x'.repeat(10))).rejects.toThrowError(
      expectCode('WRONG_RECOVERY_KEY'),
    )
    expect((await svc.unlock(PASSWORD)).autoLockMinutes).toBe(9)
    svc.lock()
    await svc.recover(newRecovery, 'otra contraseña')
    svc.dispose()
  })

  it('completa una rotación interrumpida entre el re-cifrado y el cambio de manifiesto', async () => {
    const { svc, path } = await newVault()
    svc.setAutoLockMinutes(11)
    await svc.rotateKey(PASSWORD)
    svc.dispose()
    // Simula el corte: el manifiesto nuevo sigue como pendiente y vault.json es el viejo.
    const backup = readdirSync(join(path, 'backups')).find((d) => d.includes('rotar'))!
    renameSync(join(path, 'vault.json'), join(path, 'vault.json.pending'))
    writeFileSync(
      join(path, 'vault.json'),
      readFileSync(join(path, 'backups', backup, 'vault.json')),
    )

    const again = service()
    again.open(path)
    expect((await again.unlock(PASSWORD)).autoLockMinutes).toBe(11)
    expect(existsSync(join(path, 'vault.json.pending'))).toBe(false)
    expect(readManifest(path).keyGeneration).toBe(2)
    again.dispose()
  })

  it('descarta un manifiesto pendiente si la rotación no llegó a re-cifrar', async () => {
    const { svc, path } = await newVault()
    svc.dispose()
    writeFileSync(join(path, 'vault.json.pending'), readFileSync(join(path, 'vault.json')))
    const again = service()
    again.open(path)
    await again.unlock(PASSWORD)
    expect(existsSync(join(path, 'vault.json.pending'))).toBe(false)
    again.dispose()
  })
})

describe('motor de datos', () => {
  it('los registros sobreviven a bloquear, rotar la clave y volver a abrir', async () => {
    const { svc, path } = await newVault()
    const titulo = svc.data.listFields('nota').find((f) => f.key === 'titulo')!
    const r = svc.data.create('nota', { [titulo.id]: 'Reunión con el cliente' })
    await svc.rotateKey(PASSWORD)
    svc.lock()
    expect(() => svc.data).toThrowError(expectCode('VAULT_IS_LOCKED'))
    await svc.unlock(PASSWORD)
    expect(svc.data.get(r.id).title).toBe('Reunión con el cliente')
    expect(svc.data.search('reunion').map((h) => h.id)).toEqual([r.id])
    // Deshacer no sobrevive al bloqueo: es solo de la sesión.
    expect(svc.data.undoState().canUndo).toBe(false)
    svc.dispose()
    const raw = readFileSync(join(path, 'crm.db'))
    expect(raw.includes(Buffer.from('cliente'))).toBe(false)
  })
})

describe('migraciones', () => {
  it('una bóveda de la v0.1 se actualiza con copia de seguridad y conserva sus ajustes', async () => {
    const old = service({ migrations: MIGRATIONS.slice(0, 1), data: false })
    const { path } = await newVault(old)
    old.setAutoLockMinutes(7)
    old.dispose()

    const svc = service()
    svc.open(path)
    expect((await svc.unlock(PASSWORD)).autoLockMinutes).toBe(7)
    const backups = readdirSync(join(path, 'backups'))
    expect(backups.some((d) => d.includes(`antes-de-migrar-v1-a-v${MIGRATIONS.length}`))).toBe(true)
    expect(svc.data.listFields('nota').length).toBeGreaterThan(0)
    expect(svc.data.create('nota').title).toBe('Sin título')
    svc.dispose()
  })

  it('hace copia de seguridad antes de migrar una base de datos con datos', async () => {
    const { svc, path } = await newVault()
    svc.setAutoLockMinutes(3)
    svc.dispose()
    const extra = [
      ...MIGRATIONS,
      {
        idx: MIGRATIONS.length,
        tag: 'test_nueva',
        sql: 'CREATE TABLE prueba (id INTEGER PRIMARY KEY)',
      },
    ]
    const newer = service({ migrations: extra })
    newer.open(path)
    await newer.unlock(PASSWORD)
    expect(readManifest(path).schemaVersion).toBe(extra.length)
    const backups = readdirSync(join(path, 'backups'))
    expect(backups.some((d) => d.includes('antes-de-migrar'))).toBe(true)
    newer.dispose()

    // La versión anterior de la app ya no puede abrirla.
    expect(() => service().open(path)).toThrowError(expectCode('VAULT_TOO_NEW'))
  })

  it('la copia de seguridad se abre con la contraseña de ese momento', async () => {
    const { svc, path } = await newVault()
    await svc.rotateKey(PASSWORD)
    svc.dispose()
    const backup = readdirSync(join(path, 'backups')).find((d) => d.includes('rotar'))!
    const fromBackup = service()
    fromBackup.open(join(path, 'backups', backup))
    expect((await fromBackup.unlock(PASSWORD)).state).toBe('unlocked')
    fromBackup.dispose()
  })
})

describe('conexión cifrada', () => {
  it('rekey cambia la clave efectiva', () => {
    const dir = tempDir()
    const k1 = deriveSubkey(generateMasterKey(), 'db/v1')
    const k2 = deriveSubkey(generateMasterKey(), 'db/v1')
    const file = join(dir, 'x.db')
    const db = openEncryptedDb(file, k1)
    db.exec('CREATE TABLE t (a)')
    rekeyDb(db, k2)
    closeDb(db)
    expect(() => openEncryptedDb(file, k1)).toThrowError(expectCode('WRONG_PASSWORD'))
    closeDb(openEncryptedDb(file, k2))
  })
})
