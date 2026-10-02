import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: {}, protocol: {}, shell: { openExternal: vi.fn() } }))

const { contentSecurityPolicy, isAppUrl } = await import('../../src/main/security')

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
