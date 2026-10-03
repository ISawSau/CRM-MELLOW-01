import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectConsoleErrors, createVaultAndEnter, launchApp, type Launched } from './app'
import { startFakeGmail, stubGoogleConsent } from './fake-gmail-server'

/** Gmail en solo lectura: conectar y ver los hilos en las fichas (Google falso). */

let ctx: Launched
let page: Page
let errors: string[]
let parent: string
let closeServer: () => void
const shots = process.env['E2E_SHOTS']

test.beforeAll(async () => {
  const srv = await startFakeGmail()
  closeServer = srv.close
  parent = mkdtempSync(join(tmpdir(), 'crm-e2e-gmail-'))
  ctx = await launchApp([], undefined, srv.env)
  page = ctx.page
  errors = collectConsoleErrors(page)
  await createVaultAndEnter(ctx, parent)
  await stubGoogleConsent(ctx.app)
})

test.afterAll(async () => {
  await ctx.close()
  closeServer()
  rmSync(parent, { recursive: true, force: true })
})

test.describe.configure({ mode: 'serial' })

const panel = () => page.getByTestId('record-panel')

test('sin conectar, la ficha del cliente lo explica', async () => {
  await page.getByTestId('nav-clientes').click()
  await page.getByTestId('new-record').click()
  await panel().locator('#panel-title').fill('Acme')
  await panel().locator('#panel-title').press('Enter')
  const email = panel().getByLabel('Email', { exact: true })
  await email.fill('facturas@acme.com')
  await email.press('Enter')
  await expect(panel().getByTestId('gmail-threads')).toContainText('Conecta Gmail en Ajustes')
  // Un contacto del cliente, con su email.
  const link = panel().getByRole('textbox', { name: 'Enlazar en Contactos' })
  await link.fill('Ana López')
  await link.press('Enter')
  await panel().getByRole('button', { name: 'Abrir Ana López' }).click()
  await expect(page.getByTestId('page-contacto')).toBeVisible()
  const anaEmail = panel().getByLabel('Email', { exact: true })
  await anaEmail.fill('ana@acme.com')
  await anaEmail.press('Enter')
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
})

test('conectar Gmail con el id de cliente del proyecto de Google', async () => {
  await page.getByTestId('nav-perfil').click()
  await page.getByTestId('profile-tab-cuentas').click()
  const g = page.getByTestId('gmail-settings')
  await expect(g).toContainText('Sin conectar')
  await g.getByRole('button', { name: 'Conectar Gmail…' }).click()
  await expect(g.getByRole('button', { name: 'Conectar', exact: true })).toBeDisabled()
  await g.getByLabel('ID de cliente').fill('1234-abc.apps.googleusercontent.com')
  await g.getByRole('button', { name: 'Conectar', exact: true }).click()
  await expect(g).toContainText('yo@agencia.es')
  await expect(g).toContainText('solo lectura')
})

test('la ficha del cliente muestra sus hilos y los de sus contactos', async () => {
  await page.getByTestId('nav-clientes').click()
  await page.getByTestId('table-row').filter({ hasText: 'Acme' }).locator('.grid-open').click()
  const mail = panel().getByTestId('gmail-threads')
  await expect(mail.getByTestId('gmail-thread')).toHaveCount(2)
  await expect(mail).toContainText('Con facturas@acme.com, ana@acme.com')
  const first = mail.getByTestId('gmail-thread').first()
  await expect(first).toContainText('Campaña de otoño')
  await expect(first).toContainText('Ana López, Yo (3)')
  await expect(first).toContainText('sin leer')
  await first.getByRole('button').first().click()
  await expect(first).toContainText('Va genial, te paso el informe & las cifras')
  await expect(first.getByRole('link', { name: 'Abrir en Gmail' })).toHaveAttribute(
    'href',
    /^https:\/\/mail\.google\.com\/mail\/u\/0\/\?authuser=yo%40agencia\.es#all\/t-acme$/,
  )
  if (shots) await page.screenshot({ path: join(shots, '60-gmail-cliente.png') })
})

test('desconectar revoca el permiso', async () => {
  await panel().getByRole('button', { name: 'Cerrar ficha' }).click()
  await page.getByTestId('nav-perfil').click()
  await page.getByTestId('profile-tab-cuentas').click()
  const g = page.getByTestId('gmail-settings')
  await g.getByRole('button', { name: 'Desconectar Gmail' }).click()
  await expect(g).toContainText('Sin conectar')
})

test('sin errores de consola ni de la CSP', () => {
  expect(errors).toEqual([])
})
