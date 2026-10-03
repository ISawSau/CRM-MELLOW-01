import * as echarts from 'echarts'

/**
 * Gráficas de los informes: ECharts en el proceso principal, renderizado a SVG en el
 * servidor (sin canvas ni scripts en el PDF). Paleta categórica validada del tema claro
 * (D-066), en orden fijo; el periodo anterior va en gris discontinuo.
 */

export const REPORT_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300']
const INK = '#2b211d'
const MUTED = '#6f625b'
const GRID = '#e6dfda'
const PREVIOUS = '#9a9089'

const base = (font: string) => ({
  animation: false,
  backgroundColor: 'transparent',
  textStyle: { fontFamily: font, color: INK, fontSize: 11 },
})

function render(option: echarts.EChartsCoreOption, width: number, height: number): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  try {
    chart.setOption(option)
    return chart.renderToSVGString()
  } finally {
    chart.dispose()
  }
}

/** Evolución diaria de una métrica, con el periodo anterior opcional. */
export function lineChartSvg(opts: {
  labels: string[]
  values: (number | null)[]
  previous: (number | null)[] | null
  name: string
  previousName: string
  format: (v: number) => string
  font: string
  width?: number
  height?: number
}): string {
  const series: object[] = [
    {
      type: 'line',
      name: opts.name,
      data: opts.values,
      color: REPORT_PALETTE[0],
      lineStyle: { width: 2 },
      symbol: 'none',
      endLabel: { show: true, formatter: (p: { value: number }) => opts.format(p.value) },
    },
  ]
  if (opts.previous)
    series.push({
      type: 'line',
      name: opts.previousName,
      data: opts.previous,
      color: PREVIOUS,
      lineStyle: { width: 2, type: 'dashed' },
      symbol: 'none',
    })
  return render(
    {
      ...base(opts.font),
      legend: opts.previous
        ? {
            top: 0,
            left: 0,
            itemGap: 28,
            textStyle: { color: MUTED },
            itemWidth: 16,
            itemHeight: 2,
          }
        : undefined,
      grid: { left: 8, right: 64, top: opts.previous ? 28 : 12, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: opts.labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: GRID } },
        axisTick: { show: false },
        axisLabel: { color: MUTED, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: GRID } },
        axisLabel: { color: MUTED, formatter: (v: number) => opts.format(v) },
      },
      series,
    },
    opts.width ?? 680,
    opts.height ?? 240,
  )
}

/** Barras horizontales (de mayor a menor) con el valor al final de cada barra. */
export function barChartSvg(opts: {
  labels: string[]
  values: number[]
  format: (v: number) => string
  font: string
  width?: number
}): string {
  const height = Math.max(80, 28 * opts.labels.length + 24)
  const short = (s: string) => (s.length > 34 ? `${s.slice(0, 33)}…` : s)
  return render(
    {
      ...base(opts.font),
      grid: { left: 8, right: 72, top: 4, bottom: 4, containLabel: true },
      xAxis: { type: 'value', show: false },
      yAxis: {
        type: 'category',
        inverse: true,
        data: opts.labels.map(short),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: INK },
      },
      series: [
        {
          type: 'bar',
          data: opts.values,
          color: REPORT_PALETTE[0],
          barMaxWidth: 16,
          itemStyle: { borderRadius: [0, 4, 4, 0] },
          label: {
            show: true,
            position: 'right',
            color: INK,
            formatter: (p: { value: number }) => opts.format(p.value),
          },
        },
      ],
    },
    opts.width ?? 680,
    height,
  )
}
