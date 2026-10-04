import type { ReportService } from '../reports/report-service'
import type { ToolsService } from '../tools/tools-service'
import type { IpcHandlers } from './run'

type ToolsChannel = Extract<keyof IpcHandlers, `tools:${string}` | `reports:${string}`>
export type ToolsHandlers = Pick<IpcHandlers, ToolsChannel>

/** Herramientas de archivos (SPEC §7.11) e informes en PDF (SPEC §7.10). */
export function createToolsHandlers(tools: ToolsService, reports: ReportService): ToolsHandlers {
  return {
    'reports:templates': () => reports.templates(),
    'reports:setTemplates': ({ templates }) => reports.setTemplates(templates),
    'reports:generate': (input) => reports.generate(input),
    'tools:status': () => tools.status(),
    'tools:save': (input) => tools.saveResult(input),
    'tools:convertVideo': (job) => tools.convertVideo(job),
    'tools:cancel': ({ token }) => tools.cancel(token),
    'tools:decodeHeic': ({ data }) => tools.decodeHeic(data),
  }
}
