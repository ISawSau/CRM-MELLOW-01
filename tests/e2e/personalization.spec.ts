import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  collectConsoleErrors,
  createVaultAndEnter,
  launchApp,
  stubSaveDialog,
  type Launched,
} from './app'

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
  await page.getByRole('button', { name: 'Nuevo tema a partir de «Mellow»' }).click()
  const ed = page.getByTestId('theme-editor')
  await expect(ed.getByLabel('Nombre del tema')).toHaveValue('Mellow (copia)')
  await ed.getByLabel('Nombre del tema').fill('Marca')
  await ed.getByLabel('Botón principal (código)', { exact: true }).fill('#f5d000')
  await expect.poll(() => cssVar('--accent')).toBe('#f5d000')
  await expect(ed.getByTestId('theme-contrast')).toContainText('cumple el contraste AA')
  await ed.getByLabel('Texto y enlaces de acento (código)', { exact: true }).fill('#3a3a3a')
  await expect(ed.getByTestId('theme-contrast')).toContainText('Texto de acento sobre el fondo')
  await ed.getByLabel('Texto y enlaces de acento (código)', { exact: true }).fill('#f5d000')
  await ed.getByLabel('Opacidad de separadores', { exact: true }).fill('40')
  await expect.poll(() => cssVar('--line')).toBe('rgba(242, 166, 90, 0.4)')
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
  await expect.poll(() => cssVar('--bg')).toBe('#0b0807')

  await page.getByTestId('theme-oscuro').click()
  await expect.poll(() => cssVar('--accent')).toBe('#e0a47c')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('tema marca')
  await page.keyboard.press('Enter')
  await expect.poll(() => cssVar('--accent')).toBe('#f5d000')
})

test('el tema propio redondea esquinas, colorea los iconos y pone una imagen de fondo', async () => {
  await page.getByRole('button', { name: 'Editar «Marca»' }).click()
  const ed = page.getByTestId('theme-editor')
  await ed.getByLabel('Redondeo de esquinas').fill('10')
  await expect.poll(() => cssVar('--radius')).toBe('10px')
  await ed.getByLabel('Iconos de las secciones', { exact: true }).fill('#00ff88')
  await expect.poll(() => cssVar('--icon')).toBe('#00ff88')
  await ctx.app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as never
  }, resolve('build/icon.png'))
  await ed.getByRole('button', { name: 'Elegir imagen o vídeo…' }).click()
  await expect(ed.getByLabel('Velo del fondo')).toBeVisible()
  await ed.getByLabel('Velo del fondo').fill('40')
  await ed.getByRole('button', { name: 'Guardar tema' }).click()
  await expect(ed).toBeHidden()
  const bg = page.getByTestId('theme-background').locator('img')
  await expect(bg).toHaveCount(1)
  await expect.poll(() => bg.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(512)
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset['bg'])).toBe('image')
  if (shots) await page.screenshot({ path: join(shots, '85-tema-fondo.png') })
})

