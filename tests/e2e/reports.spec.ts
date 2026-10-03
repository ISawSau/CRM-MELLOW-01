import { expect, test, type Page } from '@playwright/test'
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { GOOD_TOKEN } from '../unit/meta-fake'
import {
  collectConsoleErrors,
  createVaultAndEnter,
  launchApp,
  stubSaveDialog,
  type Launched,
} from './app'
import { startFakeMeta } from './fake-meta-server'

/** Informes en PDF sobre la API de Meta falsa: generar, vista previa y plantillas. */

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
let closeServer: () => void
const shots = process.env['E2E_SHOTS']

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

test.beforeAll(async () => {
  const srv = await startFakeMeta()
  closeServer = srv.close
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-informes-'))
  ctx = await launchApp([], undefined, srv.env)
  page = ctx.page
  errors = collectConsoleErrors(page)
  await createVaultAndEnter(ctx, parent)

  await page.getByTestId('nav-campanas').click()
  await page.getByLabel('Token del usuario del sistema').fill(GOOD_TOKEN)
  await page.getByRole('button', { name: 'Conectar' }).click()
  await page.getByTestId('meta-tab-cuentas').click()
  const sync = page.getByRole('checkbox', { name: 'Sincronizar Tienda Demo' })
  await sync.click()
  await expect(sync).toBeChecked()
  await expect(page.getByTestId('meta-account')).toContainText('Histórico completo', {
    timeout: 30_000,
  })
})

test.afterAll(async () => {
  await ctx.close()
  closeServer()
  rmSync(parent, { recursive: true, force: true })
})

test.describe.configure({ mode: 'serial' })

test('generar el informe del mes pasado, verlo y exportarlo', async () => {
  const out = join(parent, 'informe.pdf')
  await stubSaveDialog(ctx.app, out)
  await page.getByTestId('nav-informes').click()
  const form = page.getByTestId('page-informes')
  await form.getByLabel('Periodo', { exact: true }).selectOption('30d')
  await form
    .getByLabel('Comentarios del periodo')
    .fill('Mes de pruebas.\n\nSeguimos con el ángulo B.')
  await form.getByLabel('Exportar también a una carpeta').check()
  await form.getByRole('button', { name: 'Generar informe' }).click()
  const result = page.getByTestId('report-result')
  await expect(result).toContainText('guardado en Documentos y exportado', { timeout: 30_000 })
  await expect(result.getByTestId('pdf-preview').locator('img').first()).toBeVisible({
    timeout: 20_000,
  })
  await shot('53-informes')

  if (shots) copyFileSync(out, join(shots, '53-informe.pdf'))
  // Un PDF A4 de verdad, con portada y contenido.
  const pdf = await PDFDocument.load(readFileSync(out))
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2)
  const { width, height } = pdf.getPage(0).getSize()
  expect(Math.round(width)).toBe(595)
  expect(Math.round(height)).toBe(842)

  await result.getByRole('button', { name: 'Ver documento' }).click()
  await expect(page.getByTestId('record-panel')).toContainText('Informe general')
})

test('editar una plantilla: quitar y añadir bloques', async () => {
  await page.getByTestId('nav-informes').click()
  await page.getByTestId('reports-tab-plantillas').click()
  const ed = page.getByTestId('template-editor')
  await expect(ed.getByTestId('report-block')).toHaveCount(7)
  await ed.getByRole('button', { name: 'Quitar Comparativa de periodos' }).click()
  await ed.getByLabel('Añadir bloque').selectOption('texto')
  await ed.getByRole('button', { name: '+ Bloque' }).click()
  await expect(ed.getByTestId('report-block')).toHaveCount(7)
  await ed
    .getByTestId('report-block')
    .last()
    .getByRole('textbox', { name: 'Texto' })
    .fill('Gracias por confiar en nosotros.')
  await ed.getByLabel('Nombre', { exact: true }).fill('Mensual corto')
  await ed.getByRole('button', { name: 'Guardar plantillas' }).click()
  await expect(page.getByTestId('toast')).toContainText('Plantillas guardadas')
  await shot('54-informes-plantillas')

  await page.getByTestId('reports-tab-generar').click()
  await expect(page.getByLabel('Plantilla', { exact: true })).toContainText('Mensual corto')
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
