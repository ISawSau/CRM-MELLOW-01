import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { startFakeGoogle, type FakeGoogle } from '../support/fake-google-server'

/**
 * Conectar con Google en la app de Android (D-118), con su motor de verdad y un Google
 * falso: subir la bóveda desde Ajustes, traerla desde Drive con el navegador que vuelve solo
 * o pegando la dirección, cancelar, recargar a medias y cada fallo con su mensaje.
 *
 * Usa su propio motor (otro puerto y otra carpeta de datos) para no mezclarse con
 * movil.spec.ts.
 */
const PORT = 47210
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'contraseña de prueba'
const CLIENT_ID = '1234-abc.apps.googleusercontent.com'

test.describe.configure({ mode: 'serial' })

let google: FakeGoogle
let engine: ChildProcess
let context: BrowserContext
let page: Page
const errors: string[] = []

test.beforeAll(async ({ browser }) => {
  google = await startFakeGoogle()
  engine = spawn(process.execPath, ['tests/e2e-mobile/serve.mjs'], {
    env: { ...process.env, CRM_MOBILE_PORT: String(PORT), CRM_TEST_GOOGLE_URL: google.url },
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
  await google?.close()
})

/**
 * La página de Google que la app ha abierto (el enlace «Abrir otra vez…»), traducida al
 * Google falso: el navegador de verdad iría a accounts.google.com.
 */
async function authUrl(): Promise<string> {
  const link = page.getByRole('link', { name: 'Abrir otra vez la página de Google' })
  await expect(link).toBeVisible()
  const href = new URL((await link.getAttribute('href'))!)
  expect(`${href.origin}${href.pathname}`).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  return `${google.url}/auth${href.search}`
}

/** Un navegador que no consigue volver a la app: se queda con la dirección de la barra. */
async function addressBar(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'manual' })
  return res.headers.get('location')!
}

async function pasteAddress(url: string) {
  await page.getByText('¿El navegador no vuelve a CRM Mellow?').click()
  await page.getByTestId('google-paste').fill(url)
  await page.getByTestId('google-paste-submit').click()
}

async function startClone() {
  await expect(page.getByTestId('welcome-clone')).toBeVisible()
  await page.getByTestId('welcome-clone').click()
  await page.getByTestId('clone-client-id').fill(CLIENT_ID)
  await page.getByTestId('clone-client-secret').fill('GOCSPX-secreto')
  await page.getByTestId('clone-submit').click()
  await expect(page.getByTestId('clone-progress')).toBeVisible()
  await expect(page.getByTestId('clone-waiting')).toBeVisible()
}

