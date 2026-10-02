import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  collectConsoleErrors,
  createVaultAndEnter,
  drag,
  launchApp,
  stubSaveDialog,
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
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-notas-'))
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

const rows = () => page.getByTestId('table-row')
const panel = () => page.getByTestId('record-panel')

async function newNote(title: string) {
  await page.getByTestId('new-record').click()
  const input = panel().locator('#panel-title')
  await expect(input).toHaveValue('Sin título')
  await input.fill(title)
  await input.press('Enter')
  await expect(rows().filter({ hasText: title })).toHaveCount(1)
}

test('crear notas desde la tabla y editarlas en la ficha', async () => {
  await page.getByTestId('nav-notas').click()
  await expect(page.getByTestId('page-nota')).toBeVisible()
  await expect(page.getByTestId('view-tab')).toHaveCount(4)
  await expect(page.getByText('Sin notas')).toBeVisible()

  await newNote('Campaña de Navidad')
  await panel().getByLabel('Tipo').selectOption({ label: 'Idea' })
  await panel().getByLabel('Fecha').fill(todayMadrid())
  await panel().getByRole('button', { name: 'Importante' }).click()
  const editor = panel().getByRole('textbox', { name: 'Contenido' })
  await editor.click()
  await page.keyboard.type('Revisar las creatividades del cliente')
  await expect(rows().first()).toContainText('Idea')
  await expect(rows().first()).toContainText('Importante')
  await shot('01-ficha')

  // El historial registra los cambios.
  await panel().getByRole('tab', { name: 'Historial' }).click()
  await expect(panel().getByTestId('history')).toContainText('Creado')
  await expect(panel().getByTestId('history')).toContainText('Tipo')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
  await expect(panel()).toBeHidden()

  await newNote('Reunión semanal')
  await panel().getByLabel('Tipo').selectOption({ label: 'Reunión' })
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
  await expect(rows()).toHaveCount(2)
  await expect(page.getByTestId('record-count')).toHaveText('2 registros')
  await shot('02-tabla')
})

test('editar en la celda de la tabla con el teclado', async () => {
  // Orden por defecto: lo más reciente primero.
  const row = rows().first()
  await expect(row).toContainText('Reunión semanal')
  await row.locator('[data-field="titulo"]').click()
  await page.keyboard.press('Enter')
  const input = row.locator('[data-field="titulo"] input')
  await expect(input).toBeFocused()
  await input.fill('Reunión semanal con el equipo')
  await input.press('Enter')
  await expect(rows().filter({ hasText: 'Reunión semanal con el equipo' })).toHaveCount(1)

  // Casilla «Fijada» directamente en la tabla.
  const fijada = rows()
    .filter({ hasText: 'Campaña de Navidad' })
    .locator('[data-field="fijada"] input')
  // Casilla controlada: se marca cuando el proceso principal confirma el cambio.
  await fijada.click()
  await expect(fijada).toBeChecked()
})

test('filtrar sin importar las tildes y deshacer con Ctrl+Z', async () => {
  await page.getByTestId('filter-button').click()
  await page.getByRole('button', { name: '+ Añadir filtro' }).click()
  const row = page.getByTestId('filter-row')
  await row.getByLabel('Valor').fill('campana')
  await expect(rows()).toHaveCount(1)
  await expect(rows().first()).toContainText('Campaña de Navidad')
  await page.getByRole('button', { name: 'Quitar todos' }).click()
  await expect(rows()).toHaveCount(2)
  await page.keyboard.press('Escape')

  // Enviar a la papelera desde la selección y deshacer.
  await rows().filter({ hasText: 'Reunión' }).getByRole('checkbox').first().check()
  await page.getByRole('button', { name: 'Enviar a la papelera' }).click()
  await expect(rows()).toHaveCount(1)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.getByTestId('toast')).toContainText('Deshecho')
  await expect(rows()).toHaveCount(2)
  await page.keyboard.press('Control+Shift+z')
  await expect(rows()).toHaveCount(1)
  await page.keyboard.press('Control+z')
  await expect(rows()).toHaveCount(2)
})

