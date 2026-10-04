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

/**
 * Rellena `out` con el brillo de cada celda. Si una celda necesita un carácter concreto
 * (los números de la cerradura), lo pone en `glyphs` como código de carácter.
 */
export type Scene = (out: Float32Array, input: SceneInput, glyphs: Uint16Array) => void

const TAU = Math.PI * 2
const clamp = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)

// --- Gravedad: la animación del portfolio (yellowmellow.cc) --------------------------
//
// Una nube de puntos que pasa de planeta a pozo de gravedad, agujero de gusano y disco de
// acreción, girando en los tres ejes. Cada forma es función de los mismos (u, v), así que
// el punto i de una forma se convierte suavemente en el punto i de la siguiente.

const N = 70_000
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
// Solo el iris, como en el logo (sin párpado ni blanco del ojo): borde oscuro, banda
// naranja, cuerpo amarillo con fibras radiales y criptas, collarete en zigzag, aro rojo,
// pupila y el reflejo de luz abajo. Las fibras giran despacio; la pupila se dilata al
// teclear y se cierra de golpe si fallas.

/** Ruido determinista 0–1 a partir de dos enteros. */
const hash = (a: number, b: number) => {
  const h = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return h - Math.floor(h)
}

/** Fibras del iris: hebras radiales irregulares que dependen del ángulo. */
const fibre = (a: number, r: number) => {
  const f1 = Math.sin(a * 64 + Math.sin(r * 9) * 1.4)
  const f2 = Math.sin(a * 23 + r * 5.5 + 1.3)
  const f3 = Math.sin(a * 131 + r * 2)
  return 0.5 + 0.28 * f1 + 0.14 * f2 + 0.08 * f3
}

export const eye: Scene = (out, { t, cols, rows, aspect, pulse, shake, keys }) => {
  const hx = cols / 2 + Math.sin(t * 60) * shake * 2
  const hy = rows / 2
  const R = Math.min(cols * aspect, rows) * 0.47
  // La pupila respira, se dilata con cada tecla y se contrae al fallar.
  const pupil =
    0.15 + 0.012 * Math.sin(t * 1.3) + Math.min(keys, 30) * 0.005 + pulse * 0.04 - shake * 0.07
  const spin = t * 0.06
  for (let row = 0; row < rows; row++) {
    const dy = (row + 0.5 - hy) / R
    for (let col = 0; col < cols; col++) {
      const dx = ((col + 0.5 - hx) * aspect) / R
      const r = Math.hypot(dx, dy)
      let v = 0
      if (r <= 1) {
        const a0 = Math.atan2(dy, dx)
        const a = a0 + spin
        const f = fibre(a, r)
        // Collarete: frontera en zigzag entre la zona de la pupila y la del iris.
        const coll = 0.5 + 0.035 * Math.sin(a * 22) + 0.015 * Math.sin(a * 7)
        if (r < pupil) {
          // Pupila: densa, con un poco de textura en el borde.
          v = r > pupil - 0.025 ? 0.8 : 0.97
        } else if (r < 0.43) {
          // Zona de la pupila: amarillo claro con fibras finas.
          v = 0.3 + 0.25 * f
        } else if (Math.abs(r - 0.455) < 0.03) {
          // Aro rojo alrededor de la pupila (el anillo interior del logo).
          v = 0.92
        } else if (Math.abs(r - coll) < 0.018) {
          v = 0.78
        } else if (r < 0.74) {
          // Cuerpo del iris: fibras radiales y alguna cripta (huecos oscuros).
          const crypt = hash(Math.floor(a * 9), Math.floor(r * 14)) > 0.86 ? 0.55 : 1
          v = (0.18 + 0.42 * f * f) * crypt
          // Marcas cortas del logo, girando con el iris.
          if (r > 0.6 && r < 0.68 && (((a * 16) % TAU) + TAU) % TAU < 0.28) v = 0.85
        } else if (Math.abs(r - 0.78) < 0.035) {
          // Banda naranja.
          v = 0.86 + 0.1 * f
        } else if (r < 0.92) {
          v = 0.22 + 0.3 * f
        } else {
          // Borde oscuro del iris (limbo), con su textura.
          v = 0.5 + 0.2 * Math.sin(a0 * 90)
        }
        // Reflejo de luz abajo (fijo, no gira), como en el logo.
        const hxr = dx / 0.34
        const hyr = (dy - 0.62) / 0.16
        if (hxr * hxr + hyr * hyr < 1) v = Math.max(v, 0.96 - 0.25 * Math.abs(hyr))
        // Brillo pequeño arriba a la izquierda.
        if (Math.hypot(dx + 0.3, dy + 0.3) < 0.07) v = 1
      } else if (r < 1.04) {
        // Halo tenue fuera del iris.
        v = 0.12
      }
      out[row * cols + col] = clamp(v)
    }
  }
}

