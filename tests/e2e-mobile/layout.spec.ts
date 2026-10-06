import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { startFakeMeta } from '../e2e/fake-meta-server'
import { GOOD_TOKEN } from '../unit/meta-fake'

/**
 * Que todo quepa en la pantalla del móvil (D-122), con datos: Perfil al desplazarse, tablas
 * con muchas columnas, ajustes de sección, menús y confirmaciones, Campañas con Meta (falso)
 * y Análisis. E2E_SHOTS=<carpeta> guarda capturas de cada pantalla para revisarlas.
 *
 * Usa su propio motor (otro puerto y otra carpeta de datos) para no mezclarse con
 * movil.spec.ts.
 */
const PORT = 47230
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'contraseña de prueba'
const SHOTS = process.env['E2E_SHOTS']

test.describe.configure({ mode: 'serial' })

let meta: Awaited<ReturnType<typeof startFakeMeta>>
let engine: ChildProcess
let context: BrowserContext
let page: Page
const errors: string[] = []

const shot = async (name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** Ninguna página se sale de la pantalla en horizontal (lo ancho se desplaza en su caja). */
async function noHorizontalScroll() {
  const { width, inner } = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }))
  expect(width).toBeLessThanOrEqual(inner)
  expect(await clipped('.main')).toEqual([])
}

/** La caja (menú, diálogo) se ve entera: no se sale por ningún lado. */
async function fitsScreen(box: Locator) {
  await expect(box).toBeVisible()
  // Después de su animación de entrada.
  await box.evaluate((e) => Promise.all(e.getAnimations().map((a) => a.finished)))
  const b = (await box.boundingBox())!
  const { width, height } = page.viewportSize()!
  const id = await box.evaluate((e) => {
    e.setAttribute('data-fits', '1')
    return '[data-fits="1"]'
  })
  expect(await clipped(id)).toEqual([])
  await box.evaluate((e) => e.removeAttribute('data-fits'))
  expect(b.x).toBeGreaterThanOrEqual(0)
  expect(b.y).toBeGreaterThanOrEqual(0)
  expect(b.x + b.width).toBeLessThanOrEqual(width + 0.5)
  expect(b.y + b.height).toBeLessThanOrEqual(height + 0.5)
}

/**
 * Nada de dentro se corta por la derecha: cada elemento visible acaba dentro de la caja,
 * salvo lo que va en algo que se desplaza a lo ancho (tablas) o fijo encima.
 */
async function clipped(selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = []
    const root = document.querySelector<HTMLElement>(sel)
    if (!root) return [`sin ${sel}`]
    const right = Math.min(root.getBoundingClientRect().right, window.innerWidth) + 1
    // Lo que se desplaza a lo ancho, o va fijo encima (diálogos y menús: se miran aparte).
    const scrolls = (e: HTMLElement) => {
      if (getComputedStyle(e).position === 'fixed') return true
      for (let p = e.parentElement; p && p !== root; p = p.parentElement) {
        const s = getComputedStyle(p)
        if (/auto|scroll/.test(s.overflowX) || s.position === 'fixed') return true
      }
      return false
    }
    for (const e of root.querySelectorAll<HTMLElement>('*')) {
      const r = e.getBoundingClientRect()
      if (r.width === 0 || r.height === 0 || getComputedStyle(e).visibility === 'hidden') continue
      if (r.right > right && !scrolls(e)) {
        const name = `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]}`
        out.push(`${name} acaba en ${Math.round(r.right)}`)
      }
    }
    return [...new Set(out)].slice(0, 8)
  }, selector)
}

/** Los hijos de cada caja no se montan unos encima de otros. */
async function siblingsOverlap(selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = []
    for (const box of document.querySelectorAll(sel)) {
      const kids = [...box.children].map((k) => k.getBoundingClientRect())
      for (let i = 0; i < kids.length; i++)
        for (let j = i + 1; j < kids.length; j++) {
          const a = kids[i]!
          const b = kids[j]!
          const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (ix > 2 && iy > 2) out.push(`${sel}: ${i} y ${j}`)
        }
    }
    return out
  }, selector)
}

