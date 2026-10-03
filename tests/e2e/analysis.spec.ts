import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GOOD_TOKEN } from '../unit/meta-fake'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'
import { startFakeMeta } from './fake-meta-server'

/** Análisis: dashboards, comparativas y alertas sobre la API de Meta falsa. */

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
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-analisis-'))
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

test('sin Meta, Análisis e Inicio invitan a conectar', async () => {
  await page.getByTestId('nav-analisis').click()
  await expect(page.getByTestId('page-analisis')).toContainText('Sin datos publicitarios')
  await page.getByTestId('nav-inicio').click()
  await expect(page.getByTestId('home-spend')).toContainText('Conecta Meta en Campañas')
})

test('dashboard general con KPIs, gráficas, ranking y tabla', async () => {
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

  await page.getByTestId('nav-analisis').click()
  const dash = page.getByTestId('dashboards')
  await expect(dash.getByTestId('widget')).toHaveCount(8)
  const kpi = dash.getByTestId('widget').first()
  await expect(kpi).toContainText('Importe gastado')
  await expect(kpi).toContainText('€')
  await expect(kpi).toContainText('vs. periodo anterior')
  await expect(dash.getByTestId('chart')).toHaveCount(2)
  await expect(dash.getByTestId('widget-ranking')).toContainText('Prospecting')
  await expect(dash.locator('table')).toContainText('Tienda Demo')
  // Las gráficas se pintan en canvas.
  await expect(dash.getByTestId('chart').first().locator('canvas')).toHaveCount(1)
  await shot('40-analisis-dashboard')

  // Toda gráfica tiene su vista de tabla.
  // El quinto widget del dashboard general es la evolución del gasto.
  const line = dash.getByTestId('widget').nth(4)
  await expect(line.getByTestId('chart')).toBeVisible()
  await line.getByRole('button', { name: 'Ver tabla' }).click()
  await expect(line.locator('table tbody tr').first()).toBeVisible()
  await line.getByRole('button', { name: 'Ver gráfica' }).click()
  await expect(line.getByTestId('chart')).toBeVisible()
})

test('editar el dashboard: añadir y quitar widgets', async () => {
  const dash = page.getByTestId('dashboards')
  await dash.getByRole('button', { name: 'Editar' }).click()
  await dash.getByRole('button', { name: '+ Widget' }).click()
  const dlg = page.getByTestId('widget-dialog')
  await dlg.getByLabel('Tipo').selectOption('bar')
  await dlg.getByLabel('Métrica').selectOption('compras')
  await dlg.getByLabel('Agrupar por').selectOption('campana')
  await dlg.getByLabel('Título (opcional)').fill('Compras por campaña')
  await dlg.getByRole('button', { name: 'Guardar' }).click()
  await expect(dash.getByTestId('widget')).toHaveCount(9)
  await expect(dash.getByTestId('widget').last()).toContainText('Compras por campaña')
  await dash.getByRole('button', { name: 'Quitar Compras por campaña' }).click()
  await expect(dash.getByTestId('widget')).toHaveCount(8)
  await dash.getByRole('button', { name: 'Listo' }).click()
})

test('comparar periodos y avisar cuando no hay dos con datos', async () => {
  await page.getByTestId('analysis-tab-comparar').click()
  const cmp = page.getByTestId('compare')
  await expect(cmp.getByTestId('compare-table')).toContainText('Importe gastado')
  await expect(cmp.getByTestId('chart')).toHaveCount(1)
  await cmp.getByLabel('Frente a', { exact: true }).selectOption('year')
  await expect(cmp.getByTestId('compare-table').locator('thead')).toContainText('2025')
  await shot('41-analisis-comparar')
  await cmp.getByLabel('Comparar', { exact: true }).selectOption('cuenta')
  await expect(cmp).toContainText('Hacen falta al menos dos')
})

test('una alerta que se cumple avisa en Análisis, la barra lateral e Inicio', async () => {
  await page.getByTestId('analysis-tab-alertas').click()
  const alerts = page.getByTestId('alerts')
  await alerts.getByRole('button', { name: '+ Alerta' }).click()
  const dlg = page.getByTestId('alert-dialog')
  await dlg.getByLabel('Nombre').fill('CPA alto')
  await dlg.getByLabel('Métrica').selectOption('cpa')
  await dlg.getByLabel('Umbral').fill('abc')
  await expect(dlg.getByRole('button', { name: 'Guardar' })).toBeDisabled()
  await dlg.getByLabel('Umbral').fill('1,5')
  await dlg.getByRole('button', { name: 'Guardar' }).click()
  await expect(alerts.getByTestId('alert-list')).toContainText('CPA alto')
  await expect(alerts.getByTestId('alert-events')).toContainText('CPA alto')
  await shot('42-analisis-alertas')

  await page.getByTestId('nav-inicio').click()
  await expect(page.getByTestId('home-alerts')).toContainText('CPA alto')
  await expect(page.getByTestId('home-spend')).toContainText('ROAS 30 días')
  await expect(page.getByTestId('home-spend')).not.toContainText('Conecta Meta en Campañas')
  await shot('43-inicio-meta')
})

test('sin errores de consola ni de la CSP (también con las gráficas)', () => {
  expect(errors).toEqual([])
})
