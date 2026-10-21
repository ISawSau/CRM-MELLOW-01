import { expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { makeEpub, makePdf } from '../support/books'

/**
 * Biblioteca y lector en el móvil (D-123), con su motor de verdad: añadir un EPUB y un PDF
 * hechos en el test, leer pasando página con toques, cambiar la apariencia, cerrar y volver
 * donde se estaba, y que el contenido hostil del EPUB no llegue a la app.
 * E2E_SHOTS=<carpeta> guarda capturas.
 */
const PORT = 47240
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'contraseña de prueba'
const SHOTS = process.env['E2E_SHOTS']

test.describe.configure({ mode: 'serial' })

let engine: ChildProcess
let context: BrowserContext
let page: Page
const errors: string[] = []

const shot = async (name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** El capítulo que se ve: el marco blob: dentro del marco del lector. */
async function chapterFrame(): Promise<Frame> {
  let found: Frame | undefined
  await expect
    .poll(
      () => {
        found = page.frames().find((f) => f.url().startsWith('blob:') && f.parentFrame() !== null)
        return !!found
      },
      { timeout: 20_000 },
    )
    .toBe(true)
  return found!
}

const tap = async (xFraction: number) => {
  const { width, height } = page.viewportSize()!
  await page.mouse.click(width * xFraction, height * 0.5)
}

test.beforeAll(async ({ browser }) => {
  engine = spawn(process.execPath, ['tests/e2e-mobile/serve.mjs'], {
    env: { ...process.env, CRM_MOBILE_PORT: String(PORT) },
    stdio: 'inherit',
  })
  for (let i = 0; i < 100; i++) {
    const up = await fetch(BASE)
      .then(() => true)
      .catch(() => false)
    if (up) break
    await new Promise((r) => setTimeout(r, 200))
  }
  context = await browser.newContext({ ...test.info().project.use, baseURL: BASE })
  await context.addCookies([{ name: 'crm', value: 'e2e-secreto', url: BASE }])
  page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push(m.text())
  })
})

test.afterAll(async () => {
  await context?.close()
  engine?.kill()
})

test('bóveda nueva y la biblioteca vacía', async () => {
  await page.goto('/')
  await page.getByTestId('welcome-create').click()
  await page.getByTestId('create-password').fill(PASSWORD)
  await page.getByTestId('create-confirm').fill(PASSWORD)
  await page.getByTestId('create-submit').click()
  await page.getByTestId('recovery-saved').check({ timeout: 30_000 })
  await page.getByTestId('recovery-continue').click()
  await expect(page.getByTestId('shell')).toBeVisible()
  // Lo que un libro malicioso intentara mandar a la app se apunta aquí.
  await page.evaluate(() => {
    const w = window as unknown as { __hostile: unknown[] }
    w.__hostile = []
    addEventListener('message', (e) => {
      if ((e.data as { type?: string })?.type === 'pwned') w.__hostile.push(e.data)
    })
  })
  await page.getByTestId('mobile-menu').click()
  await page.getByTestId('nav-biblioteca').click()
  await expect(page.getByTestId('page-biblioteca')).toBeVisible()
  await expect(page.getByText('Tu biblioteca está vacía')).toBeVisible()
  await shot('40-biblioteca-vacia')
})

test('añadir un EPUB y un PDF: título, autor y portada salen del archivo', async () => {
  test.setTimeout(120_000)
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('add-books').click()
  await (
    await chooser
  ).setFiles([
    { name: 'libro.epub', mimeType: 'application/epub+zip', buffer: makeEpub() },
    { name: 'manual.pdf', mimeType: 'application/pdf', buffer: await makePdf() },
    { name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('no es un libro') },
  ])
  await expect(page.getByText('2 libros añadidos.')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/No es un libro: notas\.txt/)).toBeVisible()
  await page.getByTestId('library-tab-por-leer').click()
  const cards = page.getByTestId('book-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.filter({ hasText: 'Libro de prueba' })).toContainText('Autora Inventada')
  await expect(cards.filter({ hasText: 'Manual en PDF' })).toContainText('Autor del PDF')
  // Las portadas son las miniaturas cifradas del archivo.
  for (const name of ['Libro de prueba', 'Manual en PDF'])
    await expect(cards.filter({ hasText: name }).locator('img')).toBeVisible({ timeout: 20_000 })
  await shot('41-biblioteca')
  // Las portadas caben en la pantalla (dos o tres por fila).
  const box = (await cards.first().boundingBox())!
  expect(box.width).toBeLessThan(page.viewportSize()!.width / 2)
})

