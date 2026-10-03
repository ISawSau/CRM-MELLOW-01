import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
let png: string
const shots = process.env['E2E_SHOTS']

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

/** PNG de 64×48 de un color, generado sin dependencias. */
function makePng(path: string): void {
  const w = 64
  const h = 48
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = 224
      raw[o + 1] = 164
      raw[o + 2] = 124
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  )
}

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? allFiles(p) : [p]
  })
}

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-creatividades-'))
  png = join(parent, 'anuncio-verano.png')
  makePng(png)
  ctx = await launchApp()
  page = ctx.page
  errors = collectConsoleErrors(page)
  await createVaultAndEnter(ctx, parent)
})

test.afterAll(async () => {
  await ctx.close()
  rmSync(parent, { recursive: true, force: true })
})

test.describe.configure({ mode: 'serial' })

const panel = () => page.getByTestId('record-panel')

test('adjuntar una imagen: se cifra, se ve su miniatura y se abre en grande', async () => {
  await page.getByTestId('nav-creatividades').click()
  await expect(page.getByTestId('page-creatividad')).toBeVisible()
  await page.getByTestId('new-record').click()
  await panel().locator('#panel-title').fill('Verano: hook dolor')
  await panel().locator('#panel-title').press('Enter')
  await panel().getByLabel('Tipo').selectOption({ label: 'Imagen' })

  await ctx.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as never
  }, png)
  const files = panel().getByTestId('files-edit').first()
  await files.getByRole('button', { name: 'Añadir archivos' }).click()
  await expect(files.getByText('anuncio-verano.png')).toBeVisible()
  // La miniatura la genera Chromium y se guarda cifrada.
  const thumb = files.locator('img[src^="vault://thumb/"]')
  await expect(thumb).toBeVisible({ timeout: 15_000 })
  expect(await thumb.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(64)
  await shot('30-creatividad')

  await files.getByRole('button', { name: 'Ver anuncio-verano.png' }).click()
  const preview = page.getByTestId('file-preview')
  await expect(preview.locator('img[src^="vault://file/"]')).toBeVisible()
  await expect(preview).toContainText('64×48')
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()

  // En disco no hay ningún PNG en claro.
  const vault = join(parent, 'CRM-Boveda')
  const stored = allFiles(join(vault, 'files')).concat(allFiles(join(vault, 'thumbs')))
  expect(stored.length).toBeGreaterThanOrEqual(2)
  const signature = readFileSync(png).subarray(0, 8)
  for (const f of stored) expect(readFileSync(f).includes(signature)).toBe(false)
})

test('versiones del copy: guardar, comparar y restaurar', async () => {
  const editor = panel().getByRole('textbox', { name: 'Copy o guion' })
  await editor.click()
  await page.keyboard.type('¿Cansada del calor?')
  await panel().getByRole('tab', { name: 'Versiones' }).click()
  await panel().getByLabel('Nota de la versión').fill('Primera')
  await panel().getByRole('button', { name: 'Guardar versión' }).click()
  await expect(panel().getByTestId('versions')).toContainText('v1')

  await panel().getByRole('tab', { name: 'Detalles' }).click()
  await panel().getByRole('textbox', { name: 'Copy o guion' }).click()
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Este verano, sin sudar')
  await panel().locator('#panel-title').click()
  await panel().getByRole('tab', { name: 'Versiones' }).click()
  await panel()
    .getByRole('button', { name: /Ver cambios/ })
    .click()
  await expect(panel().locator('.diff-line[data-kind="removed"]')).toContainText(
    '¿Cansada del calor?',
  )
  await expect(panel().locator('.diff-line[data-kind="added"]')).toContainText('Este verano')
  await shot('31-versiones')
  await panel().getByRole('button', { name: 'Restaurar v1' }).click()
  await expect(panel().getByTestId('versions')).toContainText('Igual que ahora')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('la galería muestra la portada y el swipe file marca la referencia', async () => {
  await expect(page.getByTestId('gallery').locator('img[src^="vault://thumb/"]')).toBeVisible()
  await shot('32-galeria')
  await page.getByTestId('view-tab').filter({ hasText: 'Swipe file' }).click()
  await page.getByTestId('new-record').click()
  await expect(panel().getByLabel('Referencia (swipe file)')).toBeChecked()
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
  await expect(page.getByTestId('gallery').locator('.card')).toHaveCount(1)
  await page.getByTestId('view-tab').filter({ hasText: 'Biblioteca' }).click()
  await expect(page.getByTestId('gallery').locator('.card')).toHaveCount(1)
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
