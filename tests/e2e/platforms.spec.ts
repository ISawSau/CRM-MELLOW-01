import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectConsoleErrors,
  createVaultAndEnter,
  launchApp,
  todayMadrid,
  type Launched,
} from './app'
import { startFakeLinkedIn } from './fake-linkedin-server'

/** LinkedIn y X: importar un CSV, conectar la API de LinkedIn (falsa) y verlo en Inicio. */

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
let closeServer: () => void
const shots = process.env['E2E_SHOTS']

const shift = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const today = todayMadrid()
const d1 = shift(today, -3)
const d2 = shift(today, -2)
const liFrom = shift(today, -20)

/** Exportación de X Ads en español: punto y coma, coma decimal y miles con punto. */
const X_CSV = `Fecha;Nombre de la campaña;Importe gastado;Impresiones;Clics en el enlace;Conversiones
${dmy(d1)};Retargeting;12,50 €;3.000;45;2
${dmy(d2)};Retargeting;7,50 €;2.000;30;1
${dmy(d2)};Prospecting;20,00 €;8.000;60;0
`

test.beforeAll(async () => {
  const srv = await startFakeLinkedIn(liFrom)
  closeServer = srv.close
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-plataformas-'))
  ctx = await launchApp([], undefined, srv.env)
  page = ctx.page
  errors = collectConsoleErrors(page)
  await createVaultAndEnter(ctx, parent)
})

test.afterAll(async () => {
  await ctx.close()
  closeServer()
  rmSync(parent, { recursive: true, force: true })
})

test.describe.configure({ mode: 'serial' })

const panel = () => page.getByTestId('record-panel')
const plat = () => page.getByTestId('page-plataformas')

test('sin cuentas, Inicio y Análisis invitan a conectar o importar', async () => {
  await page.getByTestId('nav-inicio').click()
  await expect(page.getByTestId('home-spend')).toContainText('importa LinkedIn o X')
  await page.getByTestId('nav-analisis').click()
  await expect(page.getByTestId('page-analisis')).toContainText('Sin datos publicitarios')
  // Un cliente al que asignar después las cuentas.
  await page.getByTestId('nav-clientes').click()
  await page.getByTestId('new-record').click()
  await panel().locator('#panel-title').fill('Acme')
  await panel().locator('#panel-title').press('Enter')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('importar un CSV de X con el mapeo propuesto', async () => {
  await page.getByTestId('nav-plataformas').click()
  const imp = plat().getByTestId('import-csv')
  await expect(imp).toBeVisible()
  await imp.getByLabel('Plataforma').selectOption('x')
  await imp
    .getByTestId('csv-drop')
    .locator('input[type=file]')
    .setInputFiles({ name: 'x-ads.csv', mimeType: 'text/csv', buffer: Buffer.from(X_CSV) })
  const preview = imp.getByTestId('csv-preview')
  await expect(preview).toContainText('Retargeting')
  await expect(preview).toContainText(dmy(d1))
  await expect(preview).toContainText('12,50')
  await expect(preview).toContainText('3.000')
  await expect(imp.getByLabel('Decimales')).toHaveValue(',')
  await imp.getByLabel('Nombre de la cuenta').fill('Tienda Demo')
  if (shots) await page.screenshot({ path: join(shots, '70-plataformas-importar.png') })
  await imp.getByRole('button', { name: 'Importar en X' }).click()
  await expect(imp.getByTestId('import-result')).toContainText(
    `Importados 3 días de 2 campañas, del ${dmy(d1)} al ${dmy(d2)}`,
  )
})

test('la cuenta importada se asigna a un cliente y suma en Inicio', async () => {
  await plat().getByRole('button', { name: 'Ver cuentas' }).click()
  const table = plat().getByTestId('platform-accounts')
  await expect(table).toContainText('Tienda Demo')
  await expect(table).toContainText('X · CSV')
  await expect(table).toContainText(`${dmy(d1)} – ${dmy(d2)}`)
  await table.getByLabel('Cliente de Tienda Demo').selectOption({ label: 'Acme' })
  await expect(table.getByLabel('Cliente de Tienda Demo')).not.toHaveValue('')

  await page.getByTestId('nav-inicio').click()
  const spend = page.getByTestId('home-spend')
  await expect(spend).toContainText('ROAS 30 días')
  await expect(spend).toContainText('40,00')

  await page.getByTestId('nav-clientes').click()
  await page.getByTestId('table-row').filter({ hasText: 'Acme' }).locator('.grid-open').click()
  const accounts = panel().getByTestId('client-ad-accounts')
  await expect(accounts).toContainText('Tienda Demo')
  await expect(accounts).toContainText('X (CSV) · EUR')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('LinkedIn por API: pegar un token, activar una cuenta y descargar sus métricas', async () => {
  await page.getByTestId('nav-plataformas').click()
  await plat().getByTestId('platforms-tab-linkedin').click()
  const li = plat().getByTestId('linkedin-connection')
  await expect(li).toContainText('Sin conectar')
  await li.getByRole('button', { name: 'Pegar un token' }).click()
  await li.getByLabel('Token de acceso').fill('token-linkedin')
  await li.getByRole('button', { name: 'Conectar', exact: true }).click()
  await expect(li).toContainText('LinkedIn conectado')
  await expect(li).toContainText(/quedan (59|60) días/)

  await plat().getByTestId('platforms-tab-cuentas').click()
  const table = plat().getByTestId('platform-accounts')
  await expect(table).toContainText('Acme B2B')
  await expect(table).toContainText('Acme Europa')
  // La cuenta de pruebas de LinkedIn no se trae.
  await expect(table).not.toContainText('Pruebas')
  await expect(table.getByLabel('Usar Acme B2B')).not.toBeChecked()
  await table.getByLabel('Usar Acme B2B').check()
  await expect(table.getByRole('row').filter({ hasText: 'Acme B2B' })).toContainText(
    `${dmy(liFrom)} – `,
    { timeout: 15_000 },
  )
  if (shots) await page.screenshot({ path: join(shots, '71-plataformas-cuentas.png') })
  await plat().getByTestId('platforms-tab-linkedin').click()
  await expect(li).toContainText('Última sincronización')
  if (shots) await page.screenshot({ path: join(shots, '72-linkedin.png') })
})

test('Análisis incluye LinkedIn y X sin Meta conectado', async () => {
  await page.getByTestId('nav-analisis').click()
  const a = page.getByTestId('page-analisis')
  await expect(a.getByTestId('analysis-tab-dashboards')).toBeVisible()
  await expect(a).not.toContainText('Sin datos publicitarios')
  await page.getByTestId('nav-inicio').click()
  await expect(page.getByTestId('home-spend')).not.toContainText('40,00')
  if (shots) await page.screenshot({ path: join(shots, '73-inicio-plataformas.png') })
})

test('desconectar LinkedIn', async () => {
  await page.getByTestId('nav-plataformas').click()
  await plat().getByTestId('platforms-tab-linkedin').click()
  const li = plat().getByTestId('linkedin-connection')
  await li.getByRole('button', { name: 'Desconectar' }).click()
  await expect(li).toContainText('Sin conectar')
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
