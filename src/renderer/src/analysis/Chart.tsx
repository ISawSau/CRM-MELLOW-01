import { BarChart, LineChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef, useSyncExternalStore } from 'react'

echarts.use([
  LineChart,
  BarChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  AriaComponent,
  CanvasRenderer,
])

/**
 * Gráficas con Apache ECharts en canvas (SPEC §2). Todo se pinta en el canvas, también
 * el tooltip (`renderMode: 'richText'`): la CSP no permite estilos en línea.
 *
 * Paleta categórica en orden fijo, validada contra el fondo de cada tema con el
 * validador de la guía de visualización (D-066): una para temas claros y otra para
 * oscuros, con los mismos ocho tonos.
 */
const SERIES_LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
]
const SERIES_DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
]

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** Luminancia relativa de un color #rrggbb (para saber si el tema es oscuro). */
function isDark(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return true
  const n = parseInt(m[1]!, 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]! < 0.4
}

/** Cambia cuando cambia el tema (atributos o variables de la raíz). */
let themeVersion = 0
function subscribeTheme(cb: () => void): () => void {
  const mo = new MutationObserver(() => {
    themeVersion++
    cb()
  })
  mo.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'data-theme'],
  })
  return () => mo.disconnect()
}
const useThemeVersion = () => useSyncExternalStore(subscribeTheme, () => themeVersion)

export function seriesColors(): string[] {
  return isDark(cssVar('--bg-raised')) ? SERIES_DARK : SERIES_LIGHT
}

export interface ChartSeries {
  name: string
  values: (number | null)[]
  /** Serie secundaria (periodo anterior): discontinua. */
  dashed?: boolean
  /** Posición fija en la paleta (el color sigue a la entidad, no al orden). */
  slot: number
}

export interface ChartProps {
  kind: 'line' | 'bar'
  labels: string[]
  series: ChartSeries[]
  format: (v: number) => string
  /** Texto para lectores de pantalla. */
  title: string
  height?: number
}

export function Chart({ kind, labels, series, format, title, height = 260 }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const theme = useThemeVersion()

  useEffect(() => {
    if (!ref.current) return
    const c = echarts.init(ref.current, undefined, { renderer: 'canvas' })
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    return () => {
      ro.disconnect()
      c.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    const c = chart.current
    if (!c) return
    const colors = seriesColors()
    const text = cssVar('--text-muted') || '#999'
    const faint = cssVar('--text-faint') || '#777'
    const line = cssVar('--line') || '#333'
    const surface = cssVar('--bg-raised') || '#111'
    const textMain = cssVar('--text') || '#eee'
    const font = getComputedStyle(document.body).fontFamily
    const horizontal = kind === 'bar'
    const valueAxis = {
      type: 'value' as const,
      axisLabel: { color: faint, formatter: (v: number) => format(v), fontFamily: font },
      splitLine: { lineStyle: { color: line, width: 1 } },
      axisLine: { show: false },
      axisTick: { show: false },
    }
    const categoryAxis = {
      type: 'category' as const,
      data: labels,
      axisLabel: { color: text, fontFamily: font, hideOverlap: true },
      axisLine: { lineStyle: { color: line } },
      axisTick: { show: false },
      inverse: horizontal,
    }
    c.setOption(
      {
        aria: { enabled: true, label: { description: title } },
        animation: false,
        grid: {
          left: 8,
          right: horizontal ? 72 : 16,
          top: series.length > 1 ? 32 : 12,
          bottom: 8,
          containLabel: true,
        },
        legend: {
          show: series.length > 1,
          top: 0,
          left: 0,
          icon: 'roundRect',
          itemWidth: 14,
          itemHeight: 3,
          textStyle: { color: text, fontFamily: font },
        },
        tooltip: {
          trigger: horizontal ? 'item' : 'axis',
          renderMode: 'richText',
          backgroundColor: surface,
          borderColor: line,
          textStyle: { color: textMain, fontFamily: font },
          axisPointer: { type: 'line', lineStyle: { color: faint, width: 1 } },
          valueFormatter: (v: unknown) => (typeof v === 'number' ? format(v) : '—'),
        },
        xAxis: horizontal ? valueAxis : categoryAxis,
        yAxis: horizontal ? categoryAxis : valueAxis,
        series: series.map((s) => {
          const color = colors[s.slot % colors.length]!
          return kind === 'line'
            ? {
                type: 'line' as const,
                name: s.name,
                data: s.values,
                color,
                showSymbol: false,
                symbolSize: 8,
                connectNulls: false,
                lineStyle: { width: 2, type: s.dashed ? ('dashed' as const) : ('solid' as const) },
                emphasis: { focus: 'series' as const },
              }
            : {
                type: 'bar' as const,
                name: s.name,
                data: s.values,
                color,
                barMaxWidth: 22,
                barGap: '10%',
                itemStyle: { borderRadius: [0, 4, 4, 0] },
                // Etiquetas directas: el valor al final de cada barra.
                label: {
                  show: series.length === 1,
                  position: 'right' as const,
                  color: text,
                  fontFamily: font,
                  formatter: (p: { value: unknown }) =>
                    typeof p.value === 'number' ? format(p.value) : '',
                },
              }
        }),
      },
      true,
    )
  }, [kind, labels, series, format, title, theme])

  return (
    <div
      ref={ref}
      className="chart"
      role="img"
      aria-label={title}
      style={{ height }}
      data-testid="chart"
    />
  )
}
