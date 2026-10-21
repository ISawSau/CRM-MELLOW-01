import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, protocol: {}, shell: { openExternal: vi.fn() } }))

const { contentSecurityPolicy, devReaderOrigin, isAppUrl, isReaderFrameUrl, readerUrl } =
  await import('../../src/main/security')
const { isReaderPath, readerContentSecurityPolicy } = await import('../../src/main/reader-csp')

describe('CSP', () => {
  it('en producción no permite inline, eval ni orígenes externos', () => {
    const csp = contentSecurityPolicy()
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("script-src 'self';")
    expect(csp).not.toMatch(/unsafe-(inline|eval)/)
    expect(csp).not.toMatch(/https?:/)
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
  })

  it('en desarrollo solo añade el servidor local de Vite', () => {
    const csp = contentSecurityPolicy('http://localhost:5173')
    expect(csp).toContain('http://localhost:5173')
    expect(csp).toContain('ws://localhost:5173')
    expect(csp).not.toContain('unsafe-eval')
  })
})

describe('URLs propias', () => {
  it('reconoce solo app://crm', () => {
    expect(isAppUrl('app://crm/index.html')).toBe(true)
    expect(isAppUrl('app://otro/index.html')).toBe(false)
    expect(isAppUrl('file:///etc/passwd')).toBe(false)
    expect(isAppUrl('https://crm/')).toBe(false)
    expect(isAppUrl('no es una url')).toBe(false)
  })
})

describe('lector de ebooks en otro origen (D-123)', () => {
  it('la app solo puede meter en un marco el lector, y lee los libros de vault:', () => {
    const csp = contentSecurityPolicy()
    expect(csp).toContain('frame-src crm-reader://reader')
    expect(csp).toContain("connect-src 'self' vault:")
    expect(readerUrl()).toBe('crm-reader://reader/reader.html')
    // En desarrollo, el otro nombre del equipo local (otro origen).
    expect(devReaderOrigin('http://localhost:5173')).toBe('http://127.0.0.1:5173')
    expect(devReaderOrigin('http://127.0.0.1:5173')).toBe('http://localhost:5173')
    expect(contentSecurityPolicy('http://localhost:5173')).toContain(
      'frame-src http://127.0.0.1:5173',
    )
  })

  it('el lector no ejecuta scripts de los libros, no sale a la red y solo lo enmarca la app', () => {
    const csp = readerContentSecurityPolicy('app://crm')
    expect(csp).toContain("script-src 'self';")
    expect(csp).not.toMatch(/script-src[^;]*(unsafe|blob:|data:)/)
    expect(csp).toContain('connect-src blob:;')
    expect(csp).toContain('frame-src blob:')
    expect(csp).toContain('frame-ancestors app://crm')
    expect(csp).not.toMatch(/https?:/)
  })

  it('solo sirve su página y los scripts y estilos compilados', () => {
    expect(isReaderPath('/reader.html')).toBe(true)
    expect(isReaderPath('/assets/reader-Ab12_c.js')).toBe(true)
    expect(isReaderPath('/assets/index-x.css')).toBe(true)
    expect(isReaderPath('/index.html')).toBe(false)
    expect(isReaderPath('/assets/../index.html')).toBe(false)
    expect(isReaderPath('/vault/file/abc')).toBe(false)
  })

  it('los marcos solo navegan al lector y a sus capítulos', () => {
    expect(isReaderFrameUrl('crm-reader://reader/reader.html')).toBe(true)
    expect(isReaderFrameUrl('blob:crm-reader://reader/1234-5678')).toBe(true)
    expect(isReaderFrameUrl('about:blank')).toBe(true)
    expect(isReaderFrameUrl('https://evil.test/')).toBe(false)
    expect(isReaderFrameUrl('blob:app://crm/1234')).toBe(false)
    expect(isReaderFrameUrl('crm-reader://otro/x')).toBe(false)
  })
})
