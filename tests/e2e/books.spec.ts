import { expect, test, type Frame, type Page } from '@playwright/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeEpub, makePdf } from '../support/books'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'

/**
 * Biblioteca y lector en el ordenador (D-123): el lector de ebooks va en crm-reader://,
 * otro origen con su propia CSP, sin acceso a la app; se lee con las flechas.
 */
let ctx: Launched
let page: Page
let errors: string[]
let parent: string
let dir: string
const shots = process.env['E2E_SHOTS']

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

function readerFrame(): Frame | undefined {
  return page.frames().find((f) => f.url().startsWith('crm-reader://reader/'))
}

async function chapterFrame(): Promise<Frame> {
  let found: Frame | undefined
  await expect
    .poll(
      () => {
        found = page.frames().find((f) => f.url().startsWith('blob:crm-reader://reader/'))
        return !!found
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  return found!
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-libros-'))
  dir = mkdtempSync(join(tmpdir(), 'crm-e2e-libros-archivos-'))
  writeFileSync(join(dir, 'libro.epub'), makeEpub())
  writeFileSync(join(dir, 'manual.pdf'), await makePdf())
  ctx = await launchApp()
  page = ctx.page
  errors = collectConsoleErrors(page)
  await createVaultAndEnter(ctx, parent)
})

test.afterAll(async () => {
  await ctx.close()
  rmSync(parent, { recursive: true, force: true })
  rmSync(dir, { recursive: true, force: true })
})

test('añadir libros desde el selector del sistema', async () => {
  await page.getByTestId('nav-biblioteca').click()
  await expect(page.getByTestId('page-biblioteca')).toBeVisible()
  await ctx.app.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as never
    },
    [join(dir, 'libro.epub'), join(dir, 'manual.pdf')],
  )
  await page.getByTestId('add-books').click()
  await expect(page.getByText('2 libros añadidos.')).toBeVisible({ timeout: 60_000 })
  await page.getByTestId('library-tab-por-leer').click()
  const cards = page.getByTestId('book-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.filter({ hasText: 'Libro de prueba' })).toContainText('Autora Inventada')
  await expect(cards.filter({ hasText: 'Manual en PDF' }).locator('img')).toBeVisible({
    timeout: 20_000,
  })
  await shot('50-biblioteca')
})

test('el lector de ebooks va aislado y se lee con las flechas', async () => {
  await page
    .getByTestId('book-card')
    .filter({ hasText: 'Libro de prueba' })
    .getByRole('button', { name: /Leer/ })
    .click()
  await expect(page.getByTestId('reader')).toBeVisible()
  const chapter = await chapterFrame()
  await expect(chapter.locator('h1')).toHaveText('Capítulo 1', { timeout: 20_000 })
  expect(await chapter.locator('script').count()).toBe(0)

  // Otro origen: sin la API de la app y sin acceso a su DOM.
  const frame = readerFrame()!
  expect(
    await frame.evaluate(() => {
      let dom: string
      try {
        dom = String(window.parent.document.title)
      } catch {
        dom = 'bloqueado'
      }
      return { api: typeof (window as { api?: unknown }).api, dom, origin: location.origin }
    }),
  ).toEqual({ api: 'undefined', dom: 'bloqueado', origin: 'crm-reader://reader' })

  // Una letra que va con la app (D-124) se carga también en crm-reader://.
  await page.getByTestId('reader-settings').click()
  await page.getByTestId('reader-font-literata').click()
  await page.keyboard.press('Escape')
  await expect
    .poll(
      async () =>
        (await chapterFrame()).evaluate(async () => {
          await document.fonts.ready
          return document.fonts.check('16px "CRM Literata"')
        }),
      { timeout: 15_000 },
    )
    .toBe(true)

  const before = await page.getByTestId('reader-page').textContent()
  await page.getByTestId('reader-next').click()
  await expect(page.getByTestId('reader-page')).not.toHaveText(before ?? '')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowLeft')
  // Tras la animación de pasar página.
  await page.waitForTimeout(800)
  await shot('51-lector-epub')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('reader')).toHaveCount(0)
  await page.getByTestId('library-tab-leyendo').click()
  await expect(page.getByTestId('continue-reading')).toContainText('Libro de prueba')
})

test('el PDF se lee con pdf.js en la propia app', async () => {
  await page.getByTestId('library-tab-por-leer').click()
  await page
    .getByTestId('book-card')
    .filter({ hasText: 'Manual en PDF' })
    .getByRole('button', { name: /Leer/ })
    .click()
  await expect(page.getByTestId('reader-pdf').locator('canvas')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('reader-page')).toHaveText('Página 1 de 3')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('reader-page')).toHaveText('Página 2 de 3')
  await shot('52-lector-pdf')
  await page.getByTestId('reader-close').click()
})

test('«Lista»: los libros con las vistas del motor de datos', async () => {
  await page.getByTestId('library-tab-lista').click()
  await expect(page.getByTestId('page-libro')).toBeVisible()
  await expect(page.getByTestId('page-libro')).toContainText('Libro de prueba')
  await page.getByTestId('library-tab-leyendo').click()
  await expect(page.getByTestId('continue-reading')).toBeVisible()
})

test('la tarjeta de Inicio lleva al libro que estás leyendo, sin errores', async () => {
  await page.getByTestId('nav-inicio').click()
  const card = page.getByTestId('home-reading')
  await expect(card).toBeVisible()
  await expect(card).toContainText(/Libro de prueba|Manual en PDF/)
  await shot('53-inicio-lectura')
  expect(errors).toEqual([])
})
