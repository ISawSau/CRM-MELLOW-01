/**
 * Escenas ASCII de la pantalla de contraseña (D-096). Cada escena rellena un búfer de brillo
 * (0 a 1) de `cols × rows` celdas; el componente lo dibuja con caracteres. Son funciones
 * puras del tiempo y de dos contadores: teclas pulsadas (`pulse`) y errores (`shake`).
 */

export interface SceneInput {
  /** Segundos desde el inicio. */
  t: number
  cols: number
  rows: number
  /** Ancho de una celda dividido por su alto (las letras son más altas que anchas). */
  aspect: number
  /** 0 a 1: se dispara al pulsar una tecla y se apaga solo. */
  pulse: number
  /** 0 a 1: se dispara al fallar la contraseña y se apaga solo. */
  shake: number
  /** Teclas pulsadas desde que se abrió la pantalla. */
  keys: number
}

export type Scene = (out: Float32Array, input: SceneInput) => void

const TAU = Math.PI * 2
const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

// --- Gravedad: la animación del portfolio (yellowmellow.cc) --------------------------
//
// Una nube de puntos que pasa de planeta a pozo de gravedad, agujero de gusano y disco de
// acreción, girando en los tres ejes. Cada forma es función de los mismos (u, v), así que
// el punto i de una forma se convierte suavemente en el punto i de la siguiente.

const N = 26_000
const HOLD = 2.4
const MORPH = 3.2

const hr = (y: number) => 0.24 + 0.8 * Math.pow(Math.abs(y) / 1.15, 1.8)
const dhr = (y: number) => ((0.8 * 1.8 * Math.pow(Math.abs(y) / 1.15, 0.8)) / 1.15) * Math.sign(y)
const wy = (r: number) => 0.75 - 1.3 / (r * 3 + 0.55)
const dwy = (r: number) => (1.3 * 3) / Math.pow(r * 3 + 0.55, 2)

type Shape = (u: number, v: number) => [number[], number[], number]

const SHAPES: Shape[] = [
  // Planeta con meridianos y paralelos marcados, para que se note el giro.
  (u, v) => {
    const a = u * TAU
    const th = Math.PI * v
    const s = Math.sin(th)
    const c = Math.cos(th)
    const mu = (u * 12) % 1
    const pv = (v * 7) % 1
    const onLine = Math.min(mu, 1 - mu) < 0.06 || Math.min(pv, 1 - pv) < 0.07
    return [
      [s * Math.cos(a) * 1.05, c * 1.05, s * Math.sin(a) * 1.05],
      [s * Math.cos(a), c, s * Math.sin(a)],
      onLine ? 1.25 : 0.35,
    ]
  },
  (u, v) => {
    const a = u * TAU
    const r = 0.1 + 1.15 * v
    const d = dwy(r)
    return [[r * Math.cos(a), wy(r), r * Math.sin(a)], [-d * Math.cos(a), 1, -d * Math.sin(a)], 1]
  },
  (u, v) => {
    const a = u * TAU
    const y = 1.15 - 2.3 * v
    const r = hr(y)
    return [[r * Math.cos(a), y, r * Math.sin(a)], [Math.cos(a), -dhr(y), Math.sin(a)], 1]
  },
  (u, v) => {
    const a = u * TAU
    const r = 0.42 + 0.88 * v
    return [[r * Math.cos(a), 0.03 * Math.sin(5 * a), r * Math.sin(a)], [0, 1, 0], 1.15 - v * 0.6]
  },
]

interface Cloud {
  P: Float32Array[]
  Nm: Float32Array[]
  D: Float32Array[]
}

let cloud: Cloud | null = null

function buildCloud(): Cloud {
  const phi = (Math.sqrt(5) - 1) / 2
  const P = SHAPES.map(() => new Float32Array(N * 3))
  const Nm = SHAPES.map(() => new Float32Array(N * 3))
  const D = SHAPES.map(() => new Float32Array(N))
  SHAPES.forEach((f, s) => {
    for (let i = 0; i < N; i++) {
      const [p, n, d] = f((i * phi) % 1, (i + 0.5) / N)
      for (let c = 0; c < 3; c++) {
        P[s]![i * 3 + c] = p[c]!
        Nm[s]![i * 3 + c] = n[c]!
      }
      D[s]![i] = d
    }
  })
  return { P, Nm, D }
}

