import {
  _electron as electron,
  type ElectronApplication,
  type Locator,
  type Page,
} from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface Launched {
  app: ElectronApplication
  page: Page
  userData: string
  close: () => Promise<void>
}

/** Arranca la app compilada (out/) con una carpeta de datos temporal. */
export async function launchApp(
  extraArgs: string[] = [],
  existingUserData?: string,
): Promise<Launched> {
  const userData = existingUserData ?? mkdtempSync(join(tmpdir(), 'crm-e2e-'))
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (e): e is [string, string] => e[1] !== undefined && e[0] !== 'ELECTRON_RENDERER_URL',
    ),
  )
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, ...extraArgs],
    env,
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return {
    app,
    page,
    userData,
    close: async () => {
      await app.close()
      if (!existingUserData) rmSync(userData, { recursive: true, force: true })
    },
  }
}

/** Sustituye el selector nativo de carpetas por uno que devuelve `dir`. */
export async function stubFolderPicker(app: ElectronApplication, dir: string): Promise<void> {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as never
  }, dir)
}

/** Recoge errores de consola (incluidas las violaciones de la CSP) de la interfaz. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /Content Security Policy/i.test(msg.text()))
      errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

/** Crea una bóveda nueva en `parent` y entra en la app (pantalla principal). */
export async function createVaultAndEnter(ctx: Launched, parent: string): Promise<void> {
  const { app, page } = ctx
  await stubFolderPicker(app, parent)
  await page.getByTestId('welcome-create').click()
  await page.getByTestId('create-pick').click()
  await page.getByTestId('create-password').fill('contraseña de prueba')
  await page.getByTestId('create-confirm').fill('contraseña de prueba')
  await page.getByTestId('create-submit').click()
  await page.getByTestId('recovery-saved').check({ timeout: 30_000 })
  await page.getByTestId('recovery-continue').click()
  await page.getByTestId('shell').waitFor()
}

/** Sustituye el diálogo nativo de «Guardar como» por uno que devuelve `file`. */
export async function stubSaveDialog(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
  }, file)
}

/** Arrastra con el ratón paso a paso (dnd-kit necesita movimientos intermedios). */
export async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  await to.scrollIntoViewIfNeeded()
  await from.scrollIntoViewIfNeeded()
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + a.width / 2 + 10, a.y + a.height / 2 + 10, { steps: 5 })
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 60), { steps: 15 })
  await page.mouse.up()
}

/** Hoy (AAAA-MM-DD) en Madrid. */
export function todayMadrid(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
}
