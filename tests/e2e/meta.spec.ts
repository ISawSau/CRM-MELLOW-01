import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FakeMeta, GOOD_TOKEN } from '../unit/meta-fake'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'

/**
 * Campañas (Meta en solo lectura) contra una API de Meta falsa servida en local:
 * la app apunta a ella con CRM_TEST_GRAPH_URL, que solo se acepta sin empaquetar.
 */

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
let server: Server
let fake: FakeMeta
const shots = process.env['E2E_SHOTS']

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

const panel = () => page.getByTestId('record-panel')

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString()
      const headers: Record<string, string> = {}
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v
      void fake
        .fetch(`${fake.base}${req.url}`, {
          method: req.method ?? 'GET',
          headers,
          ...(body ? { body: new URLSearchParams(body) } : {}),
        })
        .then(async (r) => {
          res.writeHead(r.status, Object.fromEntries(r.headers))
          res.end(Buffer.from(await r.arrayBuffer()))
        })
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  fake = new FakeMeta({}, base)
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-meta-'))
  ctx = await launchApp([], undefined, {
    CRM_TEST_GRAPH_URL: base,
    CRM_TEST_ECB_URL: `${base}/ecb`,
    CRM_TEST_META_POLL_MS: '10',
  })
  page = ctx.page
  errors = collectConsoleErrors(page)
  await createVaultAndEnter(ctx, parent)
})

test.afterAll(async () => {
  await ctx.close()
  server.close()
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
  await account.getByRole('checkbox', { name: 'Sincronizar Tienda Demo' }).check()
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

  await page.getByLabel('Periodo').selectOption('custom')
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

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
