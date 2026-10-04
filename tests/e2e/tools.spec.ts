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

/** TIFF RGB sin comprimir, de un color. */
function tiff(w: number, h: number): Buffer {
  const entries: [number, number, number, number][] = [
    [256, 3, 1, w],
    [257, 3, 1, h],
    [258, 3, 3, 122],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, 128],
    [277, 3, 1, 3],
    [278, 3, 1, h],
    [279, 4, 1, w * h * 3],
  ]
  const head = Buffer.alloc(128)
  head.write('II', 0, 'ascii')
  head.writeUInt16LE(42, 2)
  head.writeUInt32LE(8, 4)
  head.writeUInt16LE(entries.length, 8)
  entries.forEach(([tag, type, count, value], i) => {
    const o = 10 + i * 12
    head.writeUInt16LE(tag, o)
    head.writeUInt16LE(type, o + 2)
    head.writeUInt32LE(count, o + 4)
    if (type === 3 && count === 1) head.writeUInt16LE(value, o + 8)
    else head.writeUInt32LE(value, o + 8)
  })
  for (let i = 0; i < 3; i++) head.writeUInt16LE(8, 122 + i * 2)
  return Buffer.concat([head, Buffer.alloc(w * h * 3, 0x40)])
}

/** BMP de 24 bits, de un color. */
function bmp(w: number, h: number): Buffer {
  const row = Math.ceil((w * 3) / 4) * 4
  const out = Buffer.alloc(54 + row * h, 0x60)
  out.write('BM', 0, 'ascii')
  out.writeUInt32LE(out.length, 2)
  out.writeUInt32LE(54, 10)
  out.writeUInt32LE(40, 14)
  out.writeInt32LE(w, 18)
  out.writeInt32LE(h, 22)
  out.writeUInt16LE(1, 26)
  out.writeUInt16LE(24, 28)
  out.writeUInt32LE(0, 30)
  return out
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
  writeFileSync(join(fixtures, 'escaneo.tif'), tiff(40, 30))
  writeFileSync(join(fixtures, 'captura.bmp'), bmp(50, 20))
  writeFileSync(
    join(fixtures, 'logo.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><rect width="64" height="32" fill="#e0a47c"/></svg>',
  )
  writeFileSync(join(fixtures, 'rota.heic'), Buffer.from('esto no es una foto HEIC'))
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

test('imágenes: lee TIFF, BMP y SVG, y avisa si una foto HEIC está dañada', async () => {
  const tool = page.getByTestId('tool-imagenes')
  await tool
    .getByTestId('image-drop')
    .locator('input[type=file]')
    .setInputFiles(
      ['escaneo.tif', 'captura.bmp', 'logo.svg', 'rota.heic'].map((f) => join(fixtures, f)),
    )
  await tool.getByLabel('Formato').selectOption('mismo')
  await tool.getByLabel('Ancho máximo (px)').fill('')
  await tool.getByRole('button', { name: /^Procesar/ }).click()
  const results = tool.getByTestId('tool-results')
  await expect(results).toContainText('escaneo.png')
  await expect(results).toContainText('40 × 30 px')
  await expect(results).toContainText('captura.png')
  await expect(results).toContainText('50 × 20 px')
  await expect(results).toContainText('logo.png')
  await expect(results).toContainText('64 × 32 px')
  await expect(results).toContainText('No se ha podido leer la foto HEIC')
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