async function go(section: string) {
  const tab = page.getByTestId(`tab-${section}`)
  if (await tab.count()) await tab.click()
  else {
    await page.getByTestId('mobile-menu').click()
    await page.getByTestId(`nav-${section}`).click()
  }
  await page.waitForTimeout(400)
}

/** Lo que se desplaza en vertical en la página actual. */
async function scrollPage(dy: number) {
  await page.evaluate((y) => {
    const all = [...document.querySelectorAll<HTMLElement>('*')].filter(
      (e) =>
        e.scrollHeight > e.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(e).overflowY),
    )
    const target = all.sort((a, b) => b.clientHeight - a.clientHeight)[0]
    if (target) target.scrollTop += y
    else window.scrollBy(0, y)
  }, dy)
  await page.waitForTimeout(300)
}

/**
 * Nada fijo (sticky) se monta sobre otra cosa: cada elemento con position: sticky que se ve
 * no tapa a un hermano que no sea su propio fondo.
 */
async function overlaps(root: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = []
    const scope = document.querySelector(sel)
    if (!scope) return ['sin ' + sel]
    const els = [...scope.querySelectorAll<HTMLElement>('*')].filter((e) => {
      const s = getComputedStyle(e)
      return s.position === 'sticky' && e.offsetParent !== null && e.getClientRects().length > 0
    })
    for (const el of els) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      const parent = el.parentElement
      if (!parent) continue
      for (const sib of [...parent.children] as HTMLElement[]) {
        if (sib === el || el.contains(sib) || sib.contains(el)) continue
        const q = sib.getBoundingClientRect()
        if (q.width === 0 || q.height === 0) continue
        const ix = Math.min(r.right, q.right) - Math.max(r.left, q.left)
        const iy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top)
        if (ix > 4 && iy > 4)
          out.push(`${el.className || el.tagName} sobre ${sib.className || sib.tagName}`)
      }
    }
    return out
  }, root)
}

test.beforeAll(async ({ browser }) => {
  meta = await startFakeMeta()
  engine = spawn(process.execPath, ['tests/e2e-mobile/serve.mjs'], {
    env: { ...process.env, ...meta.env, CRM_MOBILE_PORT: String(PORT) },
    stdio: 'inherit',
  })
  for (let i = 0; i < 100; i++) {
    const up = await fetch(BASE)
      .then(() => true)
      .catch(() => false)
    if (up) break
    await new Promise((r) => setTimeout(r, 200))
  }
  context = await browser.newContext({ ...test.info().project.use, baseURL: BASE })
  await context.addCookies([{ name: 'crm', value: 'e2e-secreto', url: BASE }])
  page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push(m.text())
  })
})

test.afterAll(async () => {
  await context?.close()
  engine?.kill()
  meta?.close()
})

test('bóveda con datos de ejemplo', async () => {
  await page.goto('/')
  await page.getByTestId('welcome-create').click()
  await page.getByTestId('create-password').fill(PASSWORD)
  await page.getByTestId('create-confirm').fill(PASSWORD)
  await page.getByTestId('create-submit').click()
  await page.getByTestId('recovery-saved').check({ timeout: 30_000 })
  await page.getByTestId('recovery-continue').click()
  await expect(page.getByTestId('shell')).toBeVisible()
  await page.evaluate(async () => {
    type Api = { invoke: (c: string, i?: unknown) => Promise<{ ok: boolean; data: unknown }> }
    const api = (window as unknown as { api: Api }).api
    const entities = (await api.invoke('data:entities')).data as { id: string; label: string }[]
    const clients = entities.find((e) => e.label === 'Clientes')!
    for (let i = 1; i <= 14; i++)
      await api.invoke('data:create', {
        entity: clients.id,
        title: i === 1 ? 'Acme Moda' : `Cliente de ejemplo con nombre largo ${i}`,
      })
  })
})

