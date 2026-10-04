/**
 * El Node de la app de Android (nodejs-mobile) viene sin ICU: no hay `Intl` y
 * `String.prototype.normalize` no hace nada (D-101). El motor lo necesita para las fechas
 * por zona horaria, los números, ordenar y buscar sin tildes, así que aquí se completa con
 * implementaciones en JavaScript (FormatJS y unorm, MIT). Con un Node normal no cambia nada:
 * cada polyfill solo se instala si falta lo suyo.
 *
 * Se importa justo después de `./boot` y antes que el resto del motor.
 */
import '@formatjs/intl-getcanonicallocales/polyfill.js'
import '@formatjs/intl-locale/polyfill.js'
import '@formatjs/intl-pluralrules/polyfill.js'
import '@formatjs/intl-pluralrules/locale-data/es.js'
import '@formatjs/intl-pluralrules/locale-data/en.js'
import '@formatjs/intl-numberformat/polyfill.js'
import '@formatjs/intl-numberformat/locale-data/es.js'
import '@formatjs/intl-numberformat/locale-data/en.js'
import '@formatjs/intl-numberformat/locale-data/en-GB.js'
import '@formatjs/intl-datetimeformat/polyfill.js'
import '@formatjs/intl-datetimeformat/locale-data/es.js'
import '@formatjs/intl-datetimeformat/locale-data/en.js'
import '@formatjs/intl-datetimeformat/locale-data/en-GB.js'
import '@formatjs/intl-datetimeformat/locale-data/en-CA.js'
import '@formatjs/intl-datetimeformat/add-all-tz.js'
import unorm from 'unorm'
import { trace } from './trace'

const missing: string[] = []

// Sin ICU, normalize() devuelve el texto tal cual y «José» no se encuentra buscando «jose».
if ('é'.normalize('NFD').length !== 2) {
  missing.push('normalize')
  const forms: Record<string, (s: string) => string> = {
    NFC: unorm.nfc,
    NFD: unorm.nfd,
    NFKC: unorm.nfkc,
    NFKD: unorm.nfkd,
  }
  Object.defineProperty(String.prototype, 'normalize', {
    configurable: true,
    writable: true,
    value: function normalize(this: string, form: string = 'NFC') {
      const f = forms[String(form)]
      if (!f) throw new RangeError(`Invalid normalization form: ${String(form)}`)
      return f(String(this))
    },
  })
}

interface CollatorOptions {
  sensitivity?: 'base' | 'accent' | 'case' | 'variant'
  numeric?: boolean
}

/** Clave de orden de un texto: sin tildes, en minúsculas, la ñ entre la n y la o. */
function primary(s: string): string {
  return s
    .replace(/ñ/g, 'n~')
    .replace(/Ñ/g, 'N~')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

function compareKeys(a: string, b: string, numeric: boolean): number {
  if (!numeric) return a < b ? -1 : a > b ? 1 : 0
  const re = /(\d+)|(\D+)/g
  const pa = a.match(re) ?? []
  const pb = b.match(re) ?? []
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const x = pa[i]!
    const y = pb[i]!
    const nx = /^\d/.test(x)
    const ny = /^\d/.test(y)
    if (nx && ny) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (x !== y) return x < y ? -1 : 1
  }
  return pa.length - pb.length < 0 ? -1 : pa.length > pb.length ? 1 : 0
}

/** Un `Intl.Collator` sencillo, suficiente para ordenar nombres en español e inglés. */
class SimpleCollator {
  private readonly sensitivity: NonNullable<CollatorOptions['sensitivity']>
  private readonly numeric: boolean

  constructor(_locales?: string | string[], options: CollatorOptions = {}) {
    this.sensitivity = options.sensitivity ?? 'variant'
    this.numeric = options.numeric === true
  }

  compare = (a: string, b: string): number => {
    const x = String(a)
    const y = String(b)
    const base = compareKeys(primary(x), primary(y), this.numeric)
    if (base !== 0 || this.sensitivity === 'base') return base
    const lower = (s: string) => s.toLowerCase()
    const noAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (this.sensitivity === 'accent') return compareKeys(lower(x), lower(y), this.numeric)
    if (this.sensitivity === 'case')
      return compareKeys(noAccents(x), noAccents(y), this.numeric) * -1
    return (
      compareKeys(lower(x), lower(y), this.numeric) ||
      compareKeys(noAccents(x), noAccents(y), this.numeric) * -1
    )
  }

  resolvedOptions() {
    return { locale: 'es', sensitivity: this.sensitivity, numeric: this.numeric }
  }

  static supportedLocalesOf(locales?: string | string[]): string[] {
    return locales === undefined ? [] : Array.isArray(locales) ? locales : [locales]
  }
}

if (typeof Intl.Collator !== 'function') {
  missing.push('Intl.Collator')
  Object.defineProperty(Intl, 'Collator', {
    configurable: true,
    writable: true,
    value: SimpleCollator,
  })
  // Sin ICU, localeCompare compara códigos y no hace caso del idioma ni de las opciones.
  Object.defineProperty(String.prototype, 'localeCompare', {
    configurable: true,
    writable: true,
    value: function localeCompare(
      this: string,
      that: string,
      locales?: string | string[],
      options?: CollatorOptions,
    ) {
      return new SimpleCollator(locales, options).compare(String(this), String(that))
    },
  })
}

if (missing.length > 0) trace(`sin ICU: se completa ${missing.join(', ')} con JavaScript`)