const LIGHT = (() => {
  const v = [-0.45, 0.6, -0.65]
  const l = Math.hypot(...v)
  return v.map((c) => c / l) as [number, number, number]
})()

function rotation(t: number): number[] {
  const ax = t * 0.23
  const ay = t * 0.37
  const az = t * 0.17
  const cx = Math.cos(ax)
  const sx = Math.sin(ax)
  const cy = Math.cos(ay)
  const sy = Math.sin(ay)
  const cz = Math.cos(az)
  const sz = Math.sin(az)
  return [
    cy * cz,
    sx * sy * cz - cx * sz,
    cx * sy * cz + sx * sz,
    cy * sz,
    sx * sy * sz + cx * cz,
    cx * sy * sz - sx * cz,
    -sy,
    sx * cy,
    cx * cy,
  ]
}

let zbuf = new Float32Array(0)

export const gravity: Scene = (out, { t, cols, rows, aspect, pulse, keys }) => {
  cloud ??= buildCloud()
  const { P, Nm, D } = cloud
  if (zbuf.length !== out.length) zbuf = new Float32Array(out.length)
  zbuf.fill(0)
  out.fill(0)
  const cycle = HOLD + MORPH
  const step = Math.max(0, Math.floor(t / cycle))
  const local = t % cycle
  const s0 = step % SHAPES.length
  const s1 = (step + 1) % SHAPES.length
  const k = local < HOLD ? 0 : ease((local - HOLD) / MORPH)
  const pa = P[s0]!
  const pb = P[s1]!
  const na = Nm[s0]!
  const nb = Nm[s1]!
  const da = D[s0]!
  const db = D[s1]!
  // Cada tecla da un pequeño empujón al giro.
  const m = rotation(t + keys * 0.08 + pulse * 0.15)
  const dist = 5
  const size = Math.min(cols * aspect, rows)
  const K = size * 2.05 * (1 + pulse * 0.04)
  const hx = cols / 2
  const hy = rows / 2
  for (let i = 0; i < N; i++) {
    const j = i * 3
    const x = pa[j]! + (pb[j]! - pa[j]!) * k
    const y = pa[j + 1]! + (pb[j + 1]! - pa[j + 1]!) * k
    const z = pa[j + 2]! + (pb[j + 2]! - pa[j + 2]!) * k
    const X = m[0]! * x + m[1]! * y + m[2]! * z
    const Y = m[3]! * x + m[4]! * y + m[5]! * z
    const Z = m[6]! * x + m[7]! * y + m[8]! * z
    const ooz = 1 / (Z + dist)
    const col = (hx + (K * ooz * X) / aspect) | 0
    const row = (hy - K * ooz * Y) | 0
    if (col < 0 || col >= cols || row < 0 || row >= rows) continue
    const idx = row * cols + col
    if (ooz <= zbuf[idx]!) continue
    zbuf[idx] = ooz
    const nx = na[j]! + (nb[j]! - na[j]!) * k
    const ny = na[j + 1]! + (nb[j + 1]! - na[j + 1]!) * k
    const nz = na[j + 2]! + (nb[j + 2]! - na[j + 2]!) * k
    const rx = m[0]! * nx + m[1]! * ny + m[2]! * nz
    const ry = m[3]! * nx + m[4]! * ny + m[5]! * nz
    const rz = m[6]! * nx + m[7]! * ny + m[8]! * nz
    const nl = Math.hypot(rx, ry, rz) || 1
    const lum = Math.abs(rx * LIGHT[0] + ry * LIGHT[1] + rz * LIGHT[2]) / nl
    const dens = da[i]! + (db[i]! - da[i]!) * k
    out[idx] = clamp((0.25 + 0.75 * lum) * dens)
  }
}

// --- El ojo: el iris del logo ---------------------------------------------------------
//
// Anillos concéntricos que giran despacio, con marcas radiales como las del logo. La pupila
// se dilata con cada tecla, el ojo parpadea de vez en cuando y tiembla si fallas.

