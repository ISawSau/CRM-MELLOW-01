import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'

/** Fase 12: temas propios, Inicio configurable, plantillas de brief y colecciones. */

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
const shots = process.env['E2E_SHOTS']

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-personalizacion-'))
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

const cssVar = (name: string) =>
  page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name)

test('crear un tema propio con vista previa en directo y aviso de contraste', async () => {
  await page.getByTestId('nav-ajustes').click()
  await page.getByRole('button', { name: 'Nuevo tema a partir de «Oscuro»' }).click()
  const ed = page.getByTestId('theme-editor')
  await expect(ed.getByLabel('Nombre del tema')).toHaveValue('Oscuro (copia)')
  await ed.getByLabel('Nombre del tema').fill('Marca')
  await ed.getByLabel('Botón principal (código)', { exact: true }).fill('#f5d000')
  await expect.poll(() => cssVar('--accent')).toBe('#f5d000')
  await expect(ed.getByTestId('theme-contrast')).toContainText('cumple el contraste AA')
  await ed.getByLabel('Texto y enlaces de acento (código)', { exact: true }).fill('#3a3a3a')
  await expect(ed.getByTestId('theme-contrast')).toContainText('Texto de acento sobre el fondo')
  await ed.getByLabel('Texto y enlaces de acento (código)', { exact: true }).fill('#f5d000')
  await ed.getByLabel('Opacidad de separadores', { exact: true }).fill('40')
  await expect.poll(() => cssVar('--line')).toBe('rgba(224, 164, 124, 0.4)')
  if (shots) await page.screenshot({ path: join(shots, '80-editor-temas.png'), fullPage: true })
  await ed.getByRole('button', { name: 'Guardar tema' }).click()
  await expect(ed).toBeHidden()
  const marca = page.getByRole('button', { name: 'Marca', exact: true })
  await expect(marca).toHaveAttribute('aria-pressed', 'true')
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme']))
    .toMatch(/^propio-/)
  await expect.poll(() => cssVar('--accent')).toBe('#f5d000')
})

test('cancelar la edición deshace la vista previa; la paleta lista los temas propios', async () => {
  await page.getByRole('button', { name: 'Editar «Marca»' }).click()
  const ed = page.getByTestId('theme-editor')
  await ed.getByLabel('Fondo (código)', { exact: true }).fill('#202060')
  await expect.poll(() => cssVar('--bg')).toBe('#202060')
  await ed.getByRole('button', { name: 'Cancelar' }).click()
  await expect.poll(() => cssVar('--bg')).toBe('#0d0908')

  await page.getByTestId('theme-oscuro').click()
  await expect.poll(() => cssVar('--accent')).toBe('#e0a47c')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('tema marca')
  await page.keyboard.press('Enter')
  await expect.poll(() => cssVar('--accent')).toBe('#f5d000')
})

