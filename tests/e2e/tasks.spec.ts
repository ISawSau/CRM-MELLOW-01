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

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
const shots = process.env['E2E_SHOTS']

async function shot(name: string) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) })
}

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-tareas-'))
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

test('una tarea para hoy con checklist y repetición semanal', async () => {
  await page.getByTestId('nav-tareas').click()
  await expect(page.getByTestId('page-tarea')).toBeVisible()
  await expect(page.getByTestId('view-tab')).toHaveText([
    /Tablero/,
    /Hoy/,
    /Atrasadas/,
    /Todas/,
    /Calendario/,
  ])
  await page.getByTestId('new-record').click()
  await panel().locator('#panel-title').fill('Informe semanal')
  await panel().locator('#panel-title').press('Enter')
  await panel().getByLabel('Fecha límite').fill(todayMadrid())
  await panel().getByLabel('Prioridad').selectOption({ label: 'Alta' })

  const add = panel().getByRole('textbox', { name: 'Añadir a Checklist' })
  await add.fill('Exportar datos')
  await add.press('Enter')
  await add.fill('Enviar al cliente')
  await add.press('Enter')
  await panel().getByRole('checkbox', { name: 'Hecho: Exportar datos' }).click()
  await expect(panel().getByRole('checkbox', { name: 'Hecho: Exportar datos' })).toBeChecked()

  await panel().getByLabel('Repetición').selectOption({ label: 'Cada semana' })
  await panel()
    .getByRole('group', { name: 'Días de la semana' })
    .getByRole('button', { name: 'L' })
    .click()
  await expect(
    panel().getByRole('group', { name: 'Días de la semana' }).getByRole('button', { name: 'L' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await shot('20-tarea')

  // La barra lateral avisa de la tarea de hoy.
  await expect(page.getByTestId('badge-tareas')).toHaveText('1')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
  await page.getByTestId('view-tab').filter({ hasText: 'Hoy' }).click()
  await expect(page.getByTestId('list').locator('li')).toHaveCount(1)
  await expect(page.getByTestId('list')).toContainText('1/2')
})

test('completar la tarea crea la siguiente repetición', async () => {
  await page.getByTestId('view-tab').filter({ hasText: 'Todas' }).click()
  await page.getByTestId('table-row').first().locator('.grid-open').click()
  await panel().getByLabel('Estado').selectOption({ label: 'Hecha' })
  await expect(page.getByTestId('table-row')).toHaveCount(2)
  await expect(page.getByTestId('badge-tareas')).toHaveCount(0)
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
  // Deshacer quita la repetición creada.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('table-row')).toHaveCount(1)
  await page.keyboard.press('Control+Shift+z')
  await expect(page.getByTestId('table-row')).toHaveCount(2)
  await shot('21-tareas')
})

test('brief desde plantilla y tarea enlazada', async () => {
  await page.getByTestId('nav-briefs').click()
  await page.getByTestId('from-template').click()
  await page.getByRole('button', { name: 'Brief de campaña' }).click()
  await expect(panel().locator('#panel-title')).toHaveValue('Brief de campaña')
  const content = panel().getByRole('textbox', { name: 'Contenido' })
  await expect(content.getByRole('heading', { name: 'Objetivo' })).toBeVisible()
  await expect(content.getByRole('heading', { name: 'Mensajes clave' })).toBeVisible()
  await shot('22-brief')

  await panel().getByTestId('new-linked-task').click()
  await expect(page.getByTestId('page-tarea')).toBeVisible()
  await expect(panel().locator('#panel-title')).toHaveValue('Nueva tarea')
  await expect(panel().getByRole('button', { name: 'Abrir Brief de campaña' })).toBeVisible()
})

test('editar las plantillas de brief en los ajustes de Briefs', async () => {
  await page.getByTestId('nav-briefs').click()
  await page.getByTestId('open-section-settings').click()
  await page.getByTestId('section-tab-plantillas').click()
  const box = page.getByTestId('brief-templates')
  await box.getByRole('button', { name: '+ Sección' }).click()
  await box.getByRole('textbox', { name: 'Título de la sección' }).last().fill('Presupuesto')
  await box.getByRole('button', { name: 'Guardar plantillas' }).click()
  await expect(page.getByTestId('toast')).toContainText('Plantillas guardadas')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('section-settings')).toBeHidden()
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
