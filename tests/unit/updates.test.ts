import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UpdateService, type InstallResult } from '../../src/main/updates'
import { VaultService } from '../../src/main/vault/vault-service'
import {
  isNewer,
  parseLatestRelease,
  parseVersion,
  RELEASES_LATEST_API,
  RELEASES_PAGE,
  sumFor,
} from '../../src/shared/updates'
import { TEST_KDF, tempDir } from './helpers'

const PAGE = 'https://github.com/ISawSau/CRM-MELLOW-01/releases/tag/v0.17.0'
const DL = 'https://github.com/ISawSau/CRM-MELLOW-01/releases/download/v0.17.0'
const PACMAN = 'CRM-Mellow-0.17.0-linux-x64.pacman'
const BODY = Buffer.from('paquete de la versión nueva '.repeat(5000))
const SHA = createHash('sha256').update(BODY).digest('hex')

describe('versiones', () => {
  it('compara x.y.z y no tiene en cuenta las prereleases', () => {
    expect(parseVersion('v0.16.4')).toEqual([0, 16, 4])
    expect(parseVersion('0.16.4-beta')).toBeNull()
    expect(isNewer('v0.17.0', '0.16.4')).toBe(true)
    expect(isNewer('0.16.10', '0.16.9')).toBe(true)
    expect(isNewer('0.16.4', '0.16.4')).toBe(false)
    expect(isNewer('0.16.3', '0.16.4')).toBe(false)
    expect(isNewer('1.0.0-rc1', '0.16.4')).toBe(false)
  })

  it('lee la respuesta de GitHub: solo enlaces y archivos de los Releases del repositorio', () => {
    const r = parseLatestRelease({
      tag_name: 'v0.17.0',
      html_url: PAGE,
      assets: [
        { name: PACMAN, browser_download_url: `${DL}/${PACMAN}`, size: 10, digest: 'sha256:ab' },
        { name: 'malo.exe', browser_download_url: 'https://malo.example/x.exe', size: 1 },
        { name: '../fuera', browser_download_url: `${DL}/fuera`, size: 1 },
        { nombre: 'no es un archivo' },
      ],
    })
    expect(r).toEqual({
      version: '0.17.0',
      url: PAGE,
      assets: [{ name: PACMAN, url: `${DL}/${PACMAN}`, size: 10, digest: 'sha256:ab' }],
    })
    expect(parseLatestRelease({ tag_name: 'v0.17.0', html_url: 'https://malo.example/x' })).toEqual(
      { version: '0.17.0', url: RELEASES_PAGE, assets: [] },
    )
    expect(parseLatestRelease({ tag_name: 'v0.17.0', prerelease: true })).toBeNull()
    expect(parseLatestRelease({ tag_name: 'último' })).toBeNull()
    expect(parseLatestRelease('basura')).toBeNull()
  })

  it('lee SHA256SUMS.txt', () => {
    const sums = `${'a'.repeat(64)}  otro.exe\n${SHA.toUpperCase()}  ${PACMAN}\n`
    expect(sumFor(sums, PACMAN)).toBe(SHA)
    expect(sumFor(sums, 'no-esta.apk')).toBeNull()
  })
})

// En Windows no se puede borrar la carpeta temporal con la base de datos abierta.
const vaults: VaultService[] = []

interface Setup {
  tag?: string
  /** Huella que da GitHub para el .pacman (null: no la da). */
  digest?: string | null
  /** Contenido de SHA256SUMS.txt (null: no se publica). */
  sums?: string | null
  body?: Buffer
  result?: InstallResult
  /** Sin destino de actualización (desarrollo). */
  noTarget?: boolean
}

async function setup(o: Setup = {}) {
  const vault = new VaultService({ kdf: TEST_KDF, hostname: 'equipo' })
  await vault.create(tempDir(), 'Boveda', 'contraseña de prueba')
  vaults.push(vault)
  let now = Date.parse('2026-10-05T10:00:00Z')
  const calls: { url: string; init?: RequestInit }[] = []
  let fail = false
  const assets: unknown[] = [
    {
      name: PACMAN,
      browser_download_url: `${DL}/${PACMAN}`,
      size: (o.body ?? BODY).length,
      digest: o.digest === undefined ? `sha256:${SHA}` : o.digest,
    },
  ]
  if (o.sums !== null && o.sums !== undefined)
    assets.push({ name: 'SHA256SUMS.txt', browser_download_url: `${DL}/SHA256SUMS.txt`, size: 1 })
  const http = (async (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init ? { init } : {}) })
    if (fail) throw new Error('sin red')
    if (url === `${DL}/${PACMAN}`) return new Response(new Uint8Array(o.body ?? BODY))
    if (url === `${DL}/SHA256SUMS.txt`) return new Response(o.sums ?? '')
    return new Response(JSON.stringify({ tag_name: o.tag ?? 'v0.17.0', html_url: PAGE, assets }))
  }) as unknown as typeof fetch
  const dir = tempDir()
  const installed: string[] = []
  const updates = new UpdateService(vault, {
    current: () => '0.16.4',
    http,
    now: () => now,
    ...(o.noTarget
      ? {}
      : {
          target: {
            suffix: '-linux-x64.pacman',
            dir: () => dir,
            install: async (file: string) => {
              installed.push(file)
              return o.result ?? { kind: 'command', command: `sudo pacman -U "${file}"` }
            },
          },
        }),
  })
  return {
    vault,
    updates,
    calls,
    dir,
    installed,
    advance: (ms: number) => (now += ms),
    setFail: (v: boolean) => (fail = v),
  }
}