/** Desbloquea la bóveda traída y vuelve a la bienvenida para la prueba siguiente. */
async function unlockAndLeave() {
  await expect(page.getByTestId('unlock-password')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('unlock-password').fill(PASSWORD)
  await page.getByTestId('unlock-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('mobile-lock').click()
  await page.getByTestId('unlock-other').click()
  await expect(page.getByTestId('welcome-clone')).toBeVisible()
}

test('crea una bóveda y la conecta a Google Drive pegando la dirección del navegador', async () => {
  await page.goto('/')
  await page.getByTestId('welcome-create').click()
  await page.getByTestId('create-password').fill(PASSWORD)
  await page.getByTestId('create-confirm').fill(PASSWORD)
  await page.getByTestId('create-submit').click()
  await page.getByTestId('recovery-saved').check({ timeout: 30_000 })
  await page.getByTestId('recovery-continue').click()
  await expect(page.getByTestId('shell')).toBeVisible()

  await page.getByTestId('mobile-menu').click()
  await page.getByTestId('nav-ajustes').click()
  const sync = page.getByTestId('sync-settings')
  await sync.getByRole('button', { name: 'Conectar Google Drive…' }).click()
  await sync.locator('#g-id').fill(CLIENT_ID)
  await sync.locator('#g-secret').fill('GOCSPX-secreto')
  await sync.getByRole('button', { name: 'Conectar', exact: true }).click()
  await expect(sync.getByTestId('google-help')).toBeVisible()
  const bar = await addressBar(await authUrl())
  expect(bar).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\?state=/)
  // Pegar algo que no es la dirección se explica y se sigue esperando.
  await pasteAddress('https://accounts.google.com/signin')
  await expect(sync.getByTestId('google-help')).toContainText('no lleva la respuesta de Google')
  await page.getByTestId('google-paste').fill(bar)
  await page.getByTestId('google-paste-submit').click()
  await expect(sync).toContainText('Google Drive', { timeout: 20_000 })
  await expect(sync.getByRole('button', { name: 'Sincronizar ahora' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(sync.getByTestId('google-help')).toHaveCount(0)

  await page.getByTestId('mobile-lock').click()
  await expect(page.getByTestId('unlock-password')).toBeVisible()
  await page.getByTestId('unlock-other').click()
})

test('traer desde Drive: el navegador vuelve solo y la página ofrece volver a la app', async () => {
  await startClone()
  const browserTab = await context.newPage()
  await browserTab.goto(await authUrl())
  await expect(browserTab.getByRole('heading', { name: 'Conectado' })).toBeVisible()
  await expect(browserTab.getByRole('link', { name: 'Volver a CRM Mellow' })).toHaveAttribute(
    'href',
    /^intent:\/\/volver#Intent;scheme=cc\.yellowmellow\.crm;package=cc\.yellowmellow\.crm;end$/,
  )
  await browserTab.close()
  await unlockAndLeave()
})

test('cada fallo se explica y «Volver a intentarlo» sirve después', async () => {
  const cases: [() => void, RegExp][] = [
    [() => (google.auth = 'deny'), /Has cancelado la conexión/],
    [() => (google.token = 'invalid_client'), /no reconoce el id o el secreto/],
    [() => (google.drive = 'disabled'), /API de Google Drive no está activada/],
    [() => (google.drive = 'other-account'), /misma cuenta de Google/],
  ]
  let first = true
  for (const [setup, message] of cases) {
    google.auth = 'ok'
    google.token = 'ok'
    google.drive = 'ok'
    setup()
    if (first) await startClone()
    else {
      await page.getByRole('button', { name: 'Volver a intentarlo' }).click()
      await expect(page.getByTestId('clone-progress')).toBeVisible()
    }
    first = false
    await fetch(await authUrl())
    await expect(page.getByTestId('clone-error')).toContainText(message, { timeout: 20_000 })
  }
  google.drive = 'ok'
  await page.getByRole('button', { name: 'Volver a intentarlo' }).click()
  await fetch(await authUrl())
  await unlockAndLeave()
})

test('cancelar mientras espera a Google y retomar tras recargar la interfaz', async () => {
  await startClone()
  const stale = await addressBar(await authUrl())
  await page.getByTestId('clone-cancel').click()
  await expect(page.getByTestId('clone-form')).toBeVisible()
  // El puerto local de ese intento se ha cerrado.
  await expect(fetch(stale)).rejects.toThrow()

  await page.getByTestId('clone-submit').click()
  await expect(page.getByTestId('clone-progress')).toBeVisible()
  const bar = await addressBar(await authUrl())
  // La WebView puede recargarse (o la app recrearse) con el trabajo en marcha.
  await page.reload()
  await expect(page.getByTestId('clone-progress')).toBeVisible()
  await pasteAddress(stale)
  await expect(page.getByTestId('google-help')).toContainText('otro intento')
  await page.getByTestId('google-paste').fill(bar)
  await page.getByTestId('google-paste-submit').click()
  await unlockAndLeave()
})

test('sin red al volver de Google (Android en segundo plano) se reintenta solo', async () => {
  google.dropTokenRequests = 2
  const before = google.tokenRequests
  await startClone()
  await fetch(await authUrl())
  await unlockAndLeave()
  expect(google.tokenRequests - before).toBeGreaterThanOrEqual(3)
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
