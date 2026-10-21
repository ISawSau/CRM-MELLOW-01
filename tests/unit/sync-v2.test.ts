import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BOOK_ENTITY } from '@shared/books'
import { BooksService } from '../../src/main/books/books-service'
import { SyncService, type SyncServiceOptions } from '../../src/main/sync/sync-service'
import { VaultService } from '../../src/main/vault/vault-service'
import { TEST_KDF, tempDir } from './helpers'

/**
 * Sincronización por cambios (D-125): cada equipo sube solo lo que cambia y baja solo lo
 * nuevo; dos equipos que cambian cosas a la vez se juntan sin avisos; en la misma fila gana
 * el último cambio; un equipo que llega tarde se pone al día sin perder lo suyo.
 */
const PASSWORD = 'contraseña de prueba'
const vaults: VaultService[] = []
afterEach(() => {
  for (const v of vaults.splice(0)) v.dispose()
})

interface Device {
  vault: VaultService
  sync: SyncService
  name: string
}

async function devices(names: string[], opts: Partial<SyncServiceOptions> = {}) {
  const creator = new VaultService({ kdf: TEST_KDF, hostname: 'creador' })
  const { status } = await creator.create(tempDir(), 'Boveda', PASSWORD)
  creator.dispose()
  const remote = tempDir()
  const out: Device[] = []
  for (const name of names) {
    // Cada equipo, con su copia de la bóveda (como llevada en un USB).
    const path = join(tempDir(), 'Boveda')
    cpSync(status.path!, path, { recursive: true })
    const vault = new VaultService({ kdf: TEST_KDF, hostname: name })
    vault.open(path)
    const sync = new SyncService(vault, { hostname: name, openBrowser: () => {}, ...opts })
    await vault.unlock(PASSWORD)
    vaults.push(vault)
    sync.configureFolder(remote)
    out.push({ vault, sync, name })
  }
  return { devs: out, remote }
}

const nombre = (v: VaultService) => v.data.listFields('cliente').find((f) => f.key === 'nombre')!
const titles = (v: VaultService) =>
  v.data
    .query('cliente')
    .map((r) => r.title)
    .sort()
const client = (d: Device, title: string) =>
  d.vault.data.create('cliente', { [nombre(d.vault).id]: title })
const packs = (remote: string) => {
  const dir = join(remote, 'changes')
  return existsSync(dir)
    ? readdirSync(dir).flatMap((e) => readdirSync(join(dir, e)).map((n) => `${e}/${n}`))
    : []
}

async function syncAll(devs: Device[]) {
  for (const d of devs) await d.sync.sync()
  for (const d of devs) await d.sync.sync()
  for (const d of devs) expect(d.sync.status(), d.name).toMatchObject({ phase: 'idle' })
}

