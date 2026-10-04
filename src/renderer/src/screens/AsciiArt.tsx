import { useEffect, useRef } from 'react'
import type { LockScene } from '@shared/lock-animation'
import { SCENES } from './ascii-scenes'

/** Del más oscuro al más brillante; el espacio no se dibuja. */
const RAMP = " .'`,:;-~=+*xoXO#%@"
/** Celdas pequeñas: más resolución y más detalle (D-096). */
const FONT_PX = 9
const LINE_PX = 10
const FPS = 30
/** Tres intensidades del color: lo tenue se ve más lejos y da profundidad. */
const LAYERS = [
  { max: 0.34, alpha: 0.5 },
  { max: 0.67, alpha: 0.8 },
  { max: 1.01, alpha: 1 },
] as const

/**
 * Animación ASCII de la pantalla de contraseña (D-096), en un canvas. Reacciona a las
 * teclas (`keys`) y a los errores (`errors`). Se para con la ventana oculta y, si el sistema
 * pide menos movimiento, se queda quieta en un fotograma.
 */
export function AsciiArt({
  kind,
  keys,
  errors,
}: {
  kind: LockScene
  keys: number
  errors: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const state = useRef({ keys, pulseAt: -1e9, shakeAt: -1e9 })

  useEffect(() => {
    state.current.keys = keys
    if (keys > 0) state.current.pulseAt = performance.now()
  }, [keys])

  useEffect(() => {
    if (errors > 0) state.current.shakeAt = performance.now()
  }, [errors])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const scene = SCENES[kind]
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const css = getComputedStyle(document.documentElement)
    const color = css.getPropertyValue('--accent').trim() || '#e0a47c'
    const font = `${FONT_PX}px ${css.getPropertyValue('--font-mono').trim() || 'monospace'}`
    let cols = 0
    let rows = 0
    let cell = 7
    let buf = new Float32Array(0)
    let glyphs = new Uint16Array(0)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.font = font
      cell = ctx.measureText('M').width || 7
      cols = Math.max(10, Math.floor(w / cell))
      rows = Math.max(6, Math.floor(h / LINE_PX))
      buf = new Float32Array(cols * rows)
      glyphs = new Uint16Array(cols * rows)
    }

    const start = performance.now()
    const draw = (now: number) => {
      const s = state.current
      glyphs.fill(0)
      scene(
        buf,
        {
          // El primer fotograma puede traer una marca anterior al inicio: nunca tiempo negativo.
          t: Math.max(0, now - start) / 1000,
          cols,
          rows,
          aspect: cell / LINE_PX,
          pulse: Math.max(0, 1 - (now - s.pulseAt) / 450),
          shake: Math.max(0, 1 - (now - s.shakeAt) / 600),
          keys: s.keys,
        },
        glyphs,
      )
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
      ctx.font = font
      ctx.textBaseline = 'top'
      ctx.fillStyle = color
      // Una línea por fila y capa de intensidad: pocas llamadas a fillText aunque haya detalle.
      let lo = 0
      for (const layer of LAYERS) {
        ctx.globalAlpha = layer.alpha
        for (let r = 0; r < rows; r++) {
          let line = ''
          let any = false
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c
            const v = buf[i]!
            if (v < lo || v >= layer.max || v <= 0) {
              line += ' '
              continue
            }
            const g = glyphs[i]!
            line += g
              ? String.fromCharCode(g)
              : RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))]
            any = true
          }
          if (any) ctx.fillText(line, 0, r * LINE_PX)
        }
        lo = layer.max
      }
      ctx.globalAlpha = 1
    }

    resize()
    const ro = new ResizeObserver(() => {
      resize()
      if (still) draw(start + 1200)
    })
    ro.observe(canvas)
    if (still) {
      draw(start + 1200)
      return () => ro.disconnect()
    }
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (document.hidden || now - last < 1000 / FPS) return
      last = now
      draw(now)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [kind])

  return (
    <canvas
      ref={canvasRef}
      className="ascii-art"
      aria-hidden="true"
      data-testid="ascii-art"
      data-kind={kind}
    />
  )
}