// --- Cerradura de la bóveda ------------------------------------------------------------
//
// La rueda de una caja fuerte: borde moleteado, 100 marcas (cada 5 más largas y cada 10
// con su número), un aro de agarre y el pomo con tres brazos y tornillos. Gira con cada
// tecla y se sacude si fallas. La flecha de arriba es la referencia de la combinación.

const DIGITS = '0123456789'.split('').map((c) => c.charCodeAt(0))

export const lock: Scene = (out, { t, cols, rows, aspect, pulse, shake, keys }, glyphs) => {
  const hx = cols / 2 + Math.sin(t * 50) * shake * 2
  const hy = rows / 2
  const R = Math.min(cols * aspect, rows) * 0.46
  const dial = keys * 0.33 + ease(clamp(pulse)) * 0.12 + Math.sin(t * 0.4) * 0.04
  for (let row = 0; row < rows; row++) {
    const dy = (row + 0.5 - hy) / R
    for (let col = 0; col < cols; col++) {
      const dx = ((col + 0.5 - hx) * aspect) / R
      const r = Math.hypot(dx, dy)
      let v = 0
      if (r <= 1) {
        const a0 = Math.atan2(dy, dx)
        const a = (((a0 - dial) % TAU) + TAU) % TAU
        const unit = (a / TAU) * 100
        const near = Math.abs(unit - Math.round(unit))
        const n = Math.round(unit) % 100
        if (r > 0.95) {
          // Borde moleteado.
          v = Math.sin(a * 120) > 0 ? 0.95 : 0.55
        } else if (r > 0.9) {
          v = 0.08
        } else if (r > 0.78 && near < 0.18) {
          const len = n % 10 === 0 ? 0.78 : n % 5 === 0 ? 0.82 : 0.86
          v = r > len ? (n % 10 === 0 ? 1 : n % 5 === 0 ? 0.8 : 0.55) : 0.05
        } else if (Math.abs(r - 0.69) < 0.045) {
          v = 0.06
        } else if (Math.abs(r - 0.6) < 0.02) {
          v = 0.7
        } else if (r > 0.5 && r < 0.6) {
          // Aro de agarre con estrías.
          v = Math.sin(a * 48) > 0.2 ? 0.6 : 0.2
        } else if (r < 0.12) {
          v = 0.95 - r * 2
        } else if (r < 0.5) {
          // Pomo: tres brazos y un tornillo en cada uno.
          const arm = Math.abs(Math.sin(((a * 3) % TAU) / 2))
          const armA = Math.round((a * 3) / TAU) * (TAU / 3)
          const bolt = Math.hypot(
            dx - Math.cos(armA + dial) * 0.36,
            dy - Math.sin(armA + dial) * 0.36,
          )
          if (bolt < 0.05) v = 1
          else v = arm < 0.15 ? 0.78 - r * 0.3 : 0.05 + 0.04 * Math.sin(a0 * 30 + r * 40)
        } else v = 0.04
        // Flecha fija arriba: la referencia de la combinación.
        if (dy < -0.9 && dy > -1 && Math.abs(dx) < (dy + 1) * 0.6) v = 1
      } else if (r < 1.07 && dy > 0.25) v = 0.3
      out[row * cols + col] = clamp(v)
    }
  }
  // Números cada 10 marcas, girando con la rueda.
  for (let k = 0; k < 10; k++) {
    const ang = (k / 10) * TAU + dial
    const rr = 0.72 * R
    const cx = hx + (Math.cos(ang) * rr) / aspect
    const cy = hy + Math.sin(ang) * rr
    const label = String(k * 10)
    const start = Math.round(cx - label.length / 2)
    const rowI = Math.round(cy - 0.5)
    if (rowI < 0 || rowI >= rows) continue
    for (let j = 0; j < label.length; j++) {
      const colI = start + j
      if (colI < 0 || colI >= cols) continue
      const i = rowI * cols + colI
      out[i] = 1
      glyphs[i] = DIGITS[Number(label[j])]!
    }
  }
}

export const SCENES = { gravedad: gravity, ojo: eye, cerradura: lock } as const