describe('sincronización por cambios (D-125)', () => {
  it('dos equipos que cambian cosas a la vez se juntan sin avisos, y solo viajan los cambios', async () => {
    const { devs, remote } = await devices(['portatil', 'movil'])
    const [a, b] = devs as [Device, Device]
    client(a, 'Acme')
    await a.sync.sync()
    await b.sync.sync()
    expect(titles(b.vault)).toEqual(['Acme'])
    const snapshots = readdirSync(join(remote, 'snapshots'))
    expect(snapshots).toHaveLength(1)
    expect(existsSync(join(remote, 'crm.db'))).toBe(false)

    // Cada uno añade algo sin sincronizar entre medias.
    client(a, 'Desde A')
    client(b, 'Desde B')
    expect(a.sync.status().pending).toBe(true)
    await syncAll(devs)
    expect(titles(a.vault)).toEqual(['Acme', 'Desde A', 'Desde B'])
    expect(titles(b.vault)).toEqual(['Acme', 'Desde A', 'Desde B'])
    expect(a.sync.status()).toMatchObject({ pending: false, conflict: null })
    // No se ha vuelto a subir la base de datos entera: solo paquetes pequeños.
    expect(readdirSync(join(remote, 'snapshots'))).toEqual(snapshots)
    const sizes = packs(remote).map((p) => readFileSync(join(remote, 'changes', p)).length)
    expect(sizes.length).toBeGreaterThan(0)
    expect(Math.max(...sizes)).toBeLessThan(20_000)
    // Y la búsqueda del otro equipo ya los encuentra.
    expect(b.vault.data.search('Desde A').map((h) => h.title)).toContain('Desde A')
  })

  it('en la misma fila gana el último cambio; borrar también viaja', async () => {
    const { devs } = await devices(['portatil', 'movil'])
    const [a, b] = devs as [Device, Device]
    const r = client(a, 'Original')
    const gone = client(a, 'Se borra')
    await syncAll(devs)
    a.vault.data.update(r.id, { [nombre(a.vault).id]: 'Cambio de A' })
    await new Promise((res) => setTimeout(res, 5))
    b.vault.data.update(r.id, { [nombre(b.vault).id]: 'Cambio de B, después' })
    b.vault.data.trash([gone.id])
    b.vault.data.purge([gone.id])
    await syncAll(devs)
    expect(a.vault.data.get(r.id).title).toBe('Cambio de B, después')
    expect(b.vault.data.get(r.id).title).toBe('Cambio de B, después')
    expect(titles(a.vault)).toEqual(['Cambio de B, después'])
  })

  it('libros, archivos, progreso de lectura y campos nuevos llegan al otro equipo', async () => {
    const { devs } = await devices(['portatil', 'movil'])
    const [pc, phone] = devs as [Device, Device]
    const field = (v: VaultService, key: string) =>
      v.data.listFields(BOOK_ENTITY).find((f) => f.key === key)!.id
    const big = Buffer.from(`libro ${'x'.repeat(5000)}`)
    const file = pc.vault.data.importBuffer('grande.pdf', big)
    const book = pc.vault.data.create(
      BOOK_ENTITY,
      { [field(pc.vault, 'archivo')]: [file] },
      {
        title: 'Dune',
      },
    )
    const color = pc.vault.data.createField('cliente', { label: 'Color', type: 'text' })
    pc.vault.data.create('cliente', { [nombre(pc.vault).id]: 'Con color', [color.id]: 'azul' })
    await syncAll(devs)
    expect(phone.vault.data.files.read(file.id).equals(big)).toBe(true)
    expect(phone.vault.data.listFields('cliente').some((f) => f.label === 'Color')).toBe(true)

    // Leer en el móvil: el ordenador sabe por dónde va.
    const books = new BooksService(phone.vault)
    books.setProgress({
      recordId: book.id,
      location: '42',
      fraction: 0.4,
      page: 42,
      pages: 100,
      chapter: null,
    })
    await syncAll(devs)
    expect(new BooksService(pc.vault).progress(book.id)).toMatchObject({ page: 42, fraction: 0.4 })
  })

  it('lo de cada equipo no viaja: su destino y su estado', async () => {
    const { devs, remote } = await devices(['portatil', 'movil'])
    const [a, b] = devs as [Device, Device]
    client(a, 'Algo')
    await syncAll(devs)
    const state = (v: VaultService) =>
      JSON.parse(
        (
          v.sqlite.prepare("SELECT value FROM settings WHERE key = 'sync.v2'").get() as {
            value: string
          }
        ).value,
      ) as { device: string }
    expect(state(a.vault).device).not.toBe(state(b.vault).device)
    // Las dos copias tienen ids de equipo distintos (la carpeta es otra).
    const id = (v: VaultService) =>
      (JSON.parse(readFileSync(join(v.currentPath!, '.equipo.json'), 'utf8')) as { id: string }).id
    expect(id(a.vault)).not.toBe(id(b.vault))
    expect(b.sync.status().label).toBe(remote)
  })

  it('un equipo que lleva tiempo sin sincronizar se pone al día sin perder lo suyo', async () => {
    const { devs, remote } = await devices(['portatil', 'movil', 'tableta'], { compactPacks: 3 })
    const [a, b, c] = devs as [Device, Device, Device]
    client(a, 'Base')
    await syncAll(devs)
    // La tableta se queda sin conexión con un cambio sin subir.
    client(c, 'Hecho sin conexión')
    for (let i = 0; i < 12; i++) {
      client(i % 2 ? a : b, `Cliente ${i}`)
      await a.sync.sync()
      await b.sync.sync()
    }
    // Ha habido instantáneas nuevas y los paquetes viejos ya no están.
    const m = JSON.parse(readFileSync(join(remote, 'sync.json'), 'utf8')) as {
      previous: unknown
    }
    expect(m.previous).not.toBeNull()
    await c.sync.sync()
    expect(c.sync.status()).toMatchObject({ phase: 'idle' })
    expect(titles(c.vault)).toContain('Hecho sin conexión')
    expect(titles(c.vault)).toContain('Cliente 11')
    await a.sync.sync()
    expect(titles(a.vault)).toContain('Hecho sin conexión')
    expect(titles(a.vault)).toHaveLength(14)
  })

  it('cambiar la contraseña llega al otro equipo; rotar la clave empieza otra época', async () => {
    const { devs } = await devices(['portatil', 'movil'])
    const [a, b] = devs as [Device, Device]
    client(a, 'Antes')
    await syncAll(devs)
    await a.vault.changePassword(PASSWORD, 'contraseña nueva larga')
    await syncAll(devs)
    b.vault.lock()
    await b.vault.unlock('contraseña nueva larga')
    expect(titles(b.vault)).toEqual(['Antes'])

    // Rotar la clave maestra: la base de datos se vuelve a cifrar, el otro equipo la trae.
    client(b, 'De B antes de la rotación')
    await b.sync.sync()
    await a.vault.rotateKey('contraseña nueva larga')
    await a.sync.sync()
    client(b, 'De B sin subir')
    await b.sync.sync()
    // La nueva pide la contraseña (misma, clave maestra nueva): lo de B espera cifrado.
    if (b.vault.status().state !== 'unlocked') await b.vault.unlock('contraseña nueva larga')
    await b.sync.sync()
    await a.sync.sync()
    expect(titles(a.vault)).toEqual(['Antes', 'De B antes de la rotación', 'De B sin subir'])
    expect(titles(b.vault)).toEqual(['Antes', 'De B antes de la rotación', 'De B sin subir'])
  })

  it('restaurar una copia empieza otra época y el otro equipo la recibe', async () => {
    const { devs } = await devices(['portatil', 'movil'])
    const [a, b] = devs as [Device, Device]
    client(a, 'Bueno')
    await syncAll(devs)
    const backup = await a.sync.createBackup('manual')
    client(a, 'Error')
    await syncAll(devs)
    expect(titles(b.vault)).toEqual(['Bueno', 'Error'])
    await a.sync.restoreBackup(backup)
    await a.sync.sync()
    await b.sync.sync()
    expect(titles(b.vault)).toEqual(['Bueno'])
  })

  it('pasa del formato anterior: la nube con la base de datos entera se convierte sola', async () => {
    const { devs, remote } = await devices(['portatil', 'movil'])
    const [a, b] = devs as [Device, Device]
    // Nube en el formato 1, como la dejaba la 0.18 (A la subió, generación 1).
    client(a, 'De la 0.18')
    a.vault.sqlite.prepare("DELETE FROM settings WHERE key = 'sync.v2'").run()
    const { checkpoint } = await import('../../src/main/db/connection')
    checkpoint(a.vault.sqlite)
    cpSync(join(a.vault.currentPath!, 'crm.db'), join(remote, 'crm.db'))
    cpSync(join(a.vault.currentPath!, 'vault.json'), join(remote, 'vault.json'))
    writeFileSync(
      join(remote, 'sync.json'),
      JSON.stringify({
        format: 'crm-mellow-sync',
        version: 1,
        vaultId: a.vault.vaultId,
        generation: 1,
        device: 'portatil',
        uploadedAt: new Date().toISOString(),
      }),
    )
    const v1 = (v: VaultService, generation: number) =>
      v.sqlite
        .prepare(
          "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('sync.state', ?, '')",
        )
        .run(JSON.stringify({ generation, changeMark: 0, lastSyncAt: null }))
    v1(a.vault, 1)
    v1(b.vault, 0)
    await a.sync.sync()
    expect(JSON.parse(readFileSync(join(remote, 'sync.json'), 'utf8'))).toMatchObject({
      version: 2,
    })
    expect(existsSync(join(remote, 'crm.db'))).toBe(false)
    await b.sync.sync()
    expect(titles(b.vault)).toEqual(['De la 0.18'])
  })

  it('un paquete manipulado no se aplica', async () => {
    const { devs, remote } = await devices(['portatil', 'movil'])
    const [a, b] = devs as [Device, Device]
    await syncAll(devs)
    client(a, 'Legítimo')
    await a.sync.sync()
    const p = packs(remote).at(-1)!
    const file = join(remote, 'changes', p)
    const data = readFileSync(file)
    data[data.length - 20] = data[data.length - 20]! ^ 0xff
    writeFileSync(file, data)
    await b.sync.sync()
    expect(b.sync.status().phase).toBe('error')
    expect(titles(b.vault)).toEqual([])
  })

  it('los campos de serie tienen el mismo id en todos los equipos', async () => {
    const one = new VaultService({ kdf: TEST_KDF })
    const two = new VaultService({ kdf: TEST_KDF })
    await one.create(tempDir(), 'Uno', PASSWORD)
    await two.create(tempDir(), 'Dos', PASSWORD)
    vaults.push(one, two)
    expect(nombre(one).id).toBe(nombre(two).id)
    expect(one.data.listViews('cliente').map((v) => v.id)).toEqual(
      two.data.listViews('cliente').map((v) => v.id),
    )
  })

  it('sin destino no se apunta nada; lo de cada equipo (sus copias) no viaja', async () => {
    const solo = new VaultService({ kdf: TEST_KDF, hostname: 'solo' })
    await solo.create(tempDir(), 'Sola', PASSWORD)
    vaults.push(solo)
    new SyncService(solo, { hostname: 'solo', openBrowser: () => {} })
    solo.data.create('cliente', { [nombre(solo).id]: 'Sin destino' })
    const queued = (v: VaultService) =>
      (v.sqlite.prepare('SELECT COUNT(*) AS n FROM sync_outbox').get() as { n: number }).n
    expect(queued(solo)).toBe(0)

    const { devs } = await devices(['portatil', 'movil'])
    const [a, b] = devs as [Device, Device]
    await a.sync.createBackup('automatica')
    await syncAll(devs)
    const last = (v: VaultService) =>
      v.sqlite.prepare("SELECT value FROM settings WHERE key = 'backups.last'").get()
    expect(last(a.vault)).toBeTruthy()
    expect(last(b.vault)).toBeUndefined()
  })

  it('tras un cambio se sube sola; la automática no se ve ni da error sin red', async () => {
    const statuses: string[] = []
    const { devs } = await devices(['portatil', 'movil'], {
      changeDelayMs: 50,
      onChange: (s) => statuses.push(s.phase),
    })
    const [a, b] = devs as [Device, Device]
    await syncAll(devs)
    statuses.length = 0
    client(a, 'Solo')
    a.sync.notifyLocalChange()
    await expect.poll(() => a.sync.status().pending, { timeout: 5000 }).toBe(false)
    // Subirla no ha enseñado «sincronizando».
    expect(statuses).not.toContain('syncing')
    await b.sync.sync('auto')
    expect(titles(b.vault)).toEqual(['Solo'])
    // Sin acceso al destino en una automática: sigue como estaba, sin error.
    b.vault.sqlite
      .prepare("UPDATE settings SET value = ? WHERE key = 'sync.config'")
      .run(JSON.stringify({ kind: 'folder', path: '/no/existe/de/verdad' }))
    await b.sync.sync('auto')
    expect(b.sync.status().phase).not.toBe('syncing')
  })

  it('miles de filas (como las métricas de Meta) viajan en pocos paquetes y rápido', async () => {
    const { devs, remote } = await devices(['portatil', 'movil'])
    const [a, b] = devs as [Device, Device]
    await syncAll(devs)
    const insert = a.vault.sqlite.prepare(
      'INSERT INTO fx_rates (date, currency, rate) VALUES (?, ?, ?)',
    )
    a.vault.sqlite.transaction(() => {
      for (let i = 0; i < 20_000; i++)
        insert.run(`2026-${String((i % 12) + 1).padStart(2, '0')}-01`, `C${i}`, i / 10)
    })()
    const t0 = Date.now()
    await a.sync.sync()
    await b.sync.sync()
    expect(Date.now() - t0).toBeLessThan(15_000)
    const n = (b.vault.sqlite.prepare('SELECT COUNT(*) AS n FROM fx_rates').get() as { n: number })
      .n
    expect(n).toBeGreaterThanOrEqual(20_000)
    expect(packs(remote).length).toBeLessThanOrEqual(8)
  })
})

