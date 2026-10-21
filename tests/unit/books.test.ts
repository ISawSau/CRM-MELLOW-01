import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BOOK_ENTITY, DEFAULT_READER_PREFS, isBookName } from '@shared/books'
import { BooksService } from '../../src/main/books/books-service'
import { SyncService } from '../../src/main/sync/sync-service'
import { VaultService } from '../../src/main/vault/vault-service'
import { TEST_KDF, tempDir } from './helpers'

const PASSWORD = 'contraseña de prueba'
const vaults: VaultService[] = []
afterEach(() => {
  for (const v of vaults.splice(0)) v.dispose()
})

async function setup(now = new Date('2026-10-21T10:00:00Z')) {
  const vault = new VaultService({ kdf: TEST_KDF, hostname: 'equipo' })
  await vault.create(tempDir(), 'Boveda', PASSWORD)
  vaults.push(vault)
  let clock = now
  let changes = 0
  const books = new BooksService(vault, { now: () => clock, onChange: () => changes++ })
  const field = (key: string) => vault.data.listFields(BOOK_ENTITY).find((f) => f.key === key)!.id
  const addBook = (title: string, bytes = 'contenido del libro') => {
    const file = vault.data.importBuffer(`${title}.epub`, Buffer.from(bytes))
    return vault.data.create(
      BOOK_ENTITY,
      { [field('archivo')]: [file], [field('estado')]: 'por-leer' },
      { title },
    )
  }
  return {
    vault,
    books,
    field,
    addBook,
    setNow: (d: Date) => (clock = d),
    changes: () => changes,
  }
}

const session = (
  recordId: string,
  id: string,
  startedAt: string,
  seconds: number,
  from = 0,
  to = 0.01,
) => ({
  id,
  recordId,
  startedAt,
  endedAt: new Date(Date.parse(startedAt) + seconds * 1000).toISOString(),
  seconds,
  fromFraction: from,
  toFraction: to,
  pages: 3,
})

