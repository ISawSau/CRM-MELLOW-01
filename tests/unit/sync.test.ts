import { cpSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  backupsToPrune,
  backupConfigSchema,
  parseBackupName,
  SyncService,
} from '../../src/main/sync/sync-service'
import { VaultService } from '../../src/main/vault/vault-service'
import { TEST_KDF, tempDir } from './helpers'

const PASSWORD = 'contraseña de prueba'

function device(path: string, hostname: string) {
  const vault = new VaultService({ kdf: TEST_KDF, hostname })
  vault.open(path)
  const sync = new SyncService(vault, { hostname, openBrowser: () => {} })
  return { vault, sync }
}

const nombre = (v: VaultService) => v.data.listFields('cliente').find((f) => f.key === 'nombre')!
const titles = (v: VaultService) =>
  v.data
    .query('cliente')
    .map((r) => r.title)
    .sort()

async function twoDevices() {
  const parent = tempDir()
  const creator = new VaultService({ kdf: TEST_KDF, hostname: 'portatil' })
  const { status } = await creator.create(parent, 'Boveda', PASSWORD)
  creator.dispose()
  // El otro equipo tiene una copia de la bóveda (p. ej. llevada en un USB).
  const copy = join(tempDir(), 'Boveda')
  cpSync(status.path!, copy, { recursive: true })
  const remote = tempDir()
  const a = device(status.path!, 'portatil')
  const b = device(copy, 'sobremesa')
  await a.vault.unlock(PASSWORD)
  await b.vault.unlock(PASSWORD)
  return { a, b, remote }
}

describe('sincronización entre dos equipos (carpeta compartida)', () => {
  it('sube, descarga, trae los archivos y resuelve un conflicto sin perder nada', async () => {
    const { a, b, remote } = await twoDevices()

    // A conecta el destino vacío y sube su bóveda.
    a.vault.data.create('cliente', { [nombre(a.vault).id]: 'Acme' })
    a.sync.configureFolder(remote)
    await a.sync.sync()
    expect(a.sync.status()).toMatchObject({ phase: 'idle', pending: false, kind: 'folder' })
    expect(existsSync(join(remote, 'sync.json'))).toBe(true)

    // B conecta el mismo destino: descarga lo de A.
    b.sync.configureFolder(remote)
    await b.sync.sync()
    expect(titles(b.vault)).toEqual(['Acme'])

    // A añade un cliente con un archivo y cierra: se sube todo.
    const file = a.vault.data.importBuffer('logo.png', Buffer.from('imagen del logo'))
    const adj = a.vault.data.createField('cliente', { label: 'Logo', type: 'files' })
    a.vault.data.create('cliente', { [nombre(a.vault).id]: 'Beta', [adj.id]: [file] })
    expect(a.sync.status().pending).toBe(true)
    await a.sync.beforeClose()
    expect(a.sync.status().pending).toBe(false)

    // B sincroniza: ve Beta y el archivo descifrado es idéntico.
    await b.sync.sync()
    expect(titles(b.vault)).toEqual(['Acme', 'Beta'])
    expect(b.vault.data.files.read(file.id).toString()).toBe('imagen del logo')

    // Conflicto: los dos cambian sin sincronizar entre medias.
    a.vault.data.create('cliente', { [nombre(a.vault).id]: 'Desde A' })
    await a.sync.sync()
    b.vault.data.create('cliente', { [nombre(b.vault).id]: 'Desde B' })
    await b.sync.sync()
    expect(b.sync.status()).toMatchObject({
      phase: 'conflict',
      conflict: { device: 'portatil' },
    })
    // B se queda con lo suyo; la versión de la nube queda como copia en B.
    await b.sync.resolve('local')
    expect(b.sync.status().phase).toBe('idle')
    const backups = readdirSync(join(b.vault.currentPath!, 'backups'))
    expect(backups.some((n) => n.endsWith('conflicto-nube'))).toBe(true)

    // A no tiene cambios: descarga la versión de B.
    await a.sync.sync()
    expect(titles(a.vault)).toEqual(['Acme', 'Beta', 'Desde B'])
    a.vault.dispose()
    b.vault.dispose()
  })

  it('elegir la versión de la nube guarda la de este equipo como copia', async () => {
    const { a, b, remote } = await twoDevices()
    a.sync.configureFolder(remote)
    await a.sync.sync()
    b.sync.configureFolder(remote)
    await b.sync.sync()
    a.vault.data.create('cliente', { [nombre(a.vault).id]: 'Nube' })
    await a.sync.sync()
    b.vault.data.create('cliente', { [nombre(b.vault).id]: 'Local' })
    await b.sync.sync()
    await b.sync.resolve('remote')
    expect(titles(b.vault)).toEqual(['Nube'])
    const backups = readdirSync(join(b.vault.currentPath!, 'backups'))
    expect(backups.some((n) => n.endsWith('antes-de-sincronizar'))).toBe(true)
    a.vault.dispose()
    b.vault.dispose()
  })

  it('rechaza un destino con otra bóveda o dentro de la propia bóveda', async () => {
    const { a, remote } = await twoDevices()
    const other = await twoDevices()
    other.a.sync.configureFolder(remote)
    await other.a.sync.sync()
    a.sync.configureFolder(remote)
    await a.sync.sync()
    expect(a.sync.status()).toMatchObject({ phase: 'error' })
    expect(a.sync.status().error).toMatch(/otra bóveda/)
    expect(() => a.sync.configureFolder(join(a.vault.currentPath!, 'files'))).toThrow(/fuera/)
    a.vault.dispose()
    other.a.vault.dispose()
    other.b.vault.dispose()
  })
})