test('Perfil: al desplazarse nada se monta encima', async () => {
  await go('perfil')
  await page.getByLabel('Tu nombre').fill('Alex Prueba')
  await page.getByLabel('Cargo o a qué te dedicas').fill('Media buyer')
  await page.getByLabel('Sobre ti').fill('Campañas de Meta para tiendas online.')
  await page.getByRole('button', { name: 'Guardar perfil' }).click()
  await expect(page.getByTestId('profile-view')).toBeVisible()
  await page.waitForTimeout(400)
  await shot('20-perfil')
  await noHorizontalScroll()
  for (const dy of [250, 250, 400]) {
    await scrollPage(dy)
    await shot(`20-perfil-${dy}`)
    expect(await overlaps('.shell')).toEqual([])
  }
})

test('Clientes: la tabla se lee al desplazarse a lo ancho', async () => {
  await go('clientes')
  await expect(page.getByText('Acme Moda')).toBeVisible()
  await shot('21-clientes')
  const scroller = page.locator('.view-body[data-kind="table"] .grid-scroll, .grid-scroll').first()
  if (await scroller.count()) {
    await scroller.evaluate((e) => (e.scrollLeft = 300))
    await page.waitForTimeout(200)
  }
  await shot('21-clientes-derecha')
  // La columna del nombre no ocupa media pantalla tapando las demás.
  const sticky = await page.evaluate(() => {
    const cells = [...document.querySelectorAll<HTMLElement>('td, th, [role="gridcell"]')].filter(
      (e) => getComputedStyle(e).position === 'sticky' && getComputedStyle(e).left !== 'auto',
    )
    return Math.max(0, ...cells.map((c) => c.getBoundingClientRect().width))
  })
  expect(sticky).toBeLessThanOrEqual(page.viewportSize()!.width * 0.45)
  await noHorizontalScroll()
})