test('exportar el tema a un archivo e importarlo (como haría con lo que da una IA)', async () => {
  const file = join(parent, 'marca.json')
  await stubSaveDialog(ctx.app, file)
  await page.getByRole('button', { name: 'Exportar «Marca»' }).click()
  await expect(page.getByTestId('toast')).toContainText('exportado')
  const exported = JSON.parse(readFileSync(file, 'utf8')) as {
    formato: string
    tema: { name: string; radius: number; background?: unknown }
  }
  expect(exported.formato).toBe('crm-mellow-tema')
  expect(exported.tema.radius).toBe(10)
  expect(exported.tema.background).toBeUndefined()

  await page.getByTestId('theme-import-open').click()
  const dlg = page.getByTestId('theme-import')
  await dlg
    .getByLabel('JSON del tema')
    .fill(JSON.stringify({ ...exported, tema: { ...exported.tema, name: 'Importado' } }))
  await dlg.getByRole('button', { name: 'Importar y aplicar' }).click()
  await expect(dlg).toBeHidden()
  await expect(page.getByRole('button', { name: 'Importado', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  // Un JSON roto se explica sin guardar nada.
  await page.getByTestId('theme-import-open').click()
  await dlg.getByLabel('JSON del tema').fill('{"tema": {"colors": {"bg": "rojo"}}}')
  await dlg.getByRole('button', { name: 'Importar y aplicar' }).click()
  await expect(dlg.getByRole('alert')).toContainText('El tema no es válido')
  await dlg.getByRole('button', { name: 'Cancelar' }).click()
  await page.getByRole('button', { name: 'Marca', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Marca', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('borrar el tema en uso vuelve al de serie (Mellow)', async () => {
  await page.getByRole('button', { name: 'Editar «Marca»' }).click()
  const ed = page.getByTestId('theme-editor')
  await ed.getByRole('button', { name: 'Borrar tema' }).click()
  await ed.getByRole('button', { name: 'Sí, borrar «Marca»' }).click()
  await expect(page.getByRole('button', { name: 'Marca', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('theme-mellow')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => cssVar('--accent')).toBe('#f2a65a')
})

test('estilo del tema: clásico o flotante, transparencia y animaciones', async () => {
  const attr = (n: string) => page.evaluate((k) => document.documentElement.dataset[k], n)
  // Mellow (de serie) es flotante, sin transparencia y con títulos normales.
  await expect.poll(() => attr('layout')).toBe('flotante')
  await expect.poll(() => attr('transparency')).toBe('solido')
  await page.getByTestId('theme-oscuro').click()
  await expect.poll(() => attr('layout')).toBe('clasica')
  await page.getByTestId('theme-mellow').click()
  await page.getByRole('button', { name: 'Nuevo tema a partir de «Mellow»' }).click()
  const ed = page.getByTestId('theme-editor')
  const style = ed.getByTestId('theme-style')
  await style.getByLabel('Transparencia').selectOption('cristal')
  await expect.poll(() => attr('transparency')).toBe('cristal')
  await style.getByLabel('Desenfoque').fill('24')
  await expect.poll(() => cssVar('--panel-blur')).toBe('24px')
  await style.getByLabel('Animaciones').selectOption('ninguno')
  await expect.poll(() => attr('motion')).toBe('ninguno')
  await style.getByLabel('Disposición').selectOption('clasica')
  await expect.poll(() => cssVar('--gap')).toBe('0px')
  await ed.getByRole('button', { name: 'Cancelar' }).click()
  await expect.poll(() => attr('transparency')).toBe('solido')
  if (shots) await page.screenshot({ path: join(shots, '86-tema-mellow.png') })
})

test('los iconos de las secciones son SVG y se eligen en Ajustes', async () => {
  await page.getByTestId('nav-ajustes').click()
  const nav = page.getByTestId('nav-clientes')
  await expect(nav.locator('svg.lucide-users')).toHaveCount(1)
  const block = page.getByTestId('section-icons-settings')
  await block.getByTestId('section-icon-clientes').click()
  await block.getByLabel('Buscar icono').fill('brief')
  await block.getByTestId('icon-briefcase').click()
  await expect(nav.locator('svg.lucide-briefcase')).toHaveCount(1)
  await block.getByRole('button', { name: 'De serie' }).click()
  await expect(nav.locator('svg.lucide-users')).toHaveCount(1)
})

test('Inicio configurable: quitar, reordenar, añadir un widget y restablecer', async () => {
  await page.getByTestId('nav-inicio').click()
  const home = page.getByTestId('page-inicio')
  const cells = home.locator('.home-item-cell')
  await expect(cells).toHaveCount(7)
  await page.getByTestId('home-customize').click()
  await home.getByRole('button', { name: 'Quitar Notas recientes y fijadas' }).click()
  await expect(home.getByTestId('home-notes')).toHaveCount(0)
  await expect(cells).toHaveCount(6)
  // Alertas sube por encima de Tareas.
  await expect(cells.last()).toContainText('Alertas')
  await home.getByRole('button', { name: 'Subir Alertas' }).click()
  await expect(cells.last()).toContainText('Tareas')
  await home.getByRole('button', { name: '+ Widget de análisis' }).click()
  const dlg = page.getByTestId('widget-dialog')
  await dlg.getByLabel('Tipo').selectOption('line')
  await dlg.getByLabel('Título (opcional)').fill('Gasto diario')
  await dlg.getByRole('button', { name: 'Guardar' }).click()
  await expect(cells).toHaveCount(7)
  await expect(cells.last().getByTestId('widget')).toContainText('Gasto diario')
  await page.getByTestId('home-customize').click()
  await expect(page.getByTestId('home-editor')).toBeHidden()
  if (shots) await page.screenshot({ path: join(shots, '81-inicio-personalizado.png') })

  // Se guarda en la bóveda: sobrevive a cambiar de sección.
  await page.getByTestId('nav-notas').click()
  await page.getByTestId('nav-inicio').click()
  await expect(cells).toHaveCount(7)
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

  // En los ajustes de Briefs: la plantilla nueva, con una tarea propia.
  await page.getByTestId('open-section-settings').click()
  await page.getByTestId('section-tab-plantillas').click()
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
  await page.getByRole('button', { name: 'Cerrar ajustes' }).click()

  await page.getByTestId('from-template').click()
  await page.getByRole('button', { name: 'Otoño' }).click()
  await expect(panel.locator('#panel-title')).toHaveValue('Otoño')
  await expect(panel).toContainText('Llamar al cliente')
  await panel.getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('crear una colección: aparece en la barra lateral y se le añaden campos', async () => {
  await page.getByTestId('nav-ajustes').click()
  const box = page.getByTestId('collections-settings')
  await box.getByLabel('Nombre (en plural)', { exact: true }).fill('Proveedores')
  await expect(box.getByLabel('Letra', { exact: true })).toHaveValue('P')
  await box.getByLabel('En singular', { exact: true }).fill('Proveedor')
  await box.getByRole('button', { name: 'Crear colección' }).click()
  await expect(page.getByText('«Proveedores» ya está en la barra lateral.')).toBeVisible()
  await expect(page.getByTestId('nav-col-proveedores')).toContainText('Proveedores')

  // Un campo de moneda, desde los ajustes de la propia colección.
  await page.getByTestId('nav-col-proveedores').click()
  await page.getByTestId('open-section-settings').click()
  const fields = page.getByTestId('fields-settings')
  await expect(fields.getByTestId('field-row')).toHaveCount(2)
  await fields.getByTestId('add-field').click()
  const dialog = page.getByTestId('field-dialog')
  await dialog.getByLabel('Nombre').fill('Tarifa')
  await dialog.getByLabel('Tipo').selectOption({ label: 'Moneda' })
  await dialog.getByRole('button', { name: 'Crear campo' }).click()
  await expect(fields.getByTestId('field-row').filter({ hasText: 'Tarifa' })).toHaveCount(1)
  // La pestaña «Colección» renombra sin salir de la sección.
  await page.getByTestId('section-tab-coleccion').click()
  await expect(
    page.getByTestId('section-settings').getByLabel('Proveedores: Nombre (en plural)'),
  ).toHaveValue('Proveedores')
  if (shots) await page.screenshot({ path: join(shots, '83-colecciones-ajustes.png') })
  await page.getByRole('button', { name: 'Cerrar ajustes' }).click()
})

test('usar la colección: registros, búsqueda y borrado protegido', async () => {
  await page.getByTestId('nav-col-proveedores').click()
  const pageCol = page.getByTestId('page-col-proveedores')
  await expect(pageCol.getByRole('heading', { name: 'Proveedores', level: 1 })).toBeVisible()
  await expect(page.getByTestId('new-record')).toHaveText('+ Nuevo proveedor')
  await page.getByTestId('new-record').click()
  const panel = page.getByTestId('record-panel')
  await panel.locator('#panel-title').fill('Imprenta Pérez')
  await panel.locator('#panel-title').press('Enter')
  await expect(panel).toContainText('Tarifa')
  await panel.getByRole('button', { name: 'Cerrar ficha' }).click()
  await expect(page.getByTestId('table-row')).toHaveCount(1)
  if (shots) await page.screenshot({ path: join(shots, '84-coleccion.png') })

  // La búsqueda global la encuentra y abre su ficha.
  await page.getByTestId('nav-inicio').click()
  await page.keyboard.press('Control+k')
  await page.keyboard.type('Imprenta')
  await expect(page.getByTestId('palette')).toContainText('proveedor')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('record-panel').locator('#panel-title')).toHaveValue(
    'Imprenta Pérez',
  )
  await page.getByTestId('record-panel').getByRole('button', { name: 'Cerrar ficha' }).click()

  // No se puede borrar con registros; renombrarla cambia la barra lateral.
  await page.getByTestId('nav-ajustes').click()
  const box = page.getByTestId('collections-settings')
  await box.getByRole('button', { name: 'Borrar…' }).click()
  await page.getByRole('button', { name: 'Borrar colección' }).click()
  await expect(box).toContainText('«Proveedores» tiene 1 registro')
  await box.getByLabel('Proveedores: Nombre (en plural)').fill('Proveedores locales')
  await box.getByRole('button', { name: 'Guardar', exact: true }).click()
  await expect(page.getByTestId('nav-col-proveedores')).toContainText('Proveedores locales')
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