test('borrar el tema en uso vuelve al oscuro', async () => {
  await page.getByRole('button', { name: 'Editar «Marca»' }).click()
  const ed = page.getByTestId('theme-editor')
  await ed.getByRole('button', { name: 'Borrar tema' }).click()
  await ed.getByRole('button', { name: 'Sí, borrar «Marca»' }).click()
  await expect(page.getByRole('button', { name: 'Marca', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('theme-oscuro')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => cssVar('--accent')).toBe('#e0a47c')
})

test('Inicio configurable: quitar, reordenar, añadir un widget y restablecer', async () => {
  await page.getByTestId('nav-inicio').click()
  const home = page.getByTestId('page-inicio')
  const cells = home.locator('.home-item-cell')
  await expect(cells).toHaveCount(6)
  await page.getByTestId('home-customize').click()
  await home.getByRole('button', { name: 'Quitar Notas recientes y fijadas' }).click()
  await expect(home.getByTestId('home-notes')).toHaveCount(0)
  await expect(cells).toHaveCount(5)
  // Alertas sube por encima de Tareas.
  await expect(cells.last()).toContainText('Alertas')
  await home.getByRole('button', { name: 'Subir Alertas' }).click()
  await expect(cells.last()).toContainText('Tareas')
  await home.getByRole('button', { name: '+ Widget de análisis' }).click()
  const dlg = page.getByTestId('widget-dialog')
  await dlg.getByLabel('Tipo').selectOption('line')
  await dlg.getByLabel('Título (opcional)').fill('Gasto diario')
  await dlg.getByRole('button', { name: 'Guardar' }).click()
  await expect(cells).toHaveCount(6)
  await expect(cells.last().getByTestId('widget')).toContainText('Gasto diario')
  await page.getByTestId('home-customize').click()
  await expect(page.getByTestId('home-editor')).toBeHidden()
  if (shots) await page.screenshot({ path: join(shots, '81-inicio-personalizado.png') })

  // Se guarda en la bóveda: sobrevive a cambiar de sección.
  await page.getByTestId('nav-notas').click()
  await page.getByTestId('nav-inicio').click()
  await expect(cells).toHaveCount(6)
  await expect(home.getByTestId('home-notes')).toHaveCount(0)
  await page.getByTestId('home-customize').click()
  await home.getByRole('button', { name: 'Restablecer Inicio' }).click()
  await expect(home.getByTestId('home-notes')).toHaveCount(1)
  await expect(home.getByTestId('widget')).toHaveCount(0)
  await page.getByTestId('home-customize').click()
})

test('brief desde plantilla con entrega y tareas; guardar un brief como plantilla', async () => {
  await page.getByTestId('nav-briefs').click()
  await page.getByTestId('from-template').click()
  await page.getByRole('button', { name: 'Brief de campaña' }).click()
  const panel = page.getByTestId('record-panel')
  await expect(panel.locator('#panel-title')).toHaveValue('Brief de campaña')
  await expect(panel).toContainText('Revisar el brief con el cliente')
  await expect(panel).toContainText('Preparar las creatividades')
  await expect(panel.getByRole('textbox', { name: 'Contenido' })).toContainText(
    'Enlaza las creatividades en el campo «Creatividades» de este brief.',
  )
  await panel.locator('#panel-title').fill('Brief otoño')
  await panel.locator('#panel-title').press('Enter')
  await panel.getByTestId('save-as-template').click()
  await page.getByLabel('Nombre de la plantilla').fill('Otoño')
  await page.getByRole('button', { name: 'Guardar plantilla' }).click()
  await expect(page.getByText('Plantilla «Otoño» guardada')).toBeVisible()
  await panel.getByRole('button', { name: 'Cerrar ficha' }).click()

  // En Ajustes: la plantilla nueva, con una tarea propia.
  await page.getByTestId('nav-ajustes').click()
  const box = page.getByTestId('brief-templates')
  await box.getByRole('tab', { name: 'Otoño' }).click()
  await expect(box.getByRole('textbox', { name: 'Título de la sección' })).toHaveCount(7)
  await box.getByLabel('Entrega a los (días)').fill('3')
  await box.getByRole('button', { name: '+ Tarea' }).click()
  await box.getByRole('textbox', { name: 'Tarea', exact: true }).fill('Llamar al cliente')
  await box.getByLabel('Días para «Llamar al cliente»').fill('1')
  if (shots) await page.screenshot({ path: join(shots, '82-plantillas-brief.png') })
  await box.getByRole('button', { name: 'Guardar plantillas' }).click()
  await expect(page.getByText('Plantillas guardadas.')).toBeVisible()

  await page.getByTestId('nav-briefs').click()
  await page.getByTestId('from-template').click()
  await page.getByRole('button', { name: 'Otoño' }).click()
  await expect(panel.locator('#panel-title')).toHaveValue('Otoño')
  await expect(panel).toContainText('Llamar al cliente')
  await panel.getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
