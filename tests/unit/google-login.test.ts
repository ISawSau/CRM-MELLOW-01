import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CloneStatus } from '../../src/shared/google'
import { AppError } from '../../src/shared/errors'
import { CloneJob } from '../../src/main/sync/clone'
import {
  connectGoogle,
  GoogleLogins,
  pastedParams,
  type ConnectOptions,
} from '../../src/main/sync/google-auth'
import { SyncService } from '../../src/main/sync/sync-service'
import { VaultService } from '../../src/main/vault/vault-service'
import { startFakeGoogle, type FakeGoogle } from '../support/fake-google-server'
import { TEST_KDF, tempDir } from './helpers'

/**
 * Inicio de sesión con Google y «Traer desde Google Drive» (D-118) contra un Google falso
 * por HTTP: cada camino que puede tomar el usuario y cada fallo.
 */

const client = { clientId: 'cliente.apps.googleusercontent.com', clientSecret: 'secreto' }
let g: FakeGoogle
const vaults: VaultService[] = []

beforeEach(async () => {
  g = await startFakeGoogle()
})
afterEach(async () => {
  for (const v of vaults.splice(0)) v.dispose()
  await g.close()
})

const urls = (): ConnectOptions => ({ authUrl: `${g.url}/auth`, tokenUrl: `${g.url}/token` })
/** El navegador: abre la página de Google, que vuelve a la dirección local de la app. */
const browser = (u: string) => void fetch(u).catch(() => {})
/** Un navegador que no consigue volver a la app: solo se queda con la dirección. */
const stuckBrowser = (seen: string[]) => (u: string) =>
  void fetch(u, { redirect: 'manual' })
    .then((r) => seen.push(r.headers.get('location') ?? ''))
    .catch(() => {})
const until = async (ok: () => boolean, ms = 5_000) => {
  const end = Date.now() + ms
  while (!ok()) {
    if (Date.now() > end) throw new Error('no ha pasado a tiempo')
    await new Promise((r) => setTimeout(r, 10))
  }
}

describe('dirección pegada', () => {
  it('acepta la dirección de la barra o solo su final, y nada de otros sitios', () => {
    expect(pastedParams('http://127.0.0.1:4321/?state=s&code=4/abc')?.get('code')).toBe('4/abc')
    expect(pastedParams('  http://localhost:1/?code=x&state=y ')?.get('state')).toBe('y')
    expect(pastedParams('?state=s&code=c')?.get('code')).toBe('c')
    expect(pastedParams('state=s&code=c')?.get('code')).toBe('c')
    expect(pastedParams('http://127.0.0.1:9/?error=access_denied')?.get('error')).toBe(
      'access_denied',
    )
    expect(pastedParams('https://127.0.0.1:1/?code=x')).toBeNull()
    expect(pastedParams('http://malo.example/?code=x&state=y')).toBeNull()
    expect(pastedParams('http://127.0.0.1:1/')).toBeNull()
    expect(pastedParams('hola')).toBeNull()
  })
})

