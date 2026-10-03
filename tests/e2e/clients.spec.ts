import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectConsoleErrors, createVaultAndEnter, drag, launchApp, type Launched } from './app'

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
const shots = process.env['E2E_SHOTS']

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-clientes-'))
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

test('perfil: nombre y zona horaria', async () => {
  await page.getByTestId('nav-ajustes').click()
  const form = page.getByTestId('profile-form')
  await form.getByLabel('Tu nombre').fill('Joan Mellow')
  await form.getByLabel('NIF / CIF').fill('B12345678')
  await expect(form.getByLabel('Zona horaria')).toHaveValue('Europe/Madrid')
  await form.getByRole('button', { name: 'Guardar perfil' }).click()
  await expect(page.getByTestId('toast')).toContainText('Perfil guardado')
  await shot('10-perfil')
})

test('crear un cliente, su contacto y navegar entre fichas', async () => {
  await page.getByTestId('nav-clientes').click()
  await expect(page.getByTestId('page-cliente')).toBeVisible()
  await page.getByTestId('new-record').click()
  await panel().locator('#panel-title').fill('Acme Moda')
  await panel().locator('#panel-title').press('Enter')
  await panel().getByLabel('Etapa').selectOption({ label: 'Activo' })
  const fee = panel().getByLabel('Fee mensual')
  await fee.fill('1.500')
  await fee.press('Enter')

  // Crear el contacto desde la ficha del cliente.
  const link = panel().getByRole('textbox', { name: 'Enlazar en Contactos' })
  await link.fill('Ana López')
  await link.press('Enter')
  await expect(panel().getByRole('button', { name: 'Abrir Ana López' })).toBeVisible()
  await shot('11-cliente')

  // Abrir el contacto: va a Contactos y su cliente es Acme.
  await panel().getByRole('button', { name: 'Abrir Ana López' }).click()
  await expect(page.getByTestId('page-contacto')).toBeVisible()
  await expect(panel().locator('#panel-title')).toHaveValue('Ana López')
  await expect(panel().getByRole('button', { name: 'Abrir Acme Moda' })).toBeVisible()
  await panel().getByLabel('Cargo').fill('Directora de marketing')
  await panel().getByLabel('Cargo').press('Enter')
  await panel().getByRole('button', { name: 'Abrir Acme Moda' }).click()
  await expect(page.getByTestId('page-cliente')).toBeVisible()
  await expect(panel().locator('#panel-title')).toHaveValue('Acme Moda')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('inicio: resumen de clientes', async () => {
  await page.getByTestId('nav-inicio').click()
  await expect(page.getByRole('heading', { name: 'Hola, Joan' })).toBeVisible()
  const kpis = page.getByTestId('home-kpis')
  await expect(kpis).toContainText('Clientes activos')
  await expect(kpis).toContainText(/1\.500,00\s€/)
  await shot('12-inicio')
})

test('pipeline: mover un cliente de etapa y crear un pipeline nuevo', async () => {
  await page.getByTestId('nav-clientes').click()
  await page.getByTestId('view-tab').filter({ hasText: 'Pipeline' }).click()
  const cols = page.getByTestId('kanban-col')
  const activo = cols.filter({ hasText: 'Activo' })
  const pausa = cols.filter({ hasText: 'En pausa' })
  await expect(activo.getByTestId('kanban-card')).toHaveCount(1)
  await drag(page, activo.getByTestId('kanban-card'), pausa)
  await expect(pausa.getByTestId('kanban-card')).toHaveCount(1)
  await shot('13-pipeline')

  // Tras arrastrar, los datos se recargan: se reabre el menú si ese refresco lo cerró.
  const addView = page.getByTestId('add-view')
  const newPipeline = page.getByRole('button', { name: '+ Pipeline nuevo…' })
  await expect(async () => {
    if ((await addView.getAttribute('aria-expanded')) !== 'true') await addView.click()
    await expect(newPipeline).toBeVisible({ timeout: 1000 })
  }).toPass()
  await newPipeline.click()
  await page.getByLabel('Nombre del pipeline').fill('Ventas')
  await page.getByRole('button', { name: 'Crear', exact: true }).click()
  // Se abre la edición de etapas del pipeline nuevo.
  const dialog = page.getByTestId('field-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('Nueva opción').fill('Propuesta')
  await dialog.getByRole('button', { name: 'Añadir', exact: true }).click()
  await dialog.getByRole('button', { name: 'Guardar' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('view-tab').filter({ hasText: 'Ventas' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(cols.filter({ hasText: 'Propuesta' })).toHaveCount(1)
  await expect(cols.filter({ hasText: 'Sin valor' }).getByTestId('kanban-card')).toHaveCount(1)
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
