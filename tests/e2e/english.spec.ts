import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'

/** La interfaz en inglés: se elige en la pantalla de acceso y se recuerda al reabrir. */

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
const shots = process.env['E2E_SHOTS']

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-ingles-'))
  ctx = await launchApp()
  page = ctx.page
  errors = collectConsoleErrors(page)
})

test.afterAll(async () => {
  await ctx.close()
  rmSync(parent, { recursive: true, force: true })
})

test.describe.configure({ mode: 'serial' })

test('elegir inglés en la pantalla de bienvenida', async () => {
  await expect(page.getByTestId('welcome-create')).toContainText('Crear bóveda nueva')
  await page.getByTestId('language-en').click()
  await expect(page.getByTestId('welcome-create')).toContainText('Create a new vault')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  if (shots) await page.screenshot({ path: join(shots, '95-en-bienvenida.png') })
  await createVaultAndEnter(ctx, parent)
})

test('la app en inglés: secciones, entidades, campos y formatos británicos', async () => {
  const nav = page.locator('.sidebar')
  for (const label of [
    'Profile',
    'Home',
    'Notes',
    'Clients',
    'Contacts',
    'Tasks',
    'Campaigns',
    'Analytics',
    'Billing',
    'Settings',
    'Trash',
  ])
    await expect(nav).toContainText(label)
  await page.getByTestId('nav-clientes').click()
  await expect(page.getByTestId('new-record')).toContainText('client')
  await page.getByTestId('new-record').click()
  const panel = page.getByTestId('record-panel')
  await panel.locator('#panel-title').fill('Acme')
  await panel.locator('#panel-title').press('Enter')
  // Las etapas de serie del pipeline se ven traducidas (en la bóveda siguen en español).
  await expect(panel).toContainText('Prospect')
  if (shots) await page.screenshot({ path: join(shots, '96-en-cliente.png') })
  await panel.getByRole('button', { name: 'Close record' }).click()

  await page.getByTestId('nav-inicio').click()
  await expect(page.getByTestId('home-kpis')).toContainText('€0.00')
  if (shots) await page.screenshot({ path: join(shots, '97-en-inicio.png') })
  await page.getByTestId('nav-campanas').click()
  if (shots) await page.screenshot({ path: join(shots, '98-en-campanas.png') })
  await page.getByTestId('nav-ajustes').click()
  await expect(page.getByTestId('page-ajustes')).toContainText('Appearance')
  if (shots) await page.screenshot({ path: join(shots, '99-en-ajustes.png') })
})

test('volver al español desde Ajustes', async () => {
  await page.getByTestId('language-es').click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'es')
  await expect(page.getByTestId('page-ajustes')).toContainText('Apariencia')
  await page.getByTestId('nav-clientes').click()
  await expect(page.getByTestId('table-row')).toContainText('Prospecto')
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