describe('biblioteca (D-123)', () => {
  it('reconoce los formatos de libro', () => {
    for (const n of ['a.pdf', 'b.EPUB', 'c.mobi', 'd.azw3', 'e.fb2', 'f.cbz', 'g.fbz'])
      expect(isBookName(n)).toBe(true)
    for (const n of ['a.docx', 'b.png', 'sin-extension']) expect(isBookName(n)).toBe(false)
  })

  it('siembra la entidad «libro» con sus campos y vistas', async () => {
    const { vault } = await setup()
    const keys = vault.data.listFields(BOOK_ENTITY).map((f) => f.key)
    expect(keys).toEqual(
      expect.arrayContaining(['titulo', 'autor', 'estado', 'archivo', 'empezado', 'terminado']),
    )
    expect(vault.data.listViews(BOOK_ENTITY).map((v) => v.kind)).toEqual([
      'gallery',
      'table',
      'kanban',
    ])
  })

  it('al abrir pasa a «Leyendo» con la fecha de hoy y guarda la posición sin tocar el historial', async () => {
    const { vault, books, field, addBook, changes } = await setup()
    const b = addBook('Dune')
    expect(books.open(b.id)).toBeNull()
    const rec = vault.data.get(b.id)
    expect(rec.values[field('estado')]).toBe('leyendo')
    expect(rec.values[field('empezado')]).toBe('2026-10-21')
    const historyBefore = vault.data.history(b.id).length

    books.setProgress({
      recordId: b.id,
      location: 'epubcfi(/6/4!/4/2)',
      fraction: 0.25,
      page: 30,
      pages: 120,
      chapter: 'Capítulo 3',
    })
    books.setProgress({
      recordId: b.id,
      location: 'epubcfi(/6/6!/4/2)',
      fraction: 0.3,
      page: 36,
      pages: 120,
      chapter: 'Capítulo 4',
    })
    expect(books.progress(b.id)).toMatchObject({ fraction: 0.3, chapter: 'Capítulo 4', page: 36 })
    expect(books.allProgress()).toHaveLength(1)
    expect(vault.data.history(b.id)).toHaveLength(historyBefore)
    expect(changes()).toBeGreaterThanOrEqual(2)

    // Volver a abrirlo no cambia la fecha de inicio.
    expect(books.open(b.id)?.location).toBe('epubcfi(/6/6!/4/2)')
    expect(vault.data.get(b.id).values[field('empezado')]).toBe('2026-10-21')
  })

  it('solo guarda posiciones y ratos de libros (no de otros registros ni de la papelera)', async () => {
    const { vault, books, addBook } = await setup()
    const client = vault.data.create('cliente', {}, { title: 'Acme' })
    const p = { location: '1', fraction: 0.1, page: 1, pages: 10, chapter: null }
    expect(() => books.setProgress({ recordId: client.id, ...p })).toThrow()
    const b = addBook('Fundación')
    vault.data.trash([b.id])
    expect(() => books.setProgress({ recordId: b.id, ...p })).toThrow()
    expect(() =>
      books.saveSession(session(b.id, 'sesion-0001', '2026-10-21T09:00:00Z', 60)),
    ).toThrow()
  })

  it('ratos de lectura: el mismo id no se duplica; racha, días y ritmo', async () => {
    const { books, addBook } = await setup()
    const b = addBook('El nombre del viento')
    // Hoy (dos guardados del mismo rato), ayer, anteayer (menos de un minuto) y hace 3 días.
    books.saveSession(session(b.id, 'hoy-00001', '2026-10-21T08:00:00Z', 300, 0.1, 0.12))
    books.saveSession(session(b.id, 'hoy-00001', '2026-10-21T08:00:00Z', 600, 0.1, 0.15))
    books.saveSession(session(b.id, 'ayer-0001', '2026-10-20T20:00:00Z', 120, 0.05, 0.1))
    books.saveSession(session(b.id, 'antea-001', '2026-10-19T20:00:00Z', 30, 0.04, 0.05))
    books.saveSession(session(b.id, 'hace3-001', '2026-10-18T20:00:00Z', 300, 0, 0.04))
    const s = books.stats()
    expect(s.today).toEqual({ day: '2026-10-21', seconds: 600, pages: 3 })
    expect(s.days).toHaveLength(365)
    expect(s.days.at(-1)!.day).toBe('2026-10-21')
    expect(s.days.at(-2)!.seconds).toBe(120)
    expect(s.streak).toBe(2)
    expect(s.bestStreak).toBe(2)
    expect(s.totalSeconds).toBe(600 + 120 + 30 + 300)
    const stat = s.books.find((x) => x.recordId === b.id)!
    expect(stat.sessions).toBe(4)
    // 15 % del libro en 1.050 s.
    expect(stat.fractionPerHour).toBeCloseTo(0.15 / (1050 / 3600), 5)
  })

  it('el día del rato es el de la zona horaria del perfil', async () => {
    const { books, addBook } = await setup()
    const b = addBook('Rayuela')
    // 23:30 en UTC es ya el día siguiente en Madrid.
    books.saveSession(session(b.id, 'noche-001', '2026-10-20T23:30:00Z', 600))
    expect(books.stats().today.seconds).toBe(600)
  })

  it('la racha cuenta hasta ayer si hoy aún no has leído', async () => {
    const { books, addBook } = await setup()
    const b = addBook('Ficciones')
    books.saveSession(session(b.id, 'dia1-0001', '2026-10-19T10:00:00Z', 120))
    books.saveSession(session(b.id, 'dia2-0001', '2026-10-20T10:00:00Z', 120))
    expect(books.stats().streak).toBe(2)
  })

  it('terminado y objetivo anual', async () => {
    const { vault, books, field, addBook } = await setup()
    const a = addBook('Uno', 'a')
    const b = addBook('Dos', 'b')
    books.finish(a.id)
    expect(vault.data.get(a.id).values[field('estado')]).toBe('leido')
    expect(vault.data.get(a.id).values[field('terminado')]).toBe('2026-10-21')
    vault.data.update(b.id, { [field('terminado')]: '2025-03-02', [field('estado')]: 'leido' })
    expect(books.goal()).toEqual({ booksPerYear: null })
    books.setGoal({ booksPerYear: 24 })
    const s = books.stats()
    expect(s.finishedByYear).toEqual({ '2026': 1, '2025': 1 })
    expect(s.year).toEqual({ year: 2026, finished: 1, goal: 24 })
  })

  it('la apariencia del lector va por tipo de equipo', async () => {
    const { books } = await setup()
    expect(books.prefs('movil')).toEqual(DEFAULT_READER_PREFS)
    books.setPrefs('movil', { ...DEFAULT_READER_PREFS, fontSize: 130, theme: 'sepia' })
    expect(books.prefs('movil')).toMatchObject({ fontSize: 130, theme: 'sepia' })
    expect(books.prefs('escritorio')).toEqual(DEFAULT_READER_PREFS)
    expect(() => books.setPrefs('movil', { ...DEFAULT_READER_PREFS, fontSize: 999 })).toThrow()
  })

  it('el móvil baja los libros aunque pasen del límite de descarga automática', async () => {
    const parent = tempDir()
    const pc = new VaultService({ kdf: TEST_KDF, hostname: 'portatil' })
    const { status } = await pc.create(parent, 'Boveda', PASSWORD)
    pc.dispose()
    const copy = join(tempDir(), 'Boveda')
    cpSync(status.path!, copy, { recursive: true })
    const remote = tempDir()
    const a = new VaultService({ kdf: TEST_KDF, hostname: 'portatil' })
    a.open(status.path!)
    await a.unlock(PASSWORD)
    const phone = new VaultService({ kdf: TEST_KDF, hostname: 'movil' })
    phone.open(copy)
    await phone.unlock(PASSWORD)
    vaults.push(a, phone)

    const field = (key: string) => a.data.listFields(BOOK_ENTITY).find((f) => f.key === key)!.id
    const big = 'x'.repeat(5000)
    const book = a.data.importBuffer('grande.pdf', Buffer.from(`libro ${big}`))
    a.data.create(BOOK_ENTITY, { [field('archivo')]: [book] }, { title: 'Grande' })
    const video = a.data.importBuffer('video.mp4', Buffer.from(`video ${big}`))
    const docField = a.data.listFields('documento').find((f) => f.key === 'archivos')!.id
    a.data.create('documento', { [docField]: [video] }, { title: 'Vídeo' })
    const syncA = new SyncService(a, { hostname: 'portatil', openBrowser: () => {} })
    syncA.configureFolder(remote)
    await syncA.sync()

    const phoneBooks = new BooksService(phone)
    const syncPhone = new SyncService(phone, {
      hostname: 'movil',
      openBrowser: () => {},
      maxAutoDownloadBytes: 1000,
      alwaysDownload: () => phoneBooks.bookFileIds(),
    })
    syncPhone.configureFolder(remote)
    await syncPhone.sync()
    expect(phone.data.files.exists(book.id)).toBe(true)
    expect(phone.data.files.exists(video.id)).toBe(false)
  })
})
