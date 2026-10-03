import { analysis } from './analysis'
import { common } from './common'
import { data } from './data'
import { main } from './main'
import { meta } from './meta'
import { platforms } from './platforms'
import { reports } from './reports'
import { screens } from './screens'
import { shared } from './shared'
import { shell } from './shell'
import { theme } from './theme'
import { tools } from './tools'

/** Diccionario inglés completo (español → inglés). */
export const EN: Record<string, string> = {
  ...common,
  ...shared,
  ...main,
  ...screens,
  ...shell,
  ...data,
  ...meta,
  ...analysis,
  ...tools,
  ...platforms,
  ...reports,
  ...theme,
}