describe('aviso de versión nueva (D-114, D-120)', () => {
  afterEach(() => {
    for (const v of vaults.splice(0)) v.dispose()
  })

  it('consulta GitHub sin token y avisa de una versión posterior', async () => {
    const { updates, calls } = await setup()
    expect(updates.status().show).toBe(false)
    await updates.check()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(RELEASES_LATEST_API)
    const headers = calls[0]!.init!.headers as Record<string, string>
    expect(headers.Accept).toBe('application/vnd.github+json')
    expect(Object.keys(headers).some((h) => h.toLowerCase() === 'authorization')).toBe(false)
    expect(updates.status()).toMatchObject({
      current: '0.16.4',
      latest: '0.17.0',
      url: PAGE,
      show: true,
      newer: true,
      checkError: null,
      canInstall: true,
    })
  })

  it('mira cada media hora como mucho (no un día); «Buscar ahora» siempre; el fallo se guarda', async () => {
    const { updates, calls, advance, setFail } = await setup()
    setFail(true)
    await updates.check()
    expect(updates.status()).toMatchObject({ latest: null, checkError: 'sin red' })
    setFail(false)
    await updates.check()
    expect(calls).toHaveLength(2)
    expect(updates.status().checkError).toBeNull()
    advance(20 * 60_000)
    await updates.check()
    expect(calls).toHaveLength(2)
    await updates.check(true)
    expect(calls).toHaveLength(3)
    advance(31 * 60_000)
    await updates.check()
    expect(calls).toHaveLength(4)
    expect(updates.status().checkedAt).toBe(Date.parse('2026-10-05T10:51:00Z'))
  })

  it('no avisa de la misma versión ni con el ajuste apagado; el aviso se puede cerrar', async () => {
    const same = await setup({ tag: 'v0.16.4' })
    await same.updates.check()
    expect(same.updates.status()).toMatchObject({ show: false, newer: false, canInstall: false })

    const { vault, updates, calls } = await setup()
    vault.data.setUpdateSettings({ check: false, dismissed: null })
    await updates.check()
    expect(calls).toHaveLength(0)
    // «Buscar ahora» funciona aunque el aviso automático esté apagado.
    await updates.check(true)
    expect(calls).toHaveLength(1)
    expect(updates.status().show).toBe(false)
    vault.data.setUpdateSettings({ check: true, dismissed: null })
    expect(updates.status().show).toBe(true)
    vault.data.setUpdateSettings({ ...vault.data.getUpdateSettings(), dismissed: '0.17.0' })
    expect(updates.status()).toMatchObject({ show: false, newer: true })
  })

  it('con la bóveda bloqueada o sin URL (desarrollo y tests) no sale a internet', async () => {
    const { vault, updates, calls } = await setup()
    vault.lock()
    await updates.check()
    await updates.check(true)
    expect(calls).toHaveLength(0)
    expect(updates.status().show).toBe(false)
    const off = new UpdateService(vault, { current: () => '0.16.4', url: null })
    await off.check(true)
    expect(off.status().latest).toBeNull()
  })
})

describe('actualizar desde la app (D-120)', () => {
  afterEach(() => {
    for (const v of vaults.splice(0)) v.dispose()
  })

  it('baja el archivo de su sistema, comprueba la huella de GitHub y lo instala', async () => {
    const { updates, installed, dir } = await setup()
    await updates.check()
    const s = await updates.install()
    const file = join(dir, PACMAN)
    expect(installed).toEqual([file])
    expect(readFileSync(file).equals(BODY)).toBe(true)
    expect(existsSync(`${file}.part`)).toBe(false)
    expect(s.download).toMatchObject({
      phase: 'command',
      command: `sudo pacman -U "${file}"`,
      received: BODY.length,
      file,
    })
  })

  it('sin la huella de GitHub usa SHA256SUMS.txt; sin ninguna de las dos no instala', async () => {
    const withSums = await setup({ digest: null, sums: `${SHA}  ${PACMAN}\n` })
    await withSums.updates.check()
    expect((await withSums.updates.install()).download.phase).toBe('command')

    const none = await setup({ digest: null })
    await none.updates.check()
    const s = await none.updates.install()
    expect(s.download).toMatchObject({ phase: 'error' })
    expect(s.download.message).toMatch(/huella SHA-256/)
    expect(none.installed).toEqual([])
  })

  it('un archivo alterado no se instala y no se queda en el disco', async () => {
    const { updates, installed, dir } = await setup({ body: Buffer.from('alterado') })
    await updates.check()
    const s = await updates.install()
    expect(s.download.phase).toBe('error')
    expect(s.download.message).toMatch(/no coincide con su huella/)
    expect(installed).toEqual([])
    expect(existsSync(join(dir, PACMAN))).toBe(false)
    expect(existsSync(join(dir, `${PACMAN}.part`))).toBe(false)
  })

  it('Windows y AppImage se instalan y reinician; Android puede pedir permiso', async () => {
    const win = await setup({ result: { kind: 'installing' } })
    await win.updates.check()
    expect((await win.updates.install()).download.phase).toBe('installing')
    const android = await setup({ result: { kind: 'permission' } })
    await android.updates.check()
    expect((await android.updates.install()).download.phase).toBe('permission')
    // Tras dar el permiso, «Actualizar» otra vez instala.
    expect((await android.updates.install()).download.phase).toBe('permission')
    expect(android.installed).toHaveLength(2)
  })

  it('sin destino (desarrollo) o sin archivo para este sistema solo se avisa', async () => {
    const dev = await setup({ noTarget: true })
    await dev.updates.check()
    expect(dev.updates.status()).toMatchObject({ show: true, canInstall: false })
    expect((await dev.updates.install()).download.phase).toBe('idle')
    expect(dev.calls).toHaveLength(1)
  })
})