test('buscar con Ctrl+K y abrir el resultado', async () => {
  await page.keyboard.press('Control+k')
  await page.keyboard.type('creativid')
  const hit = page.getByTestId('search-hit')
  await expect(hit).toHaveCount(1)
  await expect(hit).toContainText('Campaña de Navidad')
  await shot('03-busqueda')
  await page.keyboard.press('Enter')
  await expect(panel().locator('#panel-title')).toHaveValue('Campaña de Navidad')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('kanban: arrastrar una tarjeta cambia su tipo', async () => {
  await page.getByTestId('view-tab').filter({ hasText: 'Por tipo' }).click()
  await expect(page.getByTestId('kanban')).toBeVisible()
  const cols = page.getByTestId('kanban-col')
  const idea = cols.filter({ hasText: 'Idea' })
  const ref = cols.filter({ hasText: 'Referencia' })
  await expect(idea.getByTestId('kanban-card')).toHaveCount(1)
  await drag(page, idea.getByTestId('kanban-card'), ref)
  await expect(ref.getByTestId('kanban-card')).toHaveCount(1)
  await expect(idea.getByTestId('kanban-card')).toHaveCount(0)
  await shot('04-kanban')
})

test('calendario y galería', async () => {
  await page.getByTestId('view-tab').filter({ hasText: 'Calendario' }).click()
  await expect(page.getByTestId('calendar')).toBeVisible()
  const event = page.getByTestId('cal-event')
  await expect(event).toHaveCount(1)
  await expect(page.locator(`[data-day="${todayMadrid()}"]`)).toContainText('Campaña de Navidad')
  // La semana empieza en lunes.
  await expect(page.locator('.cal-weekday').first()).toHaveText('lun')
  await shot('05-calendario')

  await page.getByTestId('view-tab').filter({ hasText: 'Tarjetas' }).click()
  await expect(page.getByTestId('gallery').locator('.card')).toHaveCount(2)
  await expect(page.getByTestId('gallery')).toContainText('Revisar las creatividades')
  await shot('06-galeria')
})

test('nueva vista de lista', async () => {
  await page.getByTestId('add-view').click()
  await page.getByRole('button', { name: 'Lista', exact: true }).click()
  await expect(page.getByTestId('view-tab')).toHaveCount(5)
  await expect(page.getByTestId('list').locator('li')).toHaveCount(2)
})

test('papelera: enviar, restaurar y borrar para siempre', async () => {
  await page.getByTestId('view-tab').filter({ hasText: 'Todas' }).click()
  await rows().filter({ hasText: 'Reunión' }).locator('.grid-open').click()
  await panel().getByRole('button', { name: 'Enviar a la papelera' }).click()
  await expect(rows()).toHaveCount(1)

  await page.getByTestId('nav-papelera').click()
  const list = page.getByTestId('trash-list')
  await expect(list).toContainText('Reunión semanal con el equipo')
  await expect(list).toContainText('quedan 30 días')
  await shot('07-papelera')
  await list.getByRole('button', { name: 'Restaurar' }).click()
  await expect(page.getByText('No hay nada en la papelera.')).toBeVisible()

  await page.getByTestId('nav-notas').click()
  await expect(rows()).toHaveCount(2)
  await rows().filter({ hasText: 'Reunión' }).getByRole('checkbox').first().check()
  await page.getByRole('button', { name: 'Enviar a la papelera' }).click()
  await page.getByTestId('nav-papelera').click()
  await page.getByTestId('trash-list').getByRole('button', { name: 'Borrar para siempre' }).click()
  await page.getByTestId('confirm-purge').click()
  await expect(page.getByText('No hay nada en la papelera.')).toBeVisible()
})

test('campos: añadir una moneda y una fórmula desde Ajustes', async () => {
  await page.getByTestId('nav-ajustes').click()
  const settings = page.getByTestId('fields-settings')
  await settings.getByTestId('add-field').click()
  const dialog = page.getByTestId('field-dialog')
  await dialog.getByLabel('Nombre').fill('Presupuesto')
  await dialog.getByLabel('Tipo').selectOption({ label: 'Moneda' })
  await dialog.getByRole('button', { name: 'Crear campo' }).click()
  await expect(dialog).toBeHidden()
  await expect(settings.getByTestId('field-row').filter({ hasText: 'Presupuesto' })).toHaveCount(1)

  await settings.getByTestId('add-field').click()
  await dialog.getByLabel('Nombre').fill('Con IVA')
  await dialog.getByLabel('Tipo').selectOption({ label: 'Fórmula' })
  await dialog.getByLabel('Fórmula').fill('presupuesto *')
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByLabel('Fórmula').fill('presupuesto * 1.21')
  await dialog.getByLabel('Resultado').selectOption({ label: 'Moneda' })
  await dialog.getByRole('button', { name: 'Crear campo' }).click()
  await expect(dialog).toBeHidden()
  await shot('08-campos')

  await page.getByTestId('nav-notas').click()
  const row = rows().first()
  await row.locator('[data-field="presupuesto"]').dblclick()
  const input = row.locator('[data-field="presupuesto"] input')
  await input.fill('1.000,50')
  await input.press('Enter')
  await expect(row.locator('[data-field="presupuesto"]')).toHaveText(/1\.000,50\s€/)
  await expect(row.locator('[data-field="con_iva"]')).toHaveText(/1\.210,61\s€/)
  await shot('09-formula')
})

test('exportar la vista a CSV para Excel', async () => {
  const file = join(parent, 'notas.csv')
  await stubSaveDialog(ctx.app, file)
  await page.getByRole('button', { name: 'Exportar CSV' }).click()
  await expect(page.getByTestId('toast')).toContainText('Exportado')
  const csv = readFileSync(file, 'utf8')
  expect(csv.charCodeAt(0)).toBe(0xfeff)
  expect(csv).toContain('Título;')
  expect(csv).toContain('Campaña de Navidad')
  expect(csv).toContain('1000,5')
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