/**
 * Nada se pierde al cambiar de época (D-126): si otro equipo empieza una época nueva sin
 * haber bajado lo que este ya había subido (como al elegir «quedarme con la de este equipo»
 * o al pasar los dos a la vez del formato anterior), lo de este se junta con la nueva.
 */
describe('cambiar de época no pierde nada (D-126)', () => {
  type Internals = { remote(): unknown; newEpoch(remote: unknown): Promise<void> }
  /** Lo que hacía la 0.19.0 al resolver un conflicto con «la de este equipo». */
  const forceEpoch = async (d: Device) => {
    const s = d.sync as unknown as Internals
    await s.newEpoch(s.remote())
  }
  const bookField = (v: VaultService, key: string) =>
    v.data.listFields(BOOK_ENTITY).find((f) => f.key === key)!.id

  it('el libro y la lectura que el móvil ya había subido no se borran', async () => {
    const { devs } = await devices(['portatil', 'movil'])
    const [pc, phone] = devs as [Device, Device]
    const shared = pc.vault.data.create(BOOK_ENTITY, {}, { title: 'Compartido' })
    new BooksService(pc.vault).setProgress({
      recordId: shared.id,
      location: '10',
      fraction: 0.1,
      page: 10,
      pages: 100,
      chapter: null,
    })
    await syncAll(devs)

    // El móvil importa un libro, lee media hora y lo sube.
    const pdf = phone.vault.data.importBuffer('nuevo.pdf', Buffer.from('pdf del móvil'))
    const mine = phone.vault.data.create(
      BOOK_ENTITY,
      { [bookField(phone.vault, 'archivo')]: [pdf] },
      { title: 'Del móvil' },
    )
    await new Promise((res) => setTimeout(res, 5))
    const books = new BooksService(phone.vault)
    books.setProgress({
      recordId: shared.id,
      location: '80',
      fraction: 0.8,
      page: 80,
      pages: 100,
      chapter: null,
    })
    books.saveSession({
      id: 'rato-del-movil',
      recordId: shared.id,
      startedAt: new Date(Date.now() - 1_800_000).toISOString(),
      endedAt: new Date().toISOString(),
      seconds: 1800,
      fromFraction: 0.1,
      toFraction: 0.8,
      pages: 70,
    })
    await phone.sync.sync()

    // El ordenador, sin bajar eso, empieza otra época con lo suyo.
    client(pc, 'Del ordenador')
    await forceEpoch(pc)
    await phone.sync.sync()
    expect(phone.sync.status()).toMatchObject({ phase: 'idle', conflict: null })
    const titlesOf = (v: VaultService) =>
      v.data
        .query(BOOK_ENTITY)
        .map((r) => r.title)
        .sort()
    expect(titlesOf(phone.vault)).toEqual(['Compartido', 'Del móvil'])
    expect(books.progress(shared.id)).toMatchObject({ page: 80 })
    expect(titles(phone.vault)).toEqual(['Del ordenador'])

    // Y el ordenador lo recibe todo, también el archivo del libro.
    await pc.sync.sync()
    expect(titlesOf(pc.vault)).toEqual(['Compartido', 'Del móvil'])
    const pcBooks = new BooksService(pc.vault)
    expect(pcBooks.progress(shared.id)).toMatchObject({ page: 80, fraction: 0.8 })
    expect(
      pc.vault.sqlite
        .prepare("SELECT seconds FROM reading_sessions WHERE id = 'rato-del-movil'")
        .get(),
    ).toEqual({ seconds: 1800 })
    expect(pc.vault.data.files.read(pdf.id).toString()).toBe('pdf del móvil')
    expect(pc.vault.data.get(mine.id).title).toBe('Del móvil')
  })

  it('si los dos cambian lo mismo, gana lo editado más tarde', async () => {
    const { devs } = await devices(['portatil', 'movil'])
    const [pc, phone] = devs as [Device, Device]
    const r = client(pc, 'Original')
    await syncAll(devs)
    phone.vault.data.update(r.id, { [nombre(phone.vault).id]: 'Antes, en el móvil' })
    await phone.sync.sync()
    await new Promise((res) => setTimeout(res, 5))
    pc.vault.data.update(r.id, { [nombre(pc.vault).id]: 'Después, en el ordenador' })
    await forceEpoch(pc)
    await syncAll(devs)
    expect(pc.vault.data.get(r.id).title).toBe('Después, en el ordenador')
    expect(phone.vault.data.get(r.id).title).toBe('Después, en el ordenador')
  })

  it('ponerse al día en la misma época no resucita lo que otro borró', async () => {
    const { devs } = await devices(['portatil', 'movil', 'tableta'], { compactPacks: 3 })
    const [a, b, c] = devs as [Device, Device, Device]
    const gone = client(a, 'Se borra')
    client(a, 'Se queda')
    await syncAll(devs)
    client(c, 'Hecho sin conexión')
    a.vault.data.trash([gone.id])
    a.vault.data.purge([gone.id])
    for (let i = 0; i < 8; i++) {
      client(i % 2 ? a : b, `Cliente ${i}`)
      await a.sync.sync()
      await b.sync.sync()
    }
    await c.sync.sync()
    expect(titles(c.vault)).toContain('Hecho sin conexión')
    expect(titles(c.vault)).not.toContain('Se borra')
    await a.sync.sync()
    expect(titles(a.vault)).not.toContain('Se borra')
    expect(titles(a.vault)).toContain('Hecho sin conexión')
  })
})
