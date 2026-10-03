import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GOOD_TOKEN, type FakeMeta } from '../unit/meta-fake'
import { startFakeMeta } from './fake-meta-server'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'

/**
 * Campañas (Meta en solo lectura) contra una API de Meta falsa servida en local:
 * la app apunta a ella con CRM_TEST_GRAPH_URL, que solo se acepta sin empaquetar.
 */

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
let closeServer: () => void
let fake: FakeMeta
const shots = process.env['E2E_SHOTS']

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

const panel = () => page.getByTestId('record-panel')

test.beforeAll(async () => {
  const srv = await startFakeMeta()
  fake = srv.fake
  closeServer = srv.close
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-meta-'))
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

test('conectar con un token: el malo se rechaza y el bueno lista las cuentas', async () => {
  // Un cliente al que asignar la cuenta.
  await page.getByTestId('nav-clientes').click()
  await page.getByTestId('new-record').click()
  await panel().locator('#panel-title').fill('Acme Moda')
  await panel().locator('#panel-title').press('Enter')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()

  await page.getByTestId('nav-campanas').click()
  const form = page.getByTestId('meta-connect')
  await expect(form).toBeVisible()
  const connect = form.getByRole('button', { name: 'Conectar' })
  await form.getByLabel('Token del usuario del sistema').fill('corto')
  await expect(connect).toBeDisabled()
  await form.getByLabel('Token del usuario del sistema').fill('x'.repeat(40))
  await connect.click()
  await expect(form.getByRole('alert')).toContainText('caducado')
  await shot('30-meta-conectar')

  await form.getByLabel('Token del usuario del sistema').fill(GOOD_TOKEN)
  await connect.click()
  await expect(page.getByTestId('meta-tab-rendimiento')).toBeVisible()
  await expect(page.getByText('Ninguna cuenta activada')).toBeVisible()
  await page.getByRole('button', { name: 'Elegir cuentas' }).click()
  await expect(page.getByTestId('meta-account')).toContainText('Tienda Demo')
  await expect(page.getByTestId('meta-account')).toContainText('USD · America/New_York')
})

test('activar la cuenta: últimos 30 días, histórico en segundo plano y cliente', async () => {
  const account = page.getByTestId('meta-account')
  await account.getByLabel('Cliente').selectOption({ label: 'Acme Moda' })
  // El estado sale de la caché de datos, que avisa a la interfaz un instante después.
  const sync = account.getByRole('checkbox', { name: 'Sincronizar Tienda Demo' })
  await sync.click()
  await expect(sync).toBeChecked()
  await expect(account).toContainText('Histórico completo', { timeout: 30_000 })
  await expect(account).toContainText('Datos del 10/05/2026')
  await expect(page.getByTestId('meta-status')).toContainText('Meta al día')
  await shot('31-meta-cuentas')
  // Solo lectura: ninguna escritura salvo los informes asíncronos de Insights.
  for (const r of fake.requests) if (r.method !== 'GET') expect(r.path).toBe('act_111/insights')
})

test('rendimiento: KPIs, tabla con totales y navegación hasta el anuncio', async () => {
  await page.getByTestId('meta-tab-rendimiento').click()
  await expect(page.getByTestId('meta-kpis')).toContainText('Importe gastado')
  await expect(page.getByTestId('meta-kpis')).toContainText('€')
  const table = page.getByTestId('meta-table')
  await expect(table.getByTestId('meta-row')).toHaveCount(1)
  await expect(table.getByTestId('meta-row')).toContainText('Prospecting')
  await expect(table.getByTestId('meta-row')).toContainText('Activa')
  await expect(table.getByTestId('meta-totals')).toContainText('Total (1)')
  await shot('32-meta-rendimiento')

  await table.getByRole('button', { name: 'Prospecting' }).click()
  await expect(table.getByTestId('meta-row')).toContainText('Broad ES')
  await table.getByRole('button', { name: 'Broad ES' }).click()
  await expect(table.getByTestId('meta-row')).toContainText('Vídeo UGC')
  // La miniatura se descargó, se guardó cifrada y se ve por vault://.
  const thumb = table.locator('img.meta-thumb')
  await expect(thumb).toHaveCount(1)
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0)
  await page.getByRole('navigation', { name: 'Nivel' }).getByText('Campañas').click()
  await expect(table.getByTestId('meta-row')).toContainText('Prospecting')

  await page.getByLabel('Periodo', { exact: true }).selectOption('custom')
  await page.getByLabel('Desde').fill('2026-06-01')
  await page.getByLabel('Hasta').fill('2026-06-30')
  await expect(table.getByTestId('meta-totals')).toBeVisible()
})

test('ajustes: ver los importes en dólares', async () => {
  await page.getByTestId('meta-tab-ajustes').click()
  await page.getByLabel('Moneda en la que ver los importes').selectOption('USD')
  await page.getByLabel('Ventana de atribución').selectOption('14')
  await page.getByTestId('meta-tab-rendimiento').click()
  await expect(page.getByTestId('meta-kpis')).toContainText('US$')
})

test('la ficha del cliente muestra su cuenta publicitaria', async () => {
  await page.getByTestId('nav-clientes').click()
  await page.getByTestId('table-row').filter({ hasText: 'Acme Moda' }).locator('.grid-open').click()
  await expect(panel().getByTestId('client-ad-accounts')).toContainText('Tienda Demo')
  await shot('33-meta-cliente')
})

test('métrica propia con fórmula y columnas personalizadas con formato condicional', async () => {
  await page.getByTestId('nav-campanas').click()
  await page.getByTestId('meta-tab-ajustes').click()
  await page.getByRole('button', { name: '+ Métrica' }).click()
  const dlg = page.getByTestId('metric-dialog')
  await dlg.getByLabel('Nombre').fill('Beneficio')
  await dlg.getByLabel('Fórmula').fill('valor_compras - gastos')
  await expect(dlg).toContainText('No existe ninguna métrica «gastos»')
  await expect(dlg.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  await dlg.getByLabel('Fórmula').fill('valor_compras - gasto')
  await dlg.getByLabel('Formato').selectOption('currency')
  await dlg.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByTestId('custom-metrics')).toContainText(
    'beneficio = valor_compras - gasto',
  )

  await page.getByTestId('meta-tab-rendimiento').click()
  await page.getByTestId('edit-columns').click()
  const cols = page.getByTestId('columns-dialog')
  await cols.getByLabel('Nombre del preset').fill('Mi preset')
  await cols.getByLabel('Buscar columna').fill('benef')
  await cols.getByRole('button', { name: '+ Beneficio' }).click()
  await cols.getByLabel('Buscar columna').fill('hook')
  await cols.getByRole('button', { name: '+ Hook rate' }).click()
  await expect(cols.getByTestId('chosen-columns')).toContainText('Hook rate')
  await cols.getByRole('button', { name: '+ Regla' }).click()
  await cols.getByLabel('Columna de la regla').selectOption({ label: 'ROAS de compra' })
  await cols.getByRole('textbox', { name: 'Valor', exact: true }).fill('1')
  await shot('34-meta-columnas')
  await cols.getByRole('button', { name: 'Guardar como preset nuevo' }).click()
  await expect(cols).toBeHidden()
  await expect(page.getByLabel('Columnas', { exact: true })).toHaveValue(/^p-/)
  const table = page.getByTestId('meta-table')
  await expect(table.locator('thead')).toContainText('Beneficio')
  await expect(table.locator('thead')).toContainText('Hook rate')
  // ROAS > 1: la celda sale coloreada.
  await expect(table.locator('tbody td[data-color="verde"]')).toHaveCount(1)
  // Ordenar por una columna.
  await table.getByRole('button', { name: 'Importe gastado' }).click()
  await expect(table.locator('th[aria-sort="descending"]')).toContainText('Importe gastado')
  await page.getByLabel('Comparar con el periodo anterior').check()
  await expect(table.getByTestId('meta-row').locator('.cell-delta').first()).toContainText('%')
  await shot('35-meta-tabla')
})

test('desglose por edad y alcance del periodo', async () => {
  await page.getByTestId('meta-tab-cuentas').click()
  const account = page.getByTestId('meta-account')
  await account.getByText('Desgloses', { exact: true }).click()
  await account.getByLabel('Edad en campañas').check()
  await expect(account.getByRole('button', { name: 'Guardar desgloses' })).toBeEnabled()
  await account.getByRole('button', { name: 'Guardar desgloses' }).click()
  await expect(account).toContainText('Histórico completo', { timeout: 30_000 })
  await page.getByTestId('meta-tab-rendimiento').click()
  await page.getByLabel('Desglose', { exact: true }).selectOption({ label: 'Edad' })
  const table = page.getByTestId('meta-table')
  await expect(table.getByTestId('meta-breakdown-row')).toHaveCount(2)
  await expect(table.getByTestId('meta-breakdown-row').first()).toContainText(/18-24|25-34/)
  await page.getByLabel('Desglose', { exact: true }).selectOption('')

  // El preset de entrega usa el alcance: se pide a Meta para el periodo.
  await page
    .getByLabel('Columnas', { exact: true })
    .selectOption({ label: 'Entrega y configuración' })
  await expect(table.locator('thead')).toContainText('Alcance')
  // Frecuencia del periodo (alcance = impresiones / 2,5 en la API falsa).
  await expect(table.getByTestId('meta-totals')).toContainText('2,50', { timeout: 10_000 })
  await shot('36-meta-entrega')
})

test('vincular una creatividad por su código y ver su rendimiento', async () => {
  await page.getByTestId('nav-creatividades').click()
  await page.getByTestId('new-record').click()
  await panel().locator('#panel-title').fill('UGC verano')
  await panel().locator('#panel-title').press('Enter')
  await panel().getByRole('textbox', { name: 'Código' }).fill('UGC')
  await panel().getByRole('textbox', { name: 'Código' }).press('Enter')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()

  await page.getByTestId('nav-campanas').click()
  await page.getByTestId('meta-tab-ajustes').click()
  await page.getByRole('button', { name: 'Vincular ahora' }).click()
  await expect(page.getByTestId('toast')).toContainText('1 vínculo nuevo')

  await page.getByTestId('meta-tab-creatividades').click()
  await page.getByLabel('Agrupar por').selectOption({ label: 'Formato' })
  await expect(page.getByTestId('creative-ranking')).toContainText('UGC verano')
  await shot('37-meta-creatividades')
  await page.getByTestId('creative-ranking').getByRole('button', { name: 'UGC verano' }).click()
  const ads = panel().getByTestId('creative-ads')
  await expect(ads).toContainText('Vídeo UGC')
  await expect(ads.getByTestId('creative-kpis')).toContainText('Importe gastado')
  // Desvincular y volver a vincular a mano buscando el anuncio.
  await ads.getByRole('button', { name: 'Desvincular Vídeo UGC' }).click()
  await expect(ads).toContainText('Ningún anuncio vinculado')
  await ads.getByLabel('Buscar anuncio').fill('vídeo')
  await ads.getByRole('button', { name: '+ Vídeo UGC' }).click()
  await expect(ads.locator('.linked-ads')).toContainText('Vídeo UGC')
  await shot('38-meta-ficha-creatividad')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
