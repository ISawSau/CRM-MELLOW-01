import { afterEach, describe, expect, it } from 'vitest'
import {
  gmailThreadUrl,
  normalizeAddresses,
  parseMailbox,
  threadQuery,
} from '../../src/shared/gmail'
import { decodeEntities, GmailService } from '../../src/main/gmail/gmail-service'
import { VaultService } from '../../src/main/vault/vault-service'
import { FAKE_GOOGLE, sampleGmail, type FakeGmail } from './gmail-fake'
import { TEST_KDF, tempDir } from './helpers'

/** El «navegador» vuelve a la dirección local con el código. */
const browser = (u: string) => {
  const url = new URL(u)
  void fetch(
    `${url.searchParams.get('redirect_uri')}/?code=codigo&state=${url.searchParams.get('state')}`,
  )
}

describe('búsqueda y cabeceras de Gmail', () => {
  it('normaliza direcciones y arma la búsqueda con llaves', () => {
    expect(
      normalizeAddresses([' Ana@Acme.com ', 'ana@acme.com', 'no es email', 3, 'x@y.es']),
    ).toEqual(['ana@acme.com', 'x@y.es'])
    expect(threadQuery(['a@b.es', 'c@d.es'])).toBe(
      '{from:a@b.es to:a@b.es cc:a@b.es from:c@d.es to:c@d.es cc:c@d.es}',
    )
    expect(parseMailbox('"López, Ana" <Ana@Acme.com>')).toEqual({
      name: 'López, Ana',
      address: 'ana@acme.com',
    })
    expect(parseMailbox('ana@acme.com')).toEqual({ name: 'ana@acme.com', address: 'ana@acme.com' })
    expect(decodeEntities('Hola &amp; adiós, &#39;ok&#39; &lt;3')).toBe("Hola & adiós, 'ok' <3")
    expect(gmailThreadUrl('abc', 'yo@agencia.es')).toBe(
      'https://mail.google.com/mail/u/0/?authuser=yo%40agencia.es#all/abc',
    )
  })
})

describe('servicio de Gmail', () => {
  const vaults: VaultService[] = []
  afterEach(() => {
    for (const v of vaults.splice(0)) v.dispose()
  })

  async function setup(fake: FakeGmail = sampleGmail()) {
    const vault = new VaultService({ kdf: TEST_KDF, hostname: 'equipo' })
    await vault.create(tempDir(), 'Boveda', 'contraseña de prueba')
    vaults.push(vault)
    let drive: { clientId: string; clientSecret: string } | null = null
    const gmail = new GmailService(vault, {
      http: fake.fetch as typeof fetch,
      openBrowser: browser,
      driveClient: () => drive,
      apiUrl: `${FAKE_GOOGLE}/gmail/v1`,
      tokenUrl: `${FAKE_GOOGLE}/token`,
      revokeUrl: `${FAKE_GOOGLE}/revoke`,
    })
    const d = vault.data
    const fid = (e: string, k: string) => d.listFields(e).find((f) => f.key === k)!.id
    const acme = d.create('cliente', {
      [fid('cliente', 'nombre')]: 'Acme',
      [fid('cliente', 'email')]: 'facturas@acme.com',
    })
    const ana = d.create('contacto', {
      [fid('contacto', 'nombre')]: 'Ana López',
      [fid('contacto', 'email')]: 'ana@acme.com',
    })
    d.setLinks(fid('contacto', 'cliente'), ana.id, [acme.id])
    const vacio = d.create('cliente', { [fid('cliente', 'nombre')]: 'Sin email' })
    return {
      vault,
      gmail,
      fake,
      acme,
      ana,
      vacio,
      setDrive: (c: typeof drive) => (drive = c),
    }
  }

  it('conecta con el cliente de Drive o uno propio y lee la cuenta', async () => {
    const { gmail, setDrive } = await setup()
    expect(gmail.status()).toMatchObject({ connected: false, hasClient: false })
    await expect(gmail.connect({ clientId: '', clientSecret: '' })).rejects.toThrow(/id de cliente/)
    setDrive({ clientId: 'drive.apps.googleusercontent.com', clientSecret: 's' })
    expect(gmail.status().hasClient).toBe(true)
    const s = await gmail.connect({ clientId: '', clientSecret: '' })
    expect(s).toMatchObject({ connected: true, email: 'yo@agencia.es', error: null })
  })

  it('hilos de un cliente (con sus contactos) y de un contacto, con caché y token renovado', async () => {
    const { gmail, fake, acme, ana, vacio } = await setup()
    await gmail.connect({ clientId: 'propio.apps.googleusercontent.com', clientSecret: 'x' })
    expect(gmail.addressesFor(acme.id)).toEqual(['facturas@acme.com', 'ana@acme.com'])

    const r = await gmail.threads({ recordId: acme.id, pageToken: null, refresh: false })
    expect(r.threads.map((t) => t.id)).toEqual(['t-acme', 't-factura'])
    const t = r.threads[0]!
    expect(t).toMatchObject({
      subject: 'Campaña de otoño',
      participants: ['Ana López', 'Yo'],
      count: 3,
      unread: true,
      snippet: '¡Perfecto, gracias!',
      lastDate: '2026-10-01T08:30:00.000Z',
    })
    expect(t.messages[1]).toMatchObject({
      from: 'Yo',
      snippet: 'Va genial, te paso el informe & las cifras',
      unread: false,
    })
    expect(r.nextPageToken).toBeNull()

    // En caché: no vuelve a llamar a Gmail; «Actualizar» sí.
    const before = fake.calls.length
    await gmail.threads({ recordId: acme.id, pageToken: null, refresh: false })
    expect(fake.calls.length).toBe(before)
    fake.expireAccess()
    const again = await gmail.threads({ recordId: ana.id, pageToken: null, refresh: true })
    expect(again.threads.map((x) => x.id)).toEqual(['t-acme', 't-factura'])
    expect(fake.calls).toContain('POST /token')

    // Sin direcciones: no se busca nada.
    const n = fake.calls.length
    expect(await gmail.threads({ recordId: vacio.id, pageToken: null, refresh: false })).toEqual({
      addresses: [],
      threads: [],
      nextPageToken: null,
    })
    expect(fake.calls.length).toBe(n)
  })

  it('explica los límites de uso y la API desactivada, y al desconectar revoca el permiso', async () => {
    const { gmail, fake, acme } = await setup()
    await gmail.connect({ clientId: 'propio.apps.googleusercontent.com', clientSecret: 'x' })
    fake.failNext = { status: 429, body: { error: { code: 429, message: 'Too many' } } }
    await expect(
      gmail.threads({ recordId: acme.id, pageToken: null, refresh: true }),
    ).rejects.toThrow(/límite de uso/)
    fake.failNext = {
      status: 403,
      body: {
        error: {
          code: 403,
          errors: [{ reason: 'accessNotConfigured' }],
          message: 'Gmail API has not been used',
        },
      },
    }
    await expect(
      gmail.threads({ recordId: acme.id, pageToken: null, refresh: true }),
    ).rejects.toThrow(/Activa la API de Gmail/)
    expect(gmail.status().error).toMatch(/Activa la API/)

    const s = await gmail.disconnect()
    expect(s).toMatchObject({ connected: false, email: null, error: null })
    expect(fake.revoked).toEqual(['renovar-gmail'])
    await expect(
      gmail.threads({ recordId: acme.id, pageToken: null, refresh: false }),
    ).rejects.toThrow(/no está conectado/)
  })
})