test('leer el EPUB: toques a los lados pasan página, el centro muestra los controles', async () => {
  await page
    .getByTestId('book-card')
    .filter({ hasText: 'Libro de prueba' })
    .getByRole('button', { name: /Leer/ })
    .click()
  const reader = page.getByTestId('reader')
  await expect(reader).toBeVisible()
  const chapter = await chapterFrame()
  await expect(chapter.locator('h1')).toHaveText('Capítulo 1', { timeout: 20_000 })
  // El lector va en otro origen: ni scripts ni manejadores del libro.
  expect(await chapter.locator('script').count()).toBe(0)
  expect(await chapter.locator('[onclick]').count()).toBe(0)
  await expect(page.getByTestId('reader-percent')).not.toHaveText('')
  await shot('42-lector-epub')
  const before = await page.getByTestId('reader-page').textContent()

  // Centro: oculta los controles; derecha: página siguiente.
  await tap(0.5)
  await expect(page.locator('.reader-top')).toHaveAttribute('data-visible', 'false')
  await tap(0.9)
  await expect(page.getByTestId('reader-page')).not.toHaveText(before ?? '')
  await tap(0.9)
  await tap(0.1)
  await tap(0.5)
  await expect(page.locator('.reader-top')).toHaveAttribute('data-visible', 'true')

  // Índice: al capítulo 2.
  await page.getByTestId('reader-toc').click()
  await expect(page.getByTestId('reader-toc-panel')).toBeVisible()
  await shot('43-lector-indice')
  await page.getByTestId('reader-toc-panel').getByText('Capítulo 2').click()
  await expect(page.locator('.reader-title')).toContainText('Capítulo 2', { timeout: 10_000 })

  // Apariencia: sepia y letra más grande.
  await page.getByTestId('reader-settings').click()
  const panel = page.getByTestId('reader-settings-panel')
  await expect(panel).toBeVisible()
  await page.getByTestId('reader-theme-sepia').click()
  await panel.getByRole('button', { name: 'Más' }).first().click()
  await expect(page.getByTestId('reader-font-size')).toHaveText('110 %')
  const box = (await panel.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 0.5)
  await shot('44-lector-ajustes')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(reader).toHaveCSS('background-color', 'rgb(244, 236, 216)')

  // Nada del libro ha llegado a la app.
  const hostile = await page.evaluate(
    () => (window as unknown as { __hostile: unknown[] }).__hostile.length,
  )
  expect(hostile).toBe(0)

  // «Atrás» de Android cierra el lector.
  const back = await page.evaluate(
    () => (window as { __crmBack?: () => boolean }).__crmBack?.() ?? false,
  )
  expect(back).toBe(true)
  await expect(reader).toHaveCount(0)
})

test('al volver, sigue donde lo dejaste y cuenta como «Leyendo»', async () => {
  await page.getByTestId('library-tab-leyendo').click()
  const card = page.getByTestId('book-card').filter({ hasText: 'Libro de prueba' })
  await expect(card).toBeVisible()
  await expect(card.locator('.book-pct')).toContainText('%')
  await expect(page.getByTestId('continue-reading')).toContainText('Libro de prueba')
  await page.getByTestId('continue-button').click()
  await expect(page.locator('.reader-title')).toContainText('Capítulo 2', { timeout: 20_000 })
  // La apariencia elegida se ha guardado.
  await expect(page.getByTestId('reader')).toHaveCSS('background-color', 'rgb(244, 236, 216)')
  await page.getByTestId('reader-close').click()
  await expect(page.getByTestId('reader')).toHaveCount(0)
})

test('leer el PDF página a página y en continuo', async () => {
  await page.getByTestId('library-tab-por-leer').click()
  await page
    .getByTestId('book-card')
    .filter({ hasText: 'Manual en PDF' })
    .getByRole('button', { name: /Leer/ })
    .click()
  await expect(page.getByTestId('reader-pdf').locator('canvas')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('reader-page')).toHaveText('Página 1 de 3')
  await shot('45-lector-pdf')
  await tap(0.9)
  await expect(page.getByTestId('reader-page')).toHaveText('Página 2 de 3')
  // Deslizar hacia la izquierda: siguiente.
  const { width, height } = page.viewportSize()!
  await page.mouse.move(width * 0.8, height * 0.5)
  await page.mouse.down()
  await page.mouse.move(width * 0.2, height * 0.5, { steps: 6 })
  await page.mouse.up()
  await expect(page.getByTestId('reader-page')).toHaveText('Página 3 de 3')
  // Al final pregunta si lo has terminado.
  await expect(page.getByTestId('reader-finished')).toBeVisible()
  await page.getByRole('button', { name: 'Marcar como leído' }).click()
  await expect(page.getByText('Marcado como leído.')).toBeVisible()

  // Al pasar página los controles se han apartado: tocar el centro los muestra.
  await expect(page.locator('.reader-top')).toHaveAttribute('data-visible', 'false')
  await tap(0.5)
  await page.getByTestId('reader-settings').click()
  await page.getByTestId('reader-flow-continuo').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.pdf-list canvas').first()).toBeVisible({ timeout: 20_000 })
  await shot('46-lector-pdf-continuo')
  await page.getByTestId('reader-close').click()
  await page.getByTestId('library-tab-leido').click()
  await expect(page.getByTestId('book-card').filter({ hasText: 'Manual en PDF' })).toBeVisible()
})

test('nada se sale de la pantalla y sin errores', async () => {
  await page.getByTestId('library-tab-todos').click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  )
  await shot('47-biblioteca-todos')
  expect(errors).toEqual([])
})
