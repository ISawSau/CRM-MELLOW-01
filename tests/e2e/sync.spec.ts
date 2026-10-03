import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectConsoleErrors,
  createVaultAndEnter,
  launchApp,
  stubFolderPicker,
  type Launched,
} from './app'

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
let remote: string
const shots = process.env['E2E_SHOTS']

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

const generation = () =>
  (JSON.parse(readFileSync(join(remote, 'sync.json'), 'utf8')) as { generation: number }).generation

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-sync-'))
  remote = mkdtempSync(join(tmpdir(), 'crm-e2e-destino-'))
  ctx = await launchApp()
  page = ctx.page
  errors = collectConsoleErrors(page)
  await createVaultAndEnter(ctx, parent)
})

test.afterAll(async () => {
  await ctx.close()
  rmSync(parent, { recursive: true, force: true })
  rmSync(remote, { recursive: true, force: true })
})

test.describe.configure({ mode: 'serial' })

test('conectar una carpeta sube la bóveda cifrada', async () => {
  await expect(page.getByTestId('sync-status')).toContainText('no configurada')
  await page.getByTestId('nav-ajustes').click()
  await stubFolderPicker(ctx.app, remote)
  await page.getByTestId('sync-settings').getByTestId('sync-folder').click()
  await expect(page.getByTestId('sync-settings')).toContainText(remote)
  await expect(page.getByTestId('sync-status')).toContainText('sincronizado')
  expect(existsSync(join(remote, 'crm.db'))).toBe(true)
  expect(generation()).toBe(1)
  // Lo subido está cifrado.
  expect(readFileSync(join(remote, 'crm.db')).subarray(0, 16).toString('latin1')).not.toContain(
    'SQLite format',
  )
  await shot('40-sincronizacion')
})

test('los cambios quedan pendientes y se suben con la barra de estado', async () => {
  await page.getByTestId('nav-notas').click()
  await page.getByTestId('new-record').click()
  await page.getByTestId('record-panel').locator('#panel-title').fill('Nota para subir')
  await page.getByTestId('record-panel').locator('#panel-title').press('Enter')
  await expect(page.getByTestId('sync-status')).toContainText('cambios sin subir')
  await page.getByTestId('sync-status').click()
  await expect(page.getByTestId('sync-status')).toContainText('sincronizado')
  expect(generation()).toBe(2)
})

test('copia de seguridad manual y restaurarla', async () => {
  await page.getByTestId('nav-ajustes').click()
  await page.getByTestId('backup-now').click()
  const list = page.getByTestId('backup-list')
  await expect(list).toContainText('Manual')
  await expect(list.locator('li').filter({ hasText: 'Manual' })).toContainText(
    'aquí y en el destino',
  )

  // Una nota posterior a la copia desaparece al restaurarla.
  await page.getByTestId('nav-notas').click()
  await page.getByTestId('new-record').click()
  await page.getByTestId('record-panel').locator('#panel-title').fill('Posterior a la copia')
  await page.getByTestId('record-panel').locator('#panel-title').press('Enter')
  await expect(page.getByTestId('table-row')).toHaveCount(2)
  await page.getByTestId('nav-ajustes').click()
  await list
    .locator('li')
    .filter({ hasText: 'Manual' })
    .getByRole('button', { name: 'Restaurar' })
    .click()
  await page.getByTestId('confirm-restore').click()
  await expect(page.getByTestId('toast')).toContainText('Copia restaurada')
  await page.getByTestId('nav-notas').click()
  await expect(page.getByTestId('table-row')).toHaveCount(1)
  await expect(page.getByTestId('table-row')).toContainText('Nota para subir')
  await shot('41-copias')
})

test('al bloquear se sube lo pendiente', async () => {
  const before = generation()
  await page.getByTestId('sidebar-lock').click()
  await expect(page.getByTestId('unlock-name')).toBeVisible()
  expect(generation()).toBe(before + 1)
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
