import { useEffect, useRef } from 'react'
import type { LockScene } from '@shared/lock-animation'
import { SCENES } from './ascii-scenes'

/** Del más oscuro al más brillante; el espacio no se dibuja. */
const RAMP = ' .:-=+*#%@'
const FONT_PX = 12
const LINE_PX = 14
const FPS = 30

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
    }

    const start = performance.now()
    const draw = (now: number) => {
      const s = state.current
      scene(buf, {
        t: (now - start) / 1000,
        cols,
        rows,
        aspect: cell / LINE_PX,
        pulse: Math.max(0, 1 - (now - s.pulseAt) / 450),
        shake: Math.max(0, 1 - (now - s.shakeAt) / 600),
        keys: s.keys,
      })
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight)
      ctx.font = font
      ctx.textBaseline = 'top'
      ctx.fillStyle = color
      for (let r = 0; r < rows; r++) {
        let line = ''
        for (let c = 0; c < cols; c++) {
          const v = buf[r * cols + c]!
          line += RAMP[Math.min(RAMP.length - 1, Math.floor(v * RAMP.length))]
        }
        if (line.trim()) ctx.fillText(line, 0, r * LINE_PX)
      }
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
