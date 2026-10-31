import { randomBytes } from 'node:crypto'
import { cpSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BOOK_ENTITY } from '@shared/books'
import { BooksService } from '../../src/main/books/books-service'
import type { FetchLike } from '../../src/main/sync/remote'
import { SyncService, type SyncServiceOptions } from '../../src/main/sync/sync-service'
import { VaultService } from '../../src/main/vault/vault-service'
import { fakeDrive } from '../support/fake-drive'
import { GOOD_TOKEN } from './meta-fake'
import { setup as metaSetup } from './meta-setup'
import { TEST_KDF, tempDir } from './helpers'

/**
 * Cuánto mueve la sincronización (D-131), medido contra un Drive simulado: peticiones y
 * bytes que baja el móvil, paquetes que deja una hora leyendo y qué pasa con datos móviles.
 */
const PASSWORD = 'contraseña de prueba'
const FAST = { callTimeoutMs: 2000, chunkTimeoutMs: 2000, idleMs: 2000, retryDelaysMs: [1, 1] }
const client = { clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' }
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups.splice(0)) c()
})

/** Lo que pasa por la red de un equipo: peticiones, bytes bajados y peticiones a la vez. */
interface Meter {
  calls: number
  down: number
  /** Bytes subidos (cuerpos de las peticiones). */
  up: number
  inFlight: number
  maxInFlight: number
}

async function devices(names: string[], opts: (name: string) => Partial<SyncServiceOptions>) {
  const drive = fakeDrive()
  const creator = new VaultService({ kdf: TEST_KDF, hostname: 'creador' })
  const { status } = await creator.create(tempDir(), 'Boveda', PASSWORD)
  creator.dispose()
  const out: { name: string; vault: VaultService; sync: SyncService; meter: Meter }[] = []
  for (const name of names) {
    const path = join(tempDir(), 'Boveda')
    cpSync(status.path!, path, { recursive: true })
    const vault = new VaultService({ kdf: TEST_KDF, hostname: name })
    vault.open(path)
    await vault.unlock(PASSWORD)
    const meter: Meter = { calls: 0, down: 0, up: 0, inFlight: 0, maxInFlight: 0 }
    const http: FetchLike = async (input, init) => {
      if (String(input) === 'https://oauth2.googleapis.com/token')
        return new Response(
          JSON.stringify({ access_token: 'tok', refresh_token: 'renovar', expires_in: 3600 }),
        )
      meter.calls++
      const sent = init?.body
      if (typeof sent === 'string') meter.up += Buffer.byteLength(sent)
      else if (sent instanceof Uint8Array) meter.up += sent.byteLength
      meter.maxInFlight = Math.max(meter.maxInFlight, ++meter.inFlight)
      try {
        // Un poco de espera, como la red de un móvil.
        await new Promise((r) => setTimeout(r, 5))
        const res = await drive.http(input, init)
        const body = Buffer.from(await res.arrayBuffer())
        meter.down += body.length
        return new Response(res.status === 204 || res.status === 308 ? null : body, {
          status: res.status,
          headers: res.headers,
        })
      } finally {
        meter.inFlight--
      }
    }
    const openBrowser = (u: string) => {
      const url = new URL(u)
      void fetch(
        `${url.searchParams.get('redirect_uri')!}/?code=c&state=${url.searchParams.get('state')!}`,
      )
    }
    const sync = new SyncService(vault, {
      hostname: name,
      openBrowser,
      http,
      driveTiming: FAST,
      ...opts(name),
    })
    await sync.configureDrive(client)
    cleanups.push(() => {
      sync.dispose()
      vault.dispose()
    })
    out.push({ name, vault, sync, meter })
  }
  return { drive, devs: out }
}

const reset = (m: Meter) => Object.assign(m, { calls: 0, down: 0, up: 0, maxInFlight: 0 })
const packCount = (drive: ReturnType<typeof fakeDrive>) =>
  [...drive.files.values()].filter((f) => /^[\w.-]+-\d+\.bin$/.test(f.name)).length
const bookField = (v: VaultService) =>
  v.data.listFields(BOOK_ENTITY).find((f) => f.key === 'archivo')!.id