describe('inicio de sesión con Google', () => {
  it('flujo normal: el navegador vuelve solo, se canjea con PKCE y se mantiene viva la app', async () => {
    const holds: string[] = []
    let released = 0
    const logins = new GoogleLogins({
      hold: (text) => {
        holds.push(text)
        return () => released++
      },
      returnUrl: 'intent://volver#Intent;scheme=cc.yellowmellow.crm;end',
    })
    let page = ''
    const tokens = await connectGoogle(
      client,
      (u) =>
        void fetch(u)
          .then((r) => r.text())
          .then((t) => (page = t)),
      fetch,
      { ...urls(), logins },
    )
    expect(tokens).toMatchObject({ accessToken: 'tok', refreshToken: 'renovar' })
    expect(holds).toEqual(['Conectando con Google…'])
    expect(released).toBe(1)
    expect(logins.status()).toEqual({ pending: false, authUrl: null })
    // La página del navegador manda volver a la app, con el botón en Android.
    await until(() => page.length > 0)
    expect(page).toContain('Vuelve a CRM Mellow para terminar')
    expect(page).toContain('href="intent://volver#Intent;scheme=cc.yellowmellow.crm;end"')
  })

  it('si el navegador no vuelve, se pega la dirección: la de otro intento no vale y la buena sí', async () => {
    const logins = new GoogleLogins()
    const seen: string[] = []
    const done = connectGoogle(client, stuckBrowser(seen), fetch, { ...urls(), logins })
    await until(() => seen.length === 1)
    expect(logins.status().pending).toBe(true)
    expect(logins.status().authUrl).toMatch(new RegExp(`^${g.url}/auth\\?`))
    const good = new URL(seen[0]!)
    // De otro intento (otro state): se dice y se sigue esperando.
    const other = new URL(good)
    other.searchParams.set('state', 'otro')
    expect(() => logins.paste(other.toString())).toThrow(/otro intento/)
    expect(() => logins.paste('https://accounts.google.com/x')).toThrow(/no lleva la respuesta/)
    expect(logins.status().pending).toBe(true)
    logins.paste(good.toString())
    expect(await done).toMatchObject({ accessToken: 'tok' })
    // El puerto local ya está cerrado.
    await expect(fetch(`${good.origin}/?code=x`)).rejects.toThrow()
    expect(() => logins.paste(good.toString())).toThrow(/ninguna conexión/)
  })

  it('cancelar, otro inicio de sesión encima, acceso denegado y tiempo agotado', async () => {
    const logins = new GoogleLogins()
    const seen: string[] = []
    const first = connectGoogle(client, stuckBrowser(seen), fetch, { ...urls(), logins })
    await until(() => logins.status().pending)
    // Un segundo inicio de sesión cancela el primero.
    const second = connectGoogle(client, stuckBrowser(seen), fetch, { ...urls(), logins })
    await expect(first).rejects.toThrow('Has cancelado la conexión.')
    await until(() => logins.status().pending)
    logins.cancel()
    await expect(second).rejects.toThrow('Has cancelado la conexión.')
    expect(logins.status().pending).toBe(false)

    g.auth = 'deny'
    await expect(connectGoogle(client, browser, fetch, urls())).rejects.toThrow(
      'Has cancelado la conexión.',
    )
    await expect(
      connectGoogle(client, () => {}, fetch, { ...urls(), timeoutMs: 50 }),
    ).rejects.toThrow(/Se agotó el tiempo/)
    // Con un error, la app también se suelta.
    let released = 0
    const held = new GoogleLogins({ hold: () => () => released++ })
    await expect(
      connectGoogle(client, () => {}, fetch, { ...urls(), logins: held, timeoutMs: 20 }),
    ).rejects.toThrow()
    expect(released).toBe(1)
  })

  it('errores del canje con su explicación; sin red se reintenta y al final se dice la causa', async () => {
    g.token = 'invalid_client'
    await expect(connectGoogle(client, browser, fetch, urls())).rejects.toThrow(
      /no reconoce el id o el secreto/,
    )
    g.token = 'ok'
    // Dos cortes de conexión (Android sin red en segundo plano) y después bien.
    g.dropTokenRequests = 2
    const tokens = await connectGoogle(client, browser, fetch, { ...urls(), retryDelayMs: 10 })
    expect(tokens.accessToken).toBe('tok')
    expect(g.tokenRequests).toBe(4)
    // Sin red durante todo el margen: el fallo llega con su causa.
    g.dropTokenRequests = 1000
    const err = await connectGoogle(client, browser, fetch, {
      ...urls(),
      retryMs: 100,
      retryDelayMs: 20,
    }).then(
      () => null,
      (e: unknown) => e as Error,
    )
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(/fetch failed|socket|other side closed/i)
  })

  it('cancelar durante los reintentos del canje corta enseguida', async () => {
    g.dropTokenRequests = 1000
    const ctrl = new AbortController()
    const done = connectGoogle(client, browser, fetch, {
      ...urls(),
      retryDelayMs: 20,
      signal: ctrl.signal,
    })
    await until(() => g.tokenRequests > 1)
    ctrl.abort()
    await expect(done).rejects.toThrow('Has cancelado la conexión.')
  })
})

