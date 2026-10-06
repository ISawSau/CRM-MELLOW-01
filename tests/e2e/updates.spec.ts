import { expect, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createVaultAndEnter, launchApp } from './app'

/** Sustituye a la API de GitHub Releases (D-114): siempre hay una versión posterior. */
function fakeReleases(): Promise<{ server: Server; url: string; hits: () => number }> {
  let hits = 0
  const server = createServer((_req, res) => {
    hits++
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        tag_name: 'v99.0.0',
        html_url: 'https://github.com/ISawSau/CRM-MELLOW-01/releases/tag/v99.0.0',
      }),
    )
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/latest`,
        hits: () => hits,
      }),
    ),
  )
}

test('avisa de una versión nueva; se cierra con «Ahora no», se busca y se apaga en Ajustes', async () => {
  const releases = await fakeReleases()
  const parent = mkdtempSync(join(tmpdir(), 'crm-upd-'))
  const ctx = await launchApp([], undefined, { CRM_TEST_RELEASES_URL: releases.url })
  const { page } = ctx
  await createVaultAndEnter(ctx, parent)

  const banner = page.getByTestId('update-banner')
  // El motor mira unos segundos después de abrir la bóveda.
  await expect(banner).toContainText('99.0.0', { timeout: 30_000 })
  await expect(banner.getByRole('link', { name: 'Descargar' })).toHaveAttribute(
    'href',
    'https://github.com/ISawSau/CRM-MELLOW-01/releases/tag/v99.0.0',
  )
  await banner.getByRole('button', { name: 'Ahora no' }).click()
  await expect(banner).toBeHidden()

  await page.getByTestId('nav-ajustes').click()
  const state = page.getByTestId('updates-state')
  await expect(state).toContainText('Hay una versión nueva: 99.0.0.')
  const check = page.getByTestId('updates-check')
  await expect(check).toBeChecked()
  await check.click()
  await expect(check).not.toBeChecked()
  expect(releases.hits()).toBe(1)
  // «Buscar ahora» consulta otra vez aunque el aviso automático esté apagado.
  await page.getByTestId('updates-check-now').click()
  await expect.poll(() => releases.hits()).toBe(2)
  await expect(state).toContainText('Hay una versión nueva: 99.0.0.')

  await ctx.close()
  releases.server.close()
  rmSync(parent, { recursive: true, force: true })
})