describe('cuánto mueve la sincronización (D-131)', () => {
  it('una hora leyendo deja pocos paquetes y el móvil los baja a la vez', async () => {
    const { drive, devs } = await devices(['portatil', 'movil'], () => ({
      changeDelayMs: 10,
      minPushGapMs: 400,
    }))
    const [pc, phone] = devs as [(typeof devs)[0], (typeof devs)[0]]
    const file = pc.vault.data.importBuffer('libro.epub', randomBytes(2000))
    const book = pc.vault.data.create(
      BOOK_ENTITY,
      { [bookField(pc.vault)]: [file] },
      {
        title: 'Dune',
      },
    )
    await pc.sync.sync()
    await phone.sync.sync()
    const before = packCount(drive)

    // Leer en el ordenador: una página cada 40 ms, 50 páginas (≈2 s, cinco «huecos»).
    const books = new BooksService(pc.vault)
    const t0 = Date.now()
    for (let page = 1; page <= 50; page++) {
      books.setProgress({
        recordId: book.id,
        location: String(page),
        fraction: page / 100,
        page,
        pages: 100,
        chapter: null,
      })
      pc.sync.notifyLocalChange()
      await new Promise((r) => setTimeout(r, 40))
    }
    const reading = Date.now() - t0
    await expect.poll(() => pc.sync.status().pending, { timeout: 15_000 }).toBe(false)
    const packs = packCount(drive) - before
    if (process.env['MEDIR']) console.log('MEDIDA paquetes', packs, 'en', reading, 'ms')
    // Antes, un paquete por página (50); ahora, uno por hueco de subida (más el último al
    // acabar). En un equipo lento el bucle dura más y caben más huecos.
    expect(packs).toBeGreaterThan(0)
    expect(packs).toBeLessThanOrEqual(Math.ceil(reading / 400) + 2)
    expect(packs).toBeLessThan(20)

    // El móvil se pone al día de una vez, con varias peticiones a la vez.
    reset(phone.meter)
    await phone.sync.sync()
    expect(new BooksService(phone.vault).progress(book.id)).toMatchObject({ page: 50 })
    if (process.env['MEDIR']) console.log('MEDIDA bajar', phone.meter)
    if (packs >= 3) expect(phone.meter.maxInFlight).toBeGreaterThanOrEqual(3)

    // Mirar si hay algo nuevo cuando no lo hay: pocas peticiones y casi nada que bajar.
    reset(phone.meter)
    await phone.sync.sync('auto')
    if (process.env['MEDIR']) console.log('MEDIDA mirar', phone.meter)
    expect(phone.meter.calls).toBeLessThanOrEqual(2)
    expect(phone.meter.down).toBeLessThan(4_000)
  })

  it('el temporizador junta las subidas: muchas páginas seguidas, una subida', async () => {
    const { drive, devs } = await devices(['portatil'], () => ({
      changeDelayMs: 10,
      minPushGapMs: 60_000,
    }))
    const [pc] = devs as [(typeof devs)[0]]
    const nombre = pc.vault.data.listFields('cliente').find((f) => f.key === 'nombre')!.id
    const r = pc.vault.data.create('cliente', { [nombre]: 'Uno' })
    await pc.sync.sync('auto')
    // Una subida recién hecha: lo siguiente espera al hueco.
    pc.vault.data.update(r.id, { [nombre]: 'Dos' })
    await pc.sync.sync()
    const before = packCount(drive)
    for (let i = 0; i < 10; i++) {
      pc.vault.data.update(r.id, { [nombre]: `Cambio ${i}` })
      pc.sync.notifyLocalChange()
      await new Promise((res) => setTimeout(res, 20))
    }
    // La comprobación de cada minuto baja pero no sube antes de tiempo.
    await pc.sync.sync('auto')
    expect(packCount(drive)).toBe(before)
    expect(pc.sync.status().pending).toBe(true)
    // Al cerrar o a mano, se sube al momento: una sola subida con todo.
    await pc.sync.sync()
    expect(packCount(drive)).toBe(before + 1)
    expect(pc.sync.status().pending).toBe(false)
  })

  it('con datos móviles solo viajan los cambios; el libro se baja al abrirlo', async () => {
    let metered = true
    const { devs } = await devices(['portatil', 'movil'], (name) =>
      name === 'movil' ? { metered: () => Promise.resolve(metered) } : {},
    )
    const [pc, phone] = devs as [(typeof devs)[0], (typeof devs)[0]]
    await pc.sync.sync()
    await phone.sync.sync()
    // El ordenador añade un libro y un vídeo.
    const big = randomBytes(300_000)
    const file = pc.vault.data.importBuffer('libro.epub', big)
    const other = pc.vault.data.importBuffer('video.mp4', randomBytes(200_000))
    pc.vault.data.create(BOOK_ENTITY, { [bookField(pc.vault)]: [file] }, { title: 'Dune' })
    await pc.sync.sync()

    reset(phone.meter)
    await phone.sync.sync()
    expect(phone.sync.status()).toMatchObject({ phase: 'idle', mobileFiles: false })
    expect(phone.vault.data.query(BOOK_ENTITY).map((r) => r.title)).toEqual(['Dune'])
    expect(phone.vault.data.files.exists(file.id)).toBe(false)
    expect(phone.vault.data.files.exists(other.id)).toBe(false)
    // Solo el cambio (la ficha del libro), ni un byte de los archivos.
    expect(phone.meter.down).toBeLessThan(20_000)

    // Abrirlo: se baja ese y solo ese, aunque sea con datos móviles.
    reset(phone.meter)
    expect(await phone.sync.fetchFile(file.id)).toBe(true)
    expect(phone.vault.data.files.read(file.id).equals(big)).toBe(true)
    expect(phone.meter.down).toBeGreaterThanOrEqual(big.length)
    expect(phone.meter.down).toBeLessThan(big.length + other.size)
    expect(phone.vault.data.files.exists(other.id)).toBe(false)
    expect(phone.sync.status()).toMatchObject({ phase: 'idle', progress: null })
    // Pedirlo otra vez no baja nada.
    reset(phone.meter)
    expect(await phone.sync.fetchFile(file.id)).toBe(true)
    expect(phone.meter.calls).toBe(0)

    // Con wifi, lo demás se baja solo.
    metered = false
    await phone.sync.sync('auto')
    expect(phone.vault.data.files.exists(other.id)).toBe(true)
  })

  it('el ajuste «bajar también con datos móviles» lo baja todo', async () => {
    const { devs } = await devices(['portatil', 'movil'], (name) =>
      name === 'movil' ? { metered: () => Promise.resolve(true) } : {},
    )
    const [pc, phone] = devs as [(typeof devs)[0], (typeof devs)[0]]
    const f = pc.vault.data.importBuffer('foto.bin', randomBytes(5000))
    await pc.sync.sync()
    await phone.sync.sync()
    expect(phone.vault.data.files.exists(f.id)).toBe(false)
    expect(phone.sync.setMobileFiles(true).mobileFiles).toBe(true)
    await expect.poll(() => phone.vault.data.files.exists(f.id), { timeout: 15_000 }).toBe(true)
    // Es de este equipo: no viaja al otro.
    await phone.sync.sync()
    await pc.sync.sync()
    expect(pc.sync.status().mobileFiles).toBe(false)
  })

  it('un archivo que no está en la nube no se busca cada minuto', async () => {
    const { drive, devs } = await devices(['portatil', 'movil'], () => ({}))
    const [pc, phone] = devs as [(typeof devs)[0], (typeof devs)[0]]
    const f = pc.vault.data.importBuffer('perdido.bin', randomBytes(1000))
    await pc.sync.sync()
    // Se pierde en la nube (otro equipo no llegó a subirlo).
    for (const [id, x] of drive.files) if (x.name === `${f.id}.bin`) drive.files.delete(id)
    await phone.sync.sync('auto')
    expect(phone.vault.data.files.exists(f.id)).toBe(false)
    reset(phone.meter)
    await phone.sync.sync('auto')
    const quiet = phone.meter.calls
    expect(quiet).toBeLessThanOrEqual(4)
  })

  it('Meta no se actualiza sola con datos móviles (a mano, sí)', async () => {
    const s = await metaSetup()
    cleanups.push(() => {
      s.meta.dispose()
      s.vault.dispose()
    })
    await s.meta.connect({ token: GOOD_TOKEN, appSecret: '' })
    s.meta.updateAccount({ id: 'act_111', enabled: true })
    await s.meta.idle()
    const { MetaService } = await import('../../src/main/meta/meta-service')
    const { FAKE_ECB, FAKE_GRAPH } = await import('./meta-fake')
    let requests = 0
    const fetchCounted = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      requests++
      return (s.fake.fetch as typeof fetch)(input, init)
    }) as typeof fetch
    let metered = true
    s.meta.dispose()
    const meta = new MetaService(s.vault, {
      http: fetchCounted,
      graphUrl: FAKE_GRAPH,
      ecbUrl: FAKE_ECB,
      sleep: async () => {},
      pollMs: 0,
      metered: () => Promise.resolve(metered),
    })
    cleanups.unshift(() => meta.dispose())
    meta.start()
    await new Promise((r) => setTimeout(r, 50))
    await meta.idle()
    expect(requests).toBe(0)
    // A mano, sí.
    await meta.syncNow()
    expect(requests).toBeGreaterThan(0)
    // Con wifi, sola.
    requests = 0
    metered = false
    meta.start()
    await new Promise((r) => setTimeout(r, 50))
    await meta.idle()
    expect(requests).toBeGreaterThan(0)
  })
})

