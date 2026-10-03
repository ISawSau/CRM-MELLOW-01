/**
 * API de Gmail (v1) y OAuth de Google simulados con las llamadas que usa la app:
 * token, revoke, users.getProfile, users.threads.list (con la búsqueda por
 * from/to/cc agrupada con llaves) y users.threads.get en formato metadata.
 */

export interface FakeMail {
  id: string
  from: string
  to: string
  cc?: string
  subject: string
  date: string
  snippet: string
  unread?: boolean
}

export const FAKE_GOOGLE = 'https://google.test'

export class FakeGmail {
  readonly calls: string[] = []
  readonly revoked: string[] = []
  readonly threads = new Map<string, FakeMail[]>()
  /** Token de acceso válido en cada momento (el siguiente refresco cambia el valor). */
  access = 'acceso-1'
  private refreshes = 0
  /** Respuesta forzada para la siguiente llamada a la API. */
  failNext: { status: number; body: unknown } | null = null

  constructor(readonly base = FAKE_GOOGLE) {}

  thread(id: string, mails: FakeMail[]): this {
    this.threads.set(id, mails)
    return this
  }

  /** Simula que el token de acceso ha caducado. */
  expireAccess(): void {
    this.access = `caducado-${this.refreshes}`
  }

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input))
    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    this.calls.push(`${init.method ?? 'GET'} ${url.pathname}${url.search ? '?…' : ''}`)

    if (url.pathname === '/token') {
      const body = new URLSearchParams(String(init.body ?? ''))
      if (body.get('grant_type') === 'authorization_code')
        return json({ access_token: this.access, refresh_token: 'renovar-gmail', expires_in: 3600 })
      if (body.get('refresh_token') !== 'renovar-gmail')
        return json({ error: 'invalid_grant' }, 400)
      this.access = `acceso-${++this.refreshes + 1}`
      return json({ access_token: this.access, expires_in: 3600 })
    }
    if (url.pathname === '/revoke') {
      this.revoked.push(new URLSearchParams(String(init.body ?? '')).get('token') ?? '')
      return json({})
    }

    const auth = new Headers(init.headers).get('authorization')
    if (auth !== `Bearer ${this.access}`)
      return json({ error: { code: 401, message: 'Invalid Credentials' } }, 401)
    if (this.failNext) {
      const f = this.failNext
      this.failNext = null
      return json(f.body, f.status)
    }

    const m = /^\/gmail\/v1\/users\/me\/(profile|threads)(?:\/([^/]+))?$/.exec(url.pathname)
    if (!m) return json({ error: { code: 404 } }, 404)
    if (m[1] === 'profile')
      return json({ emailAddress: 'yo@agencia.es', messagesTotal: 10, threadsTotal: 5 })

    if (!m[2]) {
      const q = url.searchParams.get('q') ?? ''
      const wanted = [...q.matchAll(/(?:from|to|cc):([^\s{}]+)/g)].map((x) => x[1]!.toLowerCase())
      const matches = [...this.threads.entries()]
        .filter(([, mails]) =>
          mails.some((ml) =>
            [ml.from, ml.to, ml.cc ?? ''].some((h) =>
              wanted.some((w) => h.toLowerCase().includes(w)),
            ),
          ),
        )
        .sort((a, b) => b[1].at(-1)!.date.localeCompare(a[1].at(-1)!.date))
      const max = Number(url.searchParams.get('maxResults') ?? 100)
      const start = Number(url.searchParams.get('pageToken') ?? 0)
      const page = matches.slice(start, start + max)
      return json({
        threads: page.map(([id, mails]) => ({
          id,
          snippet: mails.at(-1)!.snippet,
          historyId: '1',
        })),
        ...(start + max < matches.length ? { nextPageToken: String(start + max) } : {}),
        resultSizeEstimate: matches.length,
      })
    }

    const mails = this.threads.get(decodeURIComponent(m[2]))
    if (!mails) return json({ error: { code: 404 } }, 404)
    const headers = url.searchParams.getAll('metadataHeaders')
    return json({
      id: m[2],
      historyId: '1',
      messages: mails.map((ml) => ({
        id: ml.id,
        threadId: m[2],
        labelIds: ml.unread ? ['INBOX', 'UNREAD'] : ['INBOX'],
        snippet: ml.snippet,
        internalDate: String(Date.parse(ml.date)),
        payload: {
          headers: [
            { name: 'From', value: ml.from },
            { name: 'To', value: ml.to },
            { name: 'Subject', value: ml.subject },
          ].filter((h) => headers.includes(h.name)),
        },
      })),
    })
  }
}

/** Correo de ejemplo: un hilo con Acme, otro con un contacto y uno ajeno. */
export function sampleGmail(base?: string): FakeGmail {
  return new FakeGmail(base)
    .thread('t-acme', [
      {
        id: 'm1',
        from: 'Ana López <ana@acme.com>',
        to: 'yo@agencia.es',
        subject: 'Campaña de otoño',
        date: '2026-09-28T09:00:00Z',
        snippet: 'Hola, ¿cómo va la campaña?',
      },
      {
        id: 'm2',
        from: 'Yo <yo@agencia.es>',
        to: 'ana@acme.com',
        subject: 'Re: Campaña de otoño',
        date: '2026-09-29T10:00:00Z',
        snippet: 'Va genial, te paso el informe &amp; las cifras',
      },
      {
        id: 'm3',
        from: 'Ana López <ana@acme.com>',
        to: 'yo@agencia.es',
        subject: 'Re: Campaña de otoño',
        date: '2026-10-01T08:30:00Z',
        snippet: '¡Perfecto, gracias!',
        unread: true,
      },
    ])
    .thread('t-factura', [
      {
        id: 'm4',
        from: 'yo@agencia.es',
        to: 'facturas@acme.com',
        cc: 'Ana López <ana@acme.com>',
        subject: 'Factura F-001',
        date: '2026-09-15T12:00:00Z',
        snippet: 'Adjunto la factura de septiembre.',
      },
    ])
    .thread('t-otro', [
      {
        id: 'm5',
        from: 'boletin@tienda.com',
        to: 'yo@agencia.es',
        subject: 'Ofertas',
        date: '2026-10-02T08:00:00Z',
        snippet: 'No te lo pierdas',
      },
    ])
}
