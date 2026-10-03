import { z } from 'zod'
import { EN } from './en'

/**
 * Idiomas de la interfaz (arreglos tras la 0.13, D-090). El español es el idioma de origen:
 * cada texto se escribe en español dentro de `t()` y ese mismo texto es la clave del
 * diccionario inglés. Lo que no está en el diccionario se ve en español, así que los textos
 * que escribe el usuario (sus campos, vistas, etiquetas…) nunca se tocan, y los que crea la
 * app de serie (campos «Título», etapas «Prospecto»…) se traducen al mostrarlos.
 */
export const LOCALES = ['es', 'en'] as const
export type Locale = (typeof LOCALES)[number]
export const localeSchema = z.enum(LOCALES)
export const LOCALE_NAMES: Record<Locale, string> = { es: 'Español', en: 'English' }

let current: Locale = 'es'
const listeners = new Set<(l: Locale) => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(l: Locale): void {
  if (l === current) return
  current = l
  for (const fn of listeners) fn(l)
}

/** Avisa cuando cambia el idioma (los formatos de números y fechas se rehacen). */
export function onLocaleChange(fn: (l: Locale) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Etiqueta BCP 47 para Intl: español de España o inglés británico (dd/mm/aaaa, 1,234.56). */
export function intlLocale(l: Locale = current): string {
  return l === 'en' ? 'en-GB' : 'es-ES'
}

/**
 * Traduce un texto escrito en español. Las variables van entre llaves:
 * `t('Quedan {n} días', { n: 3 })`.
 */
export function t(es: string, vars?: Record<string, string | number>): string {
  const s = current === 'en' ? (EN[es] ?? es) : es
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/**
 * Traducción con contexto, para palabras con dos sentidos («Beneficio»: ángulo creativo o
 * margen en Facturación). Busca primero «contexto|texto» y si no, el texto solo.
 */
export function tc(ctx: string, es: string, vars?: Record<string, string | number>): string {
  const key = `${ctx}|${es}`
  return current === 'en' && key in EN ? t(key, vars) : t(es, vars)
}

/** Plural sencillo: `tn(n, '{n} cuenta', '{n} cuentas')`. */
export function tn(
  n: number,
  one: string,
  many: string,
  vars: Record<string, string | number> = {},
) {
  return t(n === 1 ? one : many, { n, ...vars })
}

/** ¿Hay traducción para este texto? (pruebas de cobertura). */
export function hasTranslation(es: string): boolean {
  return es in EN
}