/** La instantánea que dice `sync.json` de la nube (id y tamaño). */
function snapshotOf(drive: ReturnType<typeof fakeDrive>): { id: string; size?: number } {
  const f = [...drive.files.values()].find((x) => x.name === 'sync.json')!
  return (JSON.parse(f.data.toString()) as { snapshot: { id: string; size?: number } }).snapshot
}

describe('la base de datos entera, solo cuando compensa (D-133)', () => {
  const day = 86_400_000

  it('leer unas páginas una semana después no sube la base de datos entera', async () => {
    let now = Date.now()
    const { drive, devs } = await devices(['portatil', 'movil'], () => ({
      changeDelayMs: 10,
      minPushGapMs: 0,
      now: () => new Date(now),
    }))
    const [pc, phone] = devs as [(typeof devs)[0], (typeof devs)[0]]
    // Algo de peso en la base de datos (como las métricas de Meta).
    const insert = pc.vault.sqlite.prepare(
      'INSERT INTO fx_rates (date, currency, rate) VALUES (?, ?, ?)',
    )
    pc.vault.sqlite.transaction(() => {
      for (let i = 0; i < 24_000; i++) insert.run('2026-01-01', `C${i}`, i)
    })()
    await pc.sync.sync()
    await phone.sync.sync()
    const first = snapshotOf(drive)
    expect(first.size).toBeGreaterThan(500_000)

    // Diez días después, unas cuantas páginas en cada equipo.
    now += 10 * day
    const book = pc.vault.data.create(BOOK_ENTITY, {}, { title: 'Libro' })
    for (const [i, d] of [
      pc,
      phone,
      pc,
      phone,
      pc,
      phone,
      pc,
      phone,
      pc,
      phone,
      pc,
      phone,
    ].entries()) {
      if (i === 1) await d.sync.sync()
      new BooksService(d.vault).setProgress({
        recordId: book.id,
        location: String(i),
        fraction: i / 100,
        page: i,
        pages: 100,
        chapter: null,
      })
      reset(d.meter)
      await d.sync.sync('auto')
      // Cada subida, unos pocos KB: nada de la base de datos entera.
      expect(d.meter.up).toBeLessThan(50_000)
    }
    expect(packCount(drive)).toBeGreaterThanOrEqual(10)
    expect(snapshotOf(drive).id).toBe(first.id)
  })

  it('cuando compensa, el ordenador sube una instantánea compacta y cifrada; el móvil, nunca', async () => {
    let metered = false
    const { drive, devs } = await devices(['portatil', 'movil'], (name) => ({
      compactMinBytes: 1,
      ...(name === 'movil' ? { compact: false } : { metered: () => Promise.resolve(metered) }),
    }))
    const [pc, phone] = devs as [(typeof devs)[0], (typeof devs)[0]]
    const db = pc.vault.sqlite
    const insert = db.prepare('INSERT INTO fx_rates (date, currency, rate) VALUES (?, ?, ?)')
    db.transaction(() => {
      for (let i = 0; i < 2000; i++) insert.run('2026-01-01', `C${i}`, i)
    })()
    await pc.sync.sync()
    await phone.sync.sync()
    const first = snapshotOf(drive)
    // Muchos datos nuevos (que no se comprimen), casi todos borrados después: los paquetes
    // ya pesan más que media instantánea y en el archivo queda el hueco de lo borrado.
    db.transaction(() => {
      for (let i = 0; i < 24_000; i++)
        insert.run('2026-02-01', randomBytes(12).toString('hex'), Math.random())
    })()
    db.prepare("DELETE FROM fx_rates WHERE date = '2026-02-01' AND rowid % 4 <> 0").run()

    // El ordenador con datos móviles (un portátil con el móvil de punto de acceso): sube
    // sus cambios, pero no la base de datos entera.
    metered = true
    await pc.sync.sync()
    expect(packCount(drive)).toBeGreaterThan(0)
    expect(snapshotOf(drive).id).toBe(first.id)
    // El móvil se pone al día y sube lo suyo, pero nunca la base de datos entera.
    phone.vault.data.create('cliente', {}, { title: 'Del móvil' })
    await phone.sync.sync()
    await phone.sync.sync()
    expect(snapshotOf(drive).id).toBe(first.id)

    // Con wifi, sí: compacta (sin el hueco de lo borrado) y cifrada.
    metered = false
    await pc.sync.sync()
    const next = snapshotOf(drive)
    expect(next.id).not.toBe(first.id)
    const local = statSync(join(pc.vault.currentPath!, 'crm.db')).size
    expect(next.size).toBeLessThan(local * 0.8)
    const data = [...drive.files.values()].find(
      (f) => f.name === 'crm.db' && f.data.length === next.size,
    )!.data
    expect(data.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3')

    // Un equipo nuevo se pone al día desde ella, con todo.
    const { devs: more } = await devices([], () => ({}))
    expect(more).toEqual([])
    await phone.sync.sync()
    const n = (
      phone.vault.sqlite.prepare('SELECT COUNT(*) AS n FROM fx_rates').get() as { n: number }
    ).n
    expect(n).toBe(8000)
  })
})
