import { expect, test } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectConsoleErrors, launchApp, stubFolderPicker } from './app'

test('crear, usar, bloquear, recuperar y reabrir una bóveda', async () => {
  test.setTimeout(120_000)
  const parent = mkdtempSync(join(tmpdir(), 'crm-e2e-vault-'))
  const userData = mkdtempSync(join(tmpdir(), 'crm-e2e-ud-'))
  const vaultPath = join(parent, 'CRM-Boveda')

  // --- Primera sesión: crear la bóveda ---
  let ctx = await launchApp([], userData)
  let page = ctx.page
  const errors = collectConsoleErrors(page)
  await stubFolderPicker(ctx.app, parent)

  await page.getByTestId('welcome-create').click()
  await page.getByTestId('create-pick').click()
  await expect(page.getByTestId('create-parent')).toHaveText(parent)

  // Contraseña corta: se rechaza en la interfaz.
  await page.getByTestId('create-password').fill('aaaa')
  await page.getByTestId('create-confirm').fill('aaaa')
  await page.getByTestId('create-submit').click()
  await expect(page.getByRole('alert')).toContainText('al menos 8 caracteres')

  // 10 caracteres iguales: válida (solo se exige la longitud).
  await page.getByTestId('create-password').fill('aaaaaaaaaa')
  await page.getByTestId('create-confirm').fill('aaaaaaaaaa')
  await page.getByTestId('create-submit').click()

  const keyEl = page.getByTestId('recovery-key')
  await expect(keyEl).toBeVisible({ timeout: 30_000 })
  const recoveryKey = (await keyEl.textContent())!.trim()
  expect(recoveryKey).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
  await expect(page.getByTestId('recovery-continue')).toBeDisabled()
  await page.getByTestId('recovery-saved').check()
  await page.getByTestId('recovery-continue').click()

  // --- Estructura principal ---
  await expect(page.getByTestId('shell')).toBeVisible()
  await expect(page.getByTestId('statusbar')).toContainText('CRM-Boveda')
  await expect(page.getByTestId('page-inicio')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('mellow')
  expect(await page.evaluate(() => document.documentElement.dataset['density'])).toBe('compacta')
  for (const f of ['vault.json', 'crm.db', 'files', 'thumbs', 'backups', '.lock']) {
    expect(existsSync(join(vaultPath, f)), f).toBe(true)
  }

  // Navegación por la barra lateral.
  await page.getByTestId('nav-facturacion').click()
  await expect(page.getByTestId('page-facturacion')).toContainText('Beneficio por cliente')

  // Paleta Ctrl+K: cambiar al tema claro.
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('palette')).toBeVisible()
  await page.keyboard.type('tema claro')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('palette')).toBeHidden()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['theme']))
    .toBe('claro')
  // Escape cierra la paleta.
  await page.keyboard.press('Control+k')
  await expect(page.getByTestId('palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette')).toBeHidden()

  // Ajustes: densidad cómoda.
  await page.getByTestId('nav-ajustes').click()
  await page.getByTestId('density-comoda').click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset['density']))
    .toBe('comoda')

  // --- Bloquear y desbloquear ---
  await page.getByTestId('sidebar-lock').click()
  await expect(page.getByTestId('unlock-name')).toHaveText('CRM-Boveda')
  expect(existsSync(join(vaultPath, '.lock'))).toBe(false)
  // Bloqueada: se vuelve a la apariencia por defecto.
  expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('mellow')

  await page.getByTestId('unlock-password').fill('contraseña equivocada')
  await page.getByTestId('unlock-submit').click()
  await expect(page.getByRole('alert')).toContainText('La contraseña no es correcta')

  await page.getByTestId('unlock-password').fill('aaaaaaaaaa')
  await page.getByTestId('unlock-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  // La apariencia se guardó dentro de la bóveda.
  expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('claro')
  expect(await page.evaluate(() => document.documentElement.dataset['density'])).toBe('comoda')

  // --- Recuperar con la clave de recuperación ---
  await page.getByTestId('sidebar-lock').click()
  await page.getByText('He olvidado la contraseña').click()
  await page.getByTestId('recover-key').fill(recoveryKey.toLowerCase())
  await page.getByTestId('recover-password').fill('11111111')
  await page.getByTestId('recover-confirm').fill('11111111')
  await page.getByTestId('recover-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })

  expect(errors).toEqual([])
  await ctx.close()

  // Al cerrar: sin lock ni archivos -wal/-shm sueltos.
  const files = readdirSync(vaultPath)
  expect(files).not.toContain('.lock')
  expect(files.filter((f) => f.endsWith('-wal') || f.endsWith('-shm'))).toEqual([])

  // --- Segunda sesión: recuerda la bóveda y pide la contraseña nueva ---
  ctx = await launchApp([], userData)
  page = ctx.page
  await expect(page.getByTestId('unlock-name')).toHaveText('CRM-Boveda')
  await page.getByTestId('unlock-password').fill('aaaaaaaaaa')
  await page.getByTestId('unlock-submit').click()
  await expect(page.getByRole('alert')).toContainText('La contraseña no es correcta')
  await page.getByTestId('unlock-password').fill('11111111')
  await page.getByTestId('unlock-submit').click()
  await expect(page.getByTestId('shell')).toBeVisible({ timeout: 30_000 })
  await ctx.close()

  rmSync(parent, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})
