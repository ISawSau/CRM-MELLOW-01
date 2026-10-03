import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import {
  collectConsoleErrors,
  createVaultAndEnter,
  launchApp,
  stubSaveDialog,
  type Launched,
} from './app'

/** Herramientas: imágenes y PDF en la interfaz, vídeo con FFmpeg (fase 9). */

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
let fixtures: string
const shots = process.env['E2E_SHOTS']
const FFMPEG = join(
  __dirname,
  '..',
  '..',
  'vendor',
  'ffmpeg',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg',
)

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

/** PNG de un color, sin dependencias. */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function pdf(pages: number, label: string): Promise<Buffer> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= pages; i++)
    doc.addPage([400, 300]).drawText(`${label} ${i}`, { x: 40, y: 150, size: 28, font })
  return Buffer.from(await doc.save())
}

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-herramientas-'))
  fixtures = mkdtempSync(join(tmpdir(), 'crm-e2e-fixtures-'))
  writeFileSync(join(fixtures, 'foto.png'), png(640, 480))
  writeFileSync(join(fixtures, 'a.pdf'), await pdf(2, 'Primero'))
  writeFileSync(join(fixtures, 'b.pdf'), await pdf(3, 'Segundo'))
  ctx = await launchApp()
  page = ctx.page
  errors = collectConsoleErrors(page)
  await createVaultAndEnter(ctx, parent)
  await page.getByTestId('nav-herramientas').click()
})

test.afterAll(async () => {
  await ctx.close()
  rmSync(parent, { recursive: true, force: true })
  rmSync(fixtures, { recursive: true, force: true })
})

test.describe.configure({ mode: 'serial' })

test('imágenes: convertir a WebP y reducir el ancho, guardado en Documentos', async () => {
  const tool = page.getByTestId('tool-imagenes')
  await tool
    .getByTestId('image-drop')
    .locator('input[type=file]')
    .setInputFiles(join(fixtures, 'foto.png'))
  await tool.getByLabel('Formato').selectOption('image/webp')
  await tool.getByLabel('Ancho máximo (px)').fill('abc')
  await expect(tool.getByRole('button', { name: 'Procesar imagen' })).toBeDisabled()
  await tool.getByLabel('Ancho máximo (px)').fill('320')
  await tool.getByRole('button', { name: 'Procesar imagen' }).click()
  const results = tool.getByTestId('tool-results')
  await expect(results).toContainText('foto.webp')
  await expect(results).toContainText('320 × 240 px')
  await expect(results).toContainText('Guardado en Documentos')
  await shot('50-herramientas-imagenes')
})

test('PDF: unir en orden, dividir por rangos y comprimir', async () => {
  await page.getByTestId('tools-tab-pdf').click()
  const tool = page.getByTestId('tool-pdf')
  const input = tool.getByTestId('pdf-drop').locator('input[type=file]')
  await input.setInputFiles([join(fixtures, 'a.pdf'), join(fixtures, 'b.pdf')])
  await expect(tool.locator('.tool-files')).toContainText('3 páginas')
  await tool.getByRole('button', { name: 'Bajar a.pdf' }).click()
  await expect(tool.locator('.tool-files li').first()).toContainText('b.pdf')
  await tool.getByRole('button', { name: 'Unir 2 PDF' }).click()
  const results = tool.getByTestId('tool-results')
  await expect(results).toContainText('b-unido.pdf')
  await expect(results).toContainText('5 páginas')
  await expect(results).toContainText('Guardado en Documentos')

  await tool.getByRole('button', { name: 'Dividir', exact: true }).click()
  await input.setInputFiles(join(fixtures, 'b.pdf'))
  await tool.getByLabel('Páginas de cada PDF').fill('1-5')
  await expect(tool).toContainText('tiene 3 páginas')
  await expect(tool.getByRole('button', { name: 'Dividir PDF' })).toBeDisabled()
  await tool.getByLabel('Páginas de cada PDF').fill('1-2, 3')
  await tool.getByRole('button', { name: 'Dividir PDF' }).click()
  await expect(results.locator('li')).toHaveCount(2)
  await expect(results).toContainText('b-p1-2.pdf')
  await expect(results).toContainText('b-p3.pdf')

  // Comprimir pintando las páginas con pdf.js (sin workers ni eval) y exportar.
  const out = join(parent, 'comprimido.pdf')
  await stubSaveDialog(ctx.app, out)
  await tool.getByRole('button', { name: 'Comprimir', exact: true }).click()
  await input.setInputFiles(join(fixtures, 'a.pdf'))
  await tool.getByLabel('Compresión').selectOption('fuerte')
  await tool.getByLabel('Exportar a una carpeta').check()
  await tool.getByRole('button', { name: 'Comprimir PDF' }).click()
  await expect(results).toContainText('Exportado', { timeout: 20_000 })
  const saved = await PDFDocument.load(readFileSync(out))
  expect(saved.getPageCount()).toBe(2)
  await shot('51-herramientas-pdf')
})

test('vídeo: convertir a 1:1 con FFmpeg', async () => {
  test.skip(!existsSync(FFMPEG), 'FFmpeg no está descargado')
  const src = join(fixtures, 'anuncio.mp4')
  execFileSync(FFMPEG, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc=duration=2:size=320x180:rate=15',
    '-c:v',
    'libx264',
    src,
  ])
  await page.getByTestId('tools-tab-video').click()
  const tool = page.getByTestId('tool-video')
  await tool.getByTestId('video-drop').locator('input[type=file]').setInputFiles(src)
  await expect(tool.getByTestId('video-info')).toContainText('320 × 180 px')
  await expect(tool.getByTestId('video-info')).toContainText('0:02')
  await tool.locator('label.tool-preset', { hasText: 'Cuadrado 1:1' }).click()
  await tool.getByLabel('Si no encaja').selectOption('bandas')
  await tool.getByRole('button', { name: 'Convertir vídeo' }).click()
  const results = tool.getByTestId('tool-results')
  await expect(results).toContainText('Guardado en Documentos', { timeout: 30_000 })
  await shot('52-herramientas-video')
  await results.getByRole('button', { name: 'Ver documento' }).click()
  await expect(page.getByTestId('page-documento')).toBeVisible()
  await expect(page.getByTestId('record-panel')).toContainText('anuncio-1x1.mp4')
})

test('los resultados guardados están en Documentos', async () => {
  await page.getByTestId('nav-documentos').click()
  const docs = page.getByTestId('page-documento')
  for (const name of ['foto.webp', 'b-unido.pdf', 'b-p1-2.pdf', 'b-p3.pdf'])
    await expect(docs).toContainText(name)
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
