import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'

/** Facturación: registrar facturas y gastos y verlos en el resumen por cliente. */

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
const shots = process.env['E2E_SHOTS']

/** Hoy en Madrid, «aaaa-mm-dd». */
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date())
const firstOfMonth = `${today.slice(0, 7)}-01`

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-facturacion-'))
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

async function fill(label: string, value: string) {
  const input = panel().getByLabel(label, { exact: true })
  await input.fill(value)
  await input.press('Enter')
}

async function invoice(numero: string, values: Record<string, string>, estado: string) {
  await page.getByTestId('new-record').click()
  await panel().locator('#panel-title').fill(numero)
  await panel().locator('#panel-title').press('Enter')
  for (const [k, v] of Object.entries(values)) await fill(k, v)
  await panel().getByLabel('Estado', { exact: true }).selectOption({ label: estado })
  await expect(panel().getByLabel('Estado', { exact: true })).toHaveValue(/./)
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
}

test('registrar una factura cobrada, otra vencida y un gasto', async () => {
  await page.getByTestId('nav-facturas').click()
  await expect(page.getByTestId('page-factura')).toBeVisible()
  await invoice(
    'F-001',
    {
      'Base imponible': '1.000',
      'IVA (%)': '21',
      'Fecha de emisión': today,
      'Fecha de cobro': today,
    },
    'Cobrada',
  )
  await invoice(
    'F-002',
    {
      'Base imponible': '500',
      'IVA (%)': '21',
      'Fecha de emisión': firstOfMonth,
      Vencimiento: '2020-01-31',
    },
    'Pendiente',
  )
  await expect(page.getByTestId('page-factura')).toContainText('1.210')

  await page.getByTestId('nav-gastos').click()
  await page.getByTestId('new-record').click()
  await panel().locator('#panel-title').fill('Editor de vídeo')
  await panel().locator('#panel-title').press('Enter')
  await fill('Importe', '200')
  await fill('Fecha', today)
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('el resumen de facturación suma por cliente y lista las vencidas', async () => {
  await page.getByTestId('nav-facturacion').click()
  const kpis = page.getByTestId('billing-kpis')
  await expect(kpis).toContainText('1.815,00 €')
  await expect(kpis).toContainText('1.210,00 €')
  await expect(kpis).toContainText('605,00 € vencido')
  // Beneficio: cobrado − gastos.
  await expect(kpis).toContainText('1.010,00 €')
  await expect(page.getByTestId('billing-table')).toContainText('Sin cliente')
  await expect(page.getByTestId('overdue')).toContainText('F-002')
  if (shots) await page.screenshot({ path: join(shots, '55-facturacion.png') })
  await page.getByTestId('overdue').getByRole('button', { name: 'F-002' }).click()
  await expect(page.getByTestId('page-factura')).toBeVisible()
  await expect(panel().locator('#panel-title')).toHaveValue('F-002')
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
