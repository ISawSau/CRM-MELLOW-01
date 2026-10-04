import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'

let ctx: Launched
let page: Page
let parent: string
let errors: string[]
const shots = process.env['E2E_SHOTS']

test.beforeAll(async () => {
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-animacion-'))
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

/** Algún píxel del canvas está pintado (la escena dibuja caracteres). */
const painted = () =>
  page.getByTestId('ascii-art').evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) return true
    return false
  })

for (const [kind, label] of [
  ['gravedad', 'Gravedad (la de yellowmellow.cc)'],
  ['ojo', 'El ojo'],
  ['cerradura', 'Cerradura de la bóveda'],
] as const) {
  test(`pantalla de contraseña con la animación «${label}»`, async () => {
    await page.getByTestId('nav-ajustes').click()
    await page.getByTestId('lock-animation').selectOption(kind)
    await page.getByTestId('sidebar-lock').click()
    const art = page.getByTestId('ascii-art')
    await expect(art).toHaveAttribute('data-kind', kind)
    await expect.poll(painted).toBe(true)
    // Teclear y fallar no rompe nada; después se entra con la buena.
    await page.getByTestId('unlock-password').fill('no es la contraseña')
    await page.getByTestId('unlock-submit').click()
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 30_000 })
    if (shots) await page.screenshot({ path: join(shots, `20-animacion-${kind}.png`) })
    await page.getByTestId('unlock-password').fill('contraseña de prueba')
    await page.getByTestId('unlock-submit').click()
    await page.getByTestId('shell').waitFor({ timeout: 30_000 })
  })
}

test('sin animación si se elige «Ninguna»', async () => {
  await page.getByTestId('nav-ajustes').click()
  await page.getByTestId('lock-animation').selectOption('ninguna')
  await page.getByTestId('sidebar-lock').click()
  await expect(page.getByTestId('unlock-password')).toBeVisible()
  await expect(page.getByTestId('ascii-art')).toHaveCount(0)
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
