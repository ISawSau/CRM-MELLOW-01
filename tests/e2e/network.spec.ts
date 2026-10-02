import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp } from './app'

test('la app no se conecta a internet al arrancar', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'crm-netlog-'))
  const netlog = join(dir, 'net.json')
  const ctx = await launchApp([`--log-net-log=${netlog}`])
  await expect(ctx.page.getByTestId('placeholder')).toBeVisible()
  await ctx.page.waitForTimeout(3000)
  await ctx.close()

  // El registro de red de Chromium incluye todas las peticiones de todos los procesos.
  const log = readFileSync(netlog, 'utf8')
  const urls = [...log.matchAll(/"url":"([^"]+)"/g)].map((m) => m[1]!)
  const external = urls.filter((u) => /^(https?|wss?):/.test(u))
  expect(external).toEqual([])
  rmSync(dir, { recursive: true, force: true })
})
