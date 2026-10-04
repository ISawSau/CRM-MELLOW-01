/**
 * JSON del canal entre la interfaz y el motor en Android (D-101). Igual que JSON, salvo
 * los bytes (`Uint8Array`, también `Buffer`), que viajan como `{ "$b64": "…" }`: el IPC de
 * Electron los pasa tal cual y algunos canales los usan (subir archivos, miniaturas, PDF).
 */

const KEY = '$b64'

const hasBuffer = typeof (globalThis as { Buffer?: unknown }).Buffer === 'function'

function toBase64(bytes: Uint8Array): string {
  if (hasBuffer)
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function fromBase64(text: string): Uint8Array {
  if (hasBuffer) {
    const b = Buffer.from(text, 'base64')
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength)
  }
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function encodeWire(value: unknown): string {
  return JSON.stringify(value, function (this: Record<string, unknown>, key, v: unknown) {
    // `Buffer.toJSON` se aplica antes que esta función: se mira el valor original.
    const raw = key === '' ? value : this[key]
    if (raw instanceof Uint8Array) return { [KEY]: toBase64(raw) }
    return v
  })
}

export function decodeWire(text: string): unknown {
  return JSON.parse(text, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const keys = Object.keys(v)
      const b64 = (v as Record<string, unknown>)[KEY]
      if (keys.length === 1 && typeof b64 === 'string') return fromBase64(b64)
    }
    return v
  })
}