describe('traer la bóveda como trabajo del motor', () => {
  /** Sube a Drive una bóveda desde «el ordenador». */
  async function uploadVault(): Promise<{ id: string }> {
    const pc = new VaultService({ kdf: TEST_KDF, hostname: 'portatil' })
    vaults.push(pc)
    await pc.create(tempDir(), 'boveda', 'contraseña larga')
    const record = pc.data.create('cliente', {}, { title: 'Desde el PC' })
    const sync = new SyncService(pc, {
      hostname: 'portatil',
      openBrowser: browser,
      connect: urls(),
      driveUrls: { api: `${g.url}/drive/v3`, upload: `${g.url}/upload/drive/v3` },
    })
    await sync.configureDrive(client)
    await sync.sync()
    expect(sync.status().phase).toBe('idle')
    sync.dispose()
    return { id: record.id }
  }

  function job(openBrowser: (u: string) => void = browser) {
    const states: CloneStatus[] = []
    const opened: string[] = []
    let released = 0
    const logins = new GoogleLogins()
    const j = new CloneJob({
      openBrowser,
      logins,
      connect: { ...urls(), retryDelayMs: 10 },
      driveUrls: { api: `${g.url}/drive/v3`, upload: `${g.url}/upload/drive/v3` },
      hold: () => () => released++,
      opened: (p) => opened.push(p),
      onChange: (s) => states.push(s),
    })
    return { j, states, opened, logins, released: () => released }
  }
  const settled = (j: CloneJob) =>
    until(() => ['done', 'error', 'idle'].includes(j.status().phase), 10_000)

  it('pasa por cada fase, baja la bóveda y la abre; se desbloquea con la contraseña', async () => {
    const { id } = await uploadVault()
    const { j, states, opened, released } = job()
    expect(j.start(client, tempDir()).phase).toBe('login')
    await settled(j)
    expect(j.status().phase).toBe('done')
    const phases = [...new Set(states.map((s) => s.phase))]
    expect(phases).toEqual(['login', 'token', 'search', 'download', 'done'])
    expect(states.some((s) => s.phase === 'download' && s.received > 0)).toBe(true)
    expect(opened).toHaveLength(1)
    expect(released()).toBe(1)
    const phone = new VaultService({ kdf: TEST_KDF, hostname: 'movil' })
    vaults.push(phone)
    phone.open(opened[0]!)
    await phone.unlock('contraseña larga')
    expect(phone.data.get(id)?.title).toBe('Desde el PC')
    expect(j.cancel().phase).toBe('idle')
  })

  it('cada fallo termina en «error» con su explicación y sin dejar la app retenida', async () => {
    await uploadVault()
    const cases: [() => void, RegExp][] = [
      [() => (g.drive = 'other-account'), /misma cuenta de Google/],
      [() => (g.drive = 'disabled'), /API de Google Drive no está activada/],
      [() => (g.auth = 'deny'), /Has cancelado la conexión/],
      [() => (g.token = 'invalid_client'), /no reconoce el id o el secreto/],
    ]
    for (const [setup, message] of cases) {
      g.drive = 'ok'
      g.auth = 'ok'
      g.token = 'ok'
      setup()
      const { j, opened, released } = job()
      j.start(client, tempDir())
      await settled(j)
      expect(j.status().phase).toBe('error')
      expect(j.status().error?.message).toMatch(message)
      expect(j.status().error?.code).toBe(
        message.source.includes('cuenta') ? 'INVALID_INPUT' : 'GOOGLE_ERROR',
      )
      expect(opened).toHaveLength(0)
      expect(released()).toBe(1)
    }
  })

  it('un id de cliente mal copiado se dice sin abrir el navegador', () => {
    let openedBrowser = false
    const { j } = job(() => (openedBrowser = true))
    expect(() => j.start({ clientId: 'GOCSPX-secreto', clientSecret: '' }, tempDir())).toThrow(
      AppError,
    )
    expect(j.status().phase).toBe('idle')
    expect(openedBrowser).toBe(false)
  })

  it('cancelar mientras se espera a Google: vuelve a reposo y no se abre nada', async () => {
    await uploadVault()
    const seen: string[] = []
    const { j, opened, logins, released } = job(stuckBrowser(seen))
    j.start(client, tempDir())
    await until(() => logins.status().pending)
    expect(j.cancel().phase).toBe('idle')
    await until(() => released() === 1)
    expect(logins.status().pending).toBe(false)
    expect(opened).toHaveLength(0)
    // Volver a empezar funciona, esta vez pegando la dirección.
    j.start(client, tempDir())
    await until(() => seen.length === 2)
    logins.paste(seen[1]!)
    await settled(j)
    expect(j.status().phase).toBe('done')
    expect(opened).toHaveLength(1)
  })

  it('empezar otra vez con uno en marcha cancela el anterior', async () => {
    await uploadVault()
    const seen: string[] = []
    const { j, opened, logins } = job(stuckBrowser(seen))
    j.start(client, tempDir())
    await until(() => seen.length === 1)
    j.start(client, tempDir())
    await until(() => seen.length === 2)
    // La dirección del primer intento ya no sirve.
    expect(() => logins.paste(seen[0]!)).toThrow(/otro intento/)
    logins.paste(seen[1]!)
    await settled(j)
    expect(j.status().phase).toBe('done')
    expect(opened).toHaveLength(1)
  })
})
