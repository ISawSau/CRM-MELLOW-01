import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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

/** sync.json del formato 2 (D-125): época e instantánea actual. */
const manifest = () =>
  JSON.parse(readFileSync(join(remote, 'sync.json'), 'utf8')) as {
    version: number
    epoch: string
    snapshot: { id: string }
  }
/** Paquetes de cambios subidos en la época actual. */
const packs = () => {
  const dir = join(remote, 'changes', manifest().epoch)
  return existsSync(dir) ? readdirSync(dir).length : 0
}

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
  // La primera vez sube la base de datos entera como instantánea; luego, solo cambios.
  expect(manifest().version).toBe(2)
  const db = join(remote, 'snapshots', manifest().snapshot.id, 'crm.db')
  expect(existsSync(db)).toBe(true)
  // Lo subido está cifrado.
  expect(readFileSync(db).subarray(0, 16).toString('latin1')).not.toContain('SQLite format')
  await shot('40-sincronizacion')
})

test('los cambios quedan pendientes y se suben con la barra de estado', async () => {
  await page.getByTestId('nav-notas').click()
  await page.getByTestId('new-record').click()
  await page.getByTestId('record-panel').locator('#panel-title').fill('Nota para subir')
  await page.getByTestId('record-panel').locator('#panel-title').press('Enter')
  // Se sube sola a los pocos segundos (o al pulsar la barra de estado): un paquete pequeño.
  await expect(page.getByTestId('sync-status')).toContainText('sincronizado', { timeout: 15_000 })
  await expect.poll(packs).toBeGreaterThan(0)
  const snapshots = readdirSync(join(remote, 'snapshots'))
  await page.getByTestId('sync-status').click()
  await expect(page.getByTestId('sync-status')).toContainText('sincronizado')
  expect(readdirSync(join(remote, 'snapshots'))).toEqual(snapshots)
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

test('al bloquear se sube lo pendiente (lo restaurado empieza otra época)', async () => {
  const before = manifest().epoch
  await page.getByTestId('sidebar-lock').click()
  await expect(page.getByTestId('unlock-name')).toBeVisible()
  expect(manifest().epoch).not.toBe(before)
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
