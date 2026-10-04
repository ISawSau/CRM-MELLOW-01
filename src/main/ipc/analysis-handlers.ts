import type { AnalysisService } from '../analysis/analysis-service'
import type { IpcHandlers } from './run'

type AnalysisChannel = Extract<keyof IpcHandlers, `analysis:${string}` | `billing:${string}`>
export type AnalysisHandlers = Pick<IpcHandlers, AnalysisChannel>

/** Dashboards, comparativas y alertas (SPEC §7.13). */
export function createAnalysisHandlers(analysis: AnalysisService): AnalysisHandlers {
  return {
    'analysis:query': (q) => analysis.query(q),
    'analysis:dashboards': () => analysis.dashboards(),
    'analysis:setDashboards': ({ dashboards }) => analysis.setDashboards(dashboards),
    'analysis:alerts': () => analysis.alerts(),
    'analysis:setAlerts': ({ alerts }) => analysis.setAlerts(alerts),
    'analysis:alertValues': () => analysis.currentValues(),
    'analysis:events': () => analysis.events(),
    'analysis:unseen': () => analysis.unseen(),
    'analysis:markSeen': () => analysis.markSeen(),
    'billing:summary': ({ since, until }) => analysis.billing(since, until),
  }
}
