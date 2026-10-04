import { expect, test, type Page } from '@playwright/test'

/**
 * La app de Android en pantalla de móvil (D-101), contra el mismo servidor local que lleva el
 * APK. E2E_SHOTS=<carpeta> guarda capturas de cada pantalla para revisarlas.
 */
const SHOTS = process.env['E2E_SHOTS']

test.describe.configure({ mode: 'serial' })

let page: Page
const errors: string[] = []

const shot = async (name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` })
}

/** Ninguna página se sale de la pantalla en horizontal (lo ancho se desplaza en su caja). */
const noHorizontalScroll = async () =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  )

const back = () =>
  page.evaluate(() => (window as { __crmBack?: () => boolean }).__crmBack?.() ?? false)

test.beforeAll(async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    ...test.info().project.use,
  })
  await context.addCookies([{ name: 'crm', value: 'e2e-secreto', url: baseURL! }])
  page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errors.push(m.text())
  })
})

test('sin el secreto de la sesión no se ve nada', async ({ baseURL }) => {
  expect((await fetch(baseURL!)).status).toBe(403)
  expect((await fetch(baseURL!, { headers: { Cookie: 'crm=otro' } })).status).toBe(403)
})

test('crea la bóveda sin elegir carpeta y entra', async () => {
  await page.goto('/')
  await expect(page.getByTestId('welcome-create')).toBeVisible()
  await expect(page.getByTestId('welcome-clone')).toBeVisible()
  // En el móvil no se abre una carpeta suelta: la bóveda vive dentro de la app.
  await expect(page.getByTestId('welcome-open')).toHaveCount(0)
  await shot('01-bienvenida')
  await page.getByTestId('welcome-create').click()
  await expect(page.getByTestId('create-pick')).toHaveCount(0)
  await page.getByTestId('create-password').fill('contraseña de prueba')
  await page.getByTestId('create-confirm').fill('contraseña de prueba')
  await page.getByTestId('create-submit').click()
  await page.getByTestId('recovery-saved').check({ timeout: 30_000 })
  await shot('02-recuperacion')
  await page.getByTestId('recovery-continue').click()
  await expect(page.getByTestId('shell')).toBeVisible()
  await expect(page.getByTestId('mobile-topbar')).toContainText('Inicio')
  await expect(page.getByTestId('mobile-tabbar')).toBeVisible()
  await page.waitForTimeout(1000)
  await shot('03-inicio')
  await noHorizontalScroll()
})

test('menú lateral: se abre, navega y se cierra; sin secciones de escritorio', async () => {
  await page.getByTestId('mobile-menu').click()
  await expect(page.getByTestId('nav-ajustes')).toBeVisible()
  await expect(page.getByTestId('nav-herramientas')).toHaveCount(0)
  await expect(page.getByTestId('nav-informes')).toHaveCount(0)
  await page.waitForTimeout(400)
  await shot('04-menu')
  await page.getByTestId('nav-facturacion').click()
  await expect(page.getByTestId('nav-ajustes')).toBeHidden()
  await expect(page.getByTestId('mobile-topbar')).toContainText('Facturación')
  await expect(page.getByTestId('tab-more')).toHaveAttribute('aria-current', 'page')
  await shot('05-facturacion')
  await noHorizontalScroll()
})

test('barra inferior, un cliente nuevo en ficha a pantalla completa y «atrás»', async () => {
  await page.getByTestId('tab-clientes').click()
  await expect(page.getByTestId('page-cliente')).toBeVisible()
  await page.getByTestId('new-record').click()
  const panel = page.getByTestId('record-panel')
  await panel.locator('#panel-title').fill('Acme Móvil')
  await panel.locator('#panel-title').press('Enter')
  const box = await panel.boundingBox()
  expect(box?.width).toBe(page.viewportSize()!.width)
  await shot('06-ficha')
  // «Atrás» de Android cierra la ficha y después vuelve a Inicio.
  expect(await back()).toBe(true)
  await expect(panel).toHaveCount(0)
  await expect(page.getByText('Acme Móvil')).toBeVisible()
  await shot('07-clientes')
  await noHorizontalScroll()
  expect(await back()).toBe(true)
  await expect(page.getByTestId('mobile-topbar')).toContainText('Inicio')
  expect(await back()).toBe(false)
})

test('las demás pantallas caben a lo ancho', async () => {
  for (const s of ['tareas', 'campanas']) {
    await page.getByTestId(`tab-${s}`).click()
    await page.waitForTimeout(500)
    await shot(`08-${s}`)
    await noHorizontalScroll()
  }
  for (const s of ['perfil', 'analisis', 'creatividades', 'horas', 'ajustes']) {
    await page.getByTestId('mobile-menu').click()
    await page.getByTestId(`nav-${s}`).click()
    await page.waitForTimeout(500)
    await shot(`09-${s}`)
    await noHorizontalScroll()
  }
  // La sincronización en el móvil es solo con Google Drive.
  await expect(page.getByTestId('sync-folder')).toHaveCount(0)
})

test('bloquea desde la barra superior', async () => {
  await page.getByTestId('mobile-lock').click()
  await expect(page.getByTestId('unlock-password')).toBeVisible()
  await shot('10-bloqueada')
  expect(errors).toEqual([])
})
