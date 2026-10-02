import { beforeEach, describe, expect, it, vi } from 'vitest'

const constructed: unknown[] = []

vi.mock('electron', () => {
  class BrowserWindow {
    constructor(options: unknown) {
      constructed.push(options)
    }
    once() {}
    loadURL() {
      return Promise.resolve()
    }
  }
  return { app: { isPackaged: true }, BrowserWindow }
})

describe('ventana principal', () => {
  beforeEach(() => {
    constructed.length = 0
  })

  it('usa las opciones de seguridad de CLAUDE.md', async () => {
    const { createMainWindow } = await import('../../src/main/window')
    createMainWindow({ session: {} as never, preload: '/p.js', url: 'app://crm/index.html' })
    const prefs = (constructed[0] as { webPreferences: Record<string, unknown> }).webPreferences
    expect(prefs).toMatchObject({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      devTools: false,
    })
  })
})
