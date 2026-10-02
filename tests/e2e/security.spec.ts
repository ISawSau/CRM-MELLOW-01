import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { launchApp, type Launched } from './app'

let ctx: Launched

test.beforeAll(async () => {
  ctx = await launchApp()
})
test.afterAll(async () => {
  await ctx.close()
})

test('arranca y muestra la interfaz desde app://crm', async () => {
  await expect(ctx.page.getByTestId('welcome-create')).toBeVisible()
  expect(ctx.page.url()).toBe('app://crm/index.html')
  expect(await ctx.page.title()).toBe('CRM Mellow')
})

test('el proceso de la interfaz corre dentro del sandbox de Chromium', async () => {
  test.skip(process.platform !== 'linux', 'La comprobación con /proc solo existe en Linux')
  const pids = await ctx.app.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .filter((m) => m.type === 'Tab')
      .map((m) => m.pid),
  )
  expect(pids.length).toBeGreaterThan(0)
  for (const pid of pids) {
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0')
    expect(cmdline).not.toContain('--no-sandbox')
    // Seccomp 2 = filtro seccomp-bpf activo: el sandbox de Chromium está funcionando.
    const status = readFileSync(`/proc/${pid}/status`, 'utf8')
    expect(status).toMatch(/^Seccomp:\s+2$/m)
  }
})

test('el renderer no tiene acceso a Node ni a Electron', async () => {
  const globals = await ctx.page.evaluate(() => ({
    require: typeof (globalThis as Record<string, unknown>)['require'],
    process: typeof (globalThis as Record<string, unknown>)['process'],
    module: typeof (globalThis as Record<string, unknown>)['module'],
    apiKeys: Object.keys(window.api).sort(),
    apiFrozen: Object.isFrozen(window.api),
  }))
  expect(globals).toEqual({
    require: 'undefined',
    process: 'undefined',
    module: 'undefined',
    apiKeys: ['invoke', 'on'],
    apiFrozen: true,
  })
})

test('la CSP llega como cabecera y bloquea código inline y eval', async () => {
  // Playwright evalúa por DevTools, que no está sujeto a la CSP; por eso se prueba
  // con código que ejecuta la propia página (temporizador con texto y <script> inline).
  const result = await ctx.page.evaluate(async () => {
    const w = window as unknown as Record<string, unknown>
    setTimeout('window.__evalRan = true' as unknown as TimerHandler, 0)
    const s = document.createElement('script')
    s.textContent = 'window.__inline = true'
    document.body.appendChild(s)
    await new Promise((r) => setTimeout(r, 200))
    return { evalBlocked: w['__evalRan'] !== true, inlineRan: w['__inline'] === true }
  })
  expect(result).toEqual({ evalBlocked: true, inlineRan: false })

  const csp = await ctx.page.evaluate(async () => {
    const res = await fetch('app://crm/index.html')
    return res.headers.get('content-security-policy')
  })
  expect(csp).toContain("default-src 'none'")
  expect(csp).toContain("script-src 'self'")
  expect(csp).not.toContain('unsafe-inline')
  expect(csp).not.toContain('unsafe-eval')
})

test('el renderer no puede salir a internet', async () => {
  const outcome = await ctx.page.evaluate(async () => {
    try {
      await fetch('https://example.com/')
      return 'conectó'
    } catch {
      return 'bloqueado'
    }
  })
  expect(outcome).toBe('bloqueado')
})

test('no se puede salir de la carpeta de la interfaz con ../', async () => {
  const status = await ctx.page.evaluate(async () => {
    // Con barras codificadas el navegador no normaliza la ruta: llega tal cual a la app,
    // que la decodifica a "../main/index.js" (un archivo que existe) y debe rechazarla.
    const res = await fetch('app://crm/..%2fmain%2findex.js')
    return res.status
  })
  expect(status).toBe(404)
})

test('no abre ventanas nuevas ni navega fuera de la app', async () => {
  const opened = await ctx.page.evaluate(() => window.open('http://example.com') === null)
  expect(opened).toBe(true)
  expect(ctx.app.windows()).toHaveLength(1)
  await ctx.page.evaluate(() => {
    window.location.href = 'http://example.com/'
  })
  await ctx.page.waitForTimeout(500)
  expect(ctx.page.url()).toBe('app://crm/index.html')
})

test('IPC: rechaza canales desconocidos, entradas no válidas y rutas no elegidas', async () => {
  const r = await ctx.page.evaluate(async () => {
    const unknown = await window.api
      .invoke('fs:read' as never)
      .then(() => 'aceptado')
      .catch(() => 'rechazado')
    const invalid = await window.api.invoke('vault:unlock', { password: 123 } as never)
    const path = await window.api.invoke('vault:create', {
      parentPath: '/tmp',
      name: 'x',
      password: 'contraseña larga',
    })
    return {
      unknown,
      invalid: invalid.ok ? 'ok' : invalid.error.code,
      path: path.ok ? 'ok' : path.error.code,
    }
  })
  expect(r).toEqual({ unknown: 'rechazado', invalid: 'INVALID_INPUT', path: 'PATH_NOT_ALLOWED' })
})

test('ningún permiso del navegador se concede', async () => {
  const state = await ctx.page.evaluate(async () => {
    const r = await navigator.permissions.query({ name: 'geolocation' as PermissionName })
    return r.state
  })
  expect(state).toBe('denied')
})