describe('copias de seguridad', () => {
  it('crea la copia automática cada N días, también en el destino, y la restaura', async () => {
    const { a, remote } = await twoDevices()
    let now = new Date('2026-10-01T10:00:00Z')
    const sync = new SyncService(a.vault, {
      hostname: 'portatil',
      openBrowser: () => {},
      now: () => now,
    })
    sync.configureFolder(remote)
    const first = await sync.maybeBackup()
    expect(first).toMatch(/automatica$/)
    expect(await sync.maybeBackup()).toBeNull()
    now = new Date('2026-10-04T10:00:01Z')
    const name = (await sync.maybeBackup())!
    expect(existsSync(join(remote, 'backups', name, 'crm.db'))).toBe(true)
    const list = await sync.listBackups()
    expect(list.find((b) => b.name === name)).toMatchObject({ local: true, remote: true })

    // Restaurar devuelve la bóveda a ese momento (y se reabre: misma clave).
    a.vault.data.create('cliente', { [nombre(a.vault).id]: 'Después de la copia' })
    expect(await sync.restoreBackup(name)).toBe('reopened')
    expect(titles(a.vault)).toEqual([])
    // Lo actual quedó guardado antes de restaurar.
    expect((await sync.listBackups()).some((b) => b.reason === 'antes-de-restaurar')).toBe(true)
    a.vault.dispose()
  })

  it('retención: las 10 últimas más la última de cada mes', () => {
    const names = [
      ...Array.from(
        { length: 12 },
        (_, i) => `202610${String(i + 1).padStart(2, '0')}-100000-automatica`,
      ),
      '20260915-100000-automatica',
      '20260920-100000-automatica',
      '20260801-100000-automatica',
      '20260701-100000-antes-de-migrar-v3-a-v4',
    ]
    const cfg = backupConfigSchema.parse({})
    // Octubre: se quedan las 10 más recientes (03–12); la del mes ya es la del 12.
    // Septiembre: solo la última (20). Agosto: su única copia. Las de migración no se tocan.
    expect(backupsToPrune(names, cfg).sort()).toEqual([
      '20260915-100000-automatica',
      '20261001-100000-automatica',
      '20261002-100000-automatica',
    ])
    expect(parseBackupName('20261003-012345-automatica')).toEqual({
      date: '2026-10-03T01:23:45Z',
      reason: 'automatica',
    })
  })
})