export const eye: Scene = (out, { t, cols, rows, aspect, pulse, shake, keys }) => {
  const hx = cols / 2 + Math.sin(t * 60) * shake * 2.5
  const hy = rows / 2
  const R = Math.min(cols * aspect, rows) * 0.46
  // Parpadeo: cada ~6 s se cierra 0,25 s.
  const phase = (t % 6.2) / 0.25
  const blink = phase < 1 ? Math.sin(phase * Math.PI) : 0
  const pupil = 0.16 + Math.min(keys, 24) * 0.006 + pulse * 0.05
  const spin = t * 0.12
  for (let row = 0; row < rows; row++) {
    const dy = (row + 0.5 - hy) / R
    for (let col = 0; col < cols; col++) {
      const dx = ((col + 0.5 - hx) * aspect) / R
      const r = Math.hypot(dx, dy)
      let v = 0
      if (r <= 1) {
        const a = Math.atan2(dy, dx) + spin
        // Borde oscuro del iris, anillos naranja y amarillo, aro rojo y pupila.
        const rim = r > 0.93 ? 0.95 : 0
        const outer = Math.abs(r - 0.78) < 0.045 ? 0.8 : 0
        const inner = Math.abs(r - 0.47) < 0.035 ? 0.75 : 0
        const ticks = r > 0.55 && r < 0.88 && (a * 24) % TAU < 0.45 ? 0.5 : 0
        const body = r > 0.5 ? 0.06 + 0.06 * Math.sin(a * 6 + r * 9) : 0.14
        v = r < pupil ? 1 : Math.max(rim, outer, inner, ticks, body)
        // Brillo: el reflejo de luz abajo, como en el logo.
        if (dy > 0.45 && dy < 0.78 && Math.abs(dx) < 0.32) v = Math.max(v, 0.92)
        // Párpado: sombra arriba y el parpadeo.
        if (dy < -0.62 + blink * 1.7) v *= 0.15
      }
      out[row * cols + col] = clamp(v)
    }
  }
}

// --- Cerradura de la bóveda ------------------------------------------------------------
//
// La rueda de una caja fuerte: marcas cada 10° y cada 30° más largas, y un pomo de tres
// brazos. Gira un poco con cada tecla y se sacude si fallas.

export const lock: Scene = (out, { t, cols, rows, aspect, pulse, shake, keys }) => {
  const hx = cols / 2 + Math.sin(t * 50) * shake * 2
  const hy = rows / 2
  const R = Math.min(cols * aspect, rows) * 0.46
  const dial = keys * 0.33 + ease(clamp(pulse)) * 0.1 + Math.sin(t * 0.4) * 0.05
  for (let row = 0; row < rows; row++) {
    const dy = (row + 0.5 - hy) / R
    for (let col = 0; col < cols; col++) {
      const dx = ((col + 0.5 - hx) * aspect) / R
      const r = Math.hypot(dx, dy)
      let v = 0
      if (r <= 1) {
        const a = (((Math.atan2(dy, dx) - dial) % TAU) + TAU) % TAU
        const tick = (a / TAU) * 36
        const near = Math.abs(tick - Math.round(tick))
        const major = Math.round(tick) % 3 === 0
        if (r > 0.95) v = 0.9
        else if (r > (major ? 0.72 : 0.8) && r < 0.9 && near < 0.12) v = major ? 1 : 0.7
        else if (Math.abs(r - 0.66) < 0.03) v = 0.6
        else if (r < 0.2) v = 0.85 - r
        else if (r < 0.58) {
          // Tres brazos del pomo.
          const arm = Math.abs(Math.sin(((a * 3) % TAU) / 2))
          v = arm < 0.14 ? 0.8 : 0.03
        } else v = 0.04
        // Marca fija arriba: la referencia de la combinación.
        if (dy < -0.95 && Math.abs(dx) < 0.05) v = 1
      } else if (r < 1.06 && dy > 0.2) v = 0.35
      out[row * cols + col] = clamp(v)
    }
  }
}

export const SCENES = { gravedad: gravity, ojo: eye, cerradura: lock } as const