test('ajustes de la sección caben en la pantalla', async () => {
  await page.getByTestId('open-section-settings').click()
  const dialog = page.getByTestId('section-settings')
  await fitsScreen(dialog)
  await shot('22-ajustes-seccion')
  for (const tab of await dialog.locator('[data-testid^="section-tab-"]').all()) {
    await tab.click()
    await page.waitForTimeout(200)
    await fitsScreen(dialog)
    await shot(`22-ajustes-${(await tab.getAttribute('data-testid'))!.slice(12)}`)
  }
  await noHorizontalScroll()
  // Editar un campo de selección: sus opciones caben.
  if (await dialog.getByTestId('section-tab-campos').count())
    await dialog.getByTestId('section-tab-campos').click()
  await dialog
    .getByTestId('field-row')
    .filter({ hasText: 'Etapa' })
    .getByRole('button', { name: 'Editar' })
    .click()
  const edit = page.locator('.dialog').last()
  await fitsScreen(edit)
  await shot('22-ajustes-campo')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('menús de la barra de la vista caben en la pantalla', async () => {
  const bar = page.locator('.view-toolbar, .toolbar').first()
  const buttons = await bar.locator('button[aria-haspopup], button[aria-expanded]').all()
  let i = 0
  for (const b of buttons) {
    if (!(await b.isVisible())) continue
    await b.click()
    const pop = page.locator('.popover').first()
    if (await pop.isVisible()) {
      await shot(`23-menu-${i++}`)
      await fitsScreen(pop)
      await noHorizontalScroll()
    }
    await page.keyboard.press('Escape')
    if (await pop.isVisible()) await b.click()
  }
  // Un filtro con sus tres partes.
  await page.getByRole('button', { name: 'Filtrar' }).click()
  await page.getByRole('button', { name: /Añadir filtro/ }).click()
  await expect(page.getByTestId('filter-row')).toBeVisible()
  await shot('23-filtro')
  await fitsScreen(page.locator('.popover').first())
  await page.keyboard.press('Escape')
})

test('Papelera: lista y confirmación caben en la pantalla', async () => {
  await page.evaluate(async () => {
    type Api = { invoke: (c: string, i?: unknown) => Promise<{ ok: boolean; data: unknown }> }
    const api = (window as unknown as { api: Api }).api
    const entities = (await api.invoke('data:entities')).data as { id: string; label: string }[]
    const clients = entities.find((e) => e.label === 'Clientes')!
    const rows = (await api.invoke('data:query', { entity: clients.id })).data as {
      id: string
      title: string
    }[]
    const others = rows.filter((r) => r.title !== 'Acme Moda')
    await api.invoke('data:trash', { ids: others.slice(0, 3).map((r) => r.id) })
  })
  await go('papelera')
  await expect(page.getByTestId('trash-list')).toBeVisible()
  await shot('24-papelera')
  await noHorizontalScroll()
  await page.getByRole('button', { name: 'Vaciar la papelera' }).click()
  const dialog = page.getByRole('alertdialog')
  await fitsScreen(dialog)
  await shot('24-papelera-vaciar')
  await dialog.getByRole('button', { name: 'Cancelar' }).click()
})

test('Campañas: estadísticas de dos en dos y migas debajo', async () => {
  await go('campanas')
  const form = page.getByTestId('meta-connect')
  await form.getByLabel('Token del usuario del sistema').fill(GOOD_TOKEN)
  await form.getByRole('button', { name: 'Conectar' }).click()
  await page.getByRole('button', { name: 'Elegir cuentas' }).click()
  const account = page.getByTestId('meta-account')
  await account.getByLabel('Cliente').selectOption({ label: 'Acme Moda' })
  await account.getByRole('checkbox', { name: 'Sincronizar Tienda Demo' }).click()
  await expect(account).toContainText('Histórico completo', { timeout: 30_000 })
  await shot('25-campanas-cuentas')
  await noHorizontalScroll()
  await page.getByTestId('meta-tab-rendimiento').click()
  const kpis = page.getByTestId('meta-kpis')
  await expect(kpis).toContainText('Importe gastado')
  await shot('25-campanas')
  await noHorizontalScroll()
  // Dos estadísticas por fila, también en un móvil estrecho (360 px).
  const size = page.viewportSize()!
  for (const width of [size.width, 360]) {
    await page.setViewportSize({ width, height: size.height })
    const tops = await kpis.evaluate((k) =>
      [...k.children].slice(0, 4).map((c) => Math.round(c.getBoundingClientRect().top)),
    )
    expect(tops[0]).toBe(tops[1])
    expect(tops[2]).toBe(tops[3])
    expect(tops[2]).toBeGreaterThan(tops[0]!)
    await noHorizontalScroll()
  }
  await shot('25-campanas-360')
  await page.setViewportSize(size)
  const table = page.getByTestId('meta-table')
  await table.getByRole('button', { name: 'Prospecting' }).click()
  await expect(table.getByTestId('meta-row')).toContainText('Broad ES')
  const crumbs = page.getByRole('navigation', { name: 'Nivel' })
  await expect(crumbs).toBeVisible()
  await shot('25-campanas-conjunto')
  // Las migas (Campañas › conjunto › anuncio) van debajo de las estadísticas, junto a la tabla.
  const kBox = (await kpis.boundingBox())!
  const cBox = (await crumbs.boundingBox())!
  expect(cBox.y).toBeGreaterThanOrEqual(kBox.y + kBox.height)
  for (const tab of ['creatividades', 'ajustes', 'cuentas']) {
    const t = page.getByTestId(`meta-tab-${tab}`)
    if (!(await t.count())) continue
    await t.click()
    await page.waitForTimeout(400)
    await shot(`25-campanas-${tab}`)
    await noHorizontalScroll()
  }
})

test('Análisis: cada pestaña sin solapes', async () => {
  await go('analisis')
  await expect(page.getByTestId('widget').first()).toBeVisible()
  for (const tab of ['dashboards', 'comparar', 'alertas']) {
    await page.getByTestId(`analysis-tab-${tab}`).click()
    await page.waitForTimeout(600)
    await shot(`26-analisis-${tab}`)
    await noHorizontalScroll()
    expect(await siblingsOverlap('.widget-grid, .kpis, .page')).toEqual([])
  }
})

test('sin errores en la consola', () => {
  expect(errors).toEqual([])
})
