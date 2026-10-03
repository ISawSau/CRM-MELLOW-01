import { useEffect, useState } from 'react'
import type { Density } from '@shared/appearance'
import { OPTION_COLORS, type OptionColor } from '@shared/data/fields'
import { formatNumber } from '@shared/format'
import {
  BUILT_IN_THEMES,
  contrastIssues,
  findTheme,
  parseColor,
  themeSchema,
  toHex,
  type Theme,
  type ThemeColors,
} from '@shared/themes'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { applyAppearance } from './apply'

type ColorKey = keyof ThemeColors

/** Tokens agrupados como en docs/DESIGN.md, con nombres en español. */
const GROUPS: { title: string; keys: [ColorKey, string][] }[] = [
  {
    title: 'Superficies',
    keys: [
      ['bg', 'Fondo'],
      ['bgRaised', 'Paneles y barra lateral'],
      ['bgHover', 'Fila o botón al pasar el ratón'],
    ],
  },
  {
    title: 'Texto',
    keys: [
      ['text', 'Texto principal'],
      ['textMuted', 'Texto secundario'],
      ['textFaint', 'Texto tenue'],
    ],
  },
  {
    title: 'Acento',
    keys: [
      ['accent', 'Botón principal'],
      ['onAccent', 'Texto del botón principal'],
      ['accentText', 'Texto y enlaces de acento'],
      ['index', 'Numeración de secciones'],
      ['marker', 'Marcas y selección'],
      ['focus', 'Borde de foco'],
    ],
  },
  {
    title: 'Estados',
    keys: [
      ['success', 'Correcto'],
      ['danger', 'Error'],
      ['warning', 'Aviso'],
    ],
  },
  {
    title: 'Líneas y sombras',
    keys: [
      ['line', 'Separadores'],
      ['lineStrong', 'Bordes de controles'],
      ['shadow', 'Sombra de ventanas'],
    ],
  },
]

const OPTION_LABELS: Record<OptionColor, string> = {
  gris: 'Gris',
  melocoton: 'Melocotón',
  terracota: 'Terracota',
  vino: 'Vino',
  ambar: 'Ámbar',
  verde: 'Verde',
  azul: 'Azul',
  lila: 'Lila',
}

const HEX = /^#[0-9a-f]{6}$/i

/** Un color: selector, código hexadecimal y, si el token lo lleva, opacidad. */
function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const c = parseColor(value)
  const hex = toHex(c.r, c.g, c.b)
  const alpha = value.startsWith('rgba')
  // Lo que se está escribiendo en el código (mientras no sea un color completo).
  const [text, setText] = useState<string | null>(null)
  const withHex = (h: string) => {
    if (!alpha) return h.toLowerCase()
    const n = parseColor(h)
    return `rgba(${n.r}, ${n.g}, ${n.b}, ${c.a})`
  }
  return (
    <div className="theme-color">
      <input
        type="color"
        aria-label={label}
        value={hex}
        onChange={(e) => onChange(withHex(e.target.value))}
      />
      <span className="theme-color-label">{label}</span>
      <input
        className="input mono theme-hex"
        aria-label={`${label} (código)`}
        value={text ?? hex}
        maxLength={7}
        onBlur={() => setText(null)}
        onChange={(e) => {
          setText(e.target.value)
          if (HEX.test(e.target.value)) onChange(withHex(e.target.value))
        }}
      />
      {alpha && (
        <label className="theme-alpha">
          <input
            type="number"
            className="input num"
            aria-label={`Opacidad de ${label.toLowerCase()}`}
            min={0}
            max={100}
            value={Math.round(c.a * 100)}
            onChange={(e) => {
              const a = Math.min(100, Math.max(0, Number(e.target.value) || 0)) / 100
              onChange(`rgba(${c.r}, ${c.g}, ${c.b}, ${Number(a.toFixed(2))})`)
            }}
          />
          %
        </label>
      )}
    </div>
  )
}

/**
 * Editor de un tema propio (SPEC §8, fase 12). Los cambios se ven al momento en toda la
 * app; «Cancelar» vuelve al tema guardado.
 */
export function ThemeEditor({
  initial,
  isNew,
  themes,
  current,
  density,
  onClose,
}: {
  initial: Theme
  isNew: boolean
  /** Temas propios guardados. */
  themes: Theme[]
  /** Tema en uso (guardado). */
  current: string
  density: Density
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Theme>(initial)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // Vista previa en directo; al salir se vuelve a aplicar el tema guardado.
  useEffect(() => {
    if (themeSchema.safeParse(draft).success) applyAppearance(draft, density)
  }, [draft, density])
  useEffect(
    () => () => applyAppearance(findTheme(current, [...BUILT_IN_THEMES, ...themes]), density),
    // Solo al cerrar el editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const issues = contrastIssues(draft)
  const setColor = (k: ColorKey, v: string) =>
    setDraft((d) => ({ ...d, colors: { ...d.colors, [k]: v } }))
  const setOption = (o: OptionColor, part: 'bg' | 'text', v: string) =>
    setDraft((d) => ({ ...d, options: { ...d.options, [o]: { ...d.options[o], [part]: v } } }))

  const save = async () => {
    setError(null)
    const t = { ...draft, name: draft.name.trim() }
    if (!t.name) return setError('Ponle un nombre al tema.')
    const list = isNew ? [...themes, t] : themes.map((x) => (x.id === t.id ? t : x))
    try {
      await call('settings:setThemes', { themes: list })
      await call('settings:setAppearance', { theme: t.id, density })
      onClose()
    } catch (e) {
      setError(e instanceof IpcCallError ? e.message : 'No se ha podido guardar el tema.')
    }
  }

  const remove = async () => {
    try {
      await call('settings:setThemes', { themes: themes.filter((x) => x.id !== draft.id) })
      onClose()
    } catch (e) {
      setError(e instanceof IpcCallError ? e.message : 'No se ha podido borrar el tema.')
    }
  }

  return (
    <div className="theme-editor" data-testid="theme-editor">
      <div className="theme-editor-head">
        <div className="field">
          <label htmlFor="theme-name">Nombre del tema</label>
          <input
            id="theme-name"
            className="input"
            maxLength={60}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="theme-scheme">Tipo</label>
          <select
            id="theme-scheme"
            className="input"
            value={draft.scheme}
            onChange={(e) => setDraft({ ...draft, scheme: e.target.value as Theme['scheme'] })}
          >
            <option value="dark">Oscuro</option>
            <option value="light">Claro</option>
          </select>
          <span className="hint">
            Ajusta los controles del sistema (barras de desplazamiento…).
          </span>
        </div>
        <div className="field">
          <label htmlFor="theme-base">Partir de</label>
          <select
            id="theme-base"
            className="input"
            value=""
            onChange={(e) => {
              const b = findTheme(e.target.value, [...BUILT_IN_THEMES, ...themes])
              setDraft({ ...draft, scheme: b.scheme, colors: b.colors, options: b.options })
            }}
          >
            <option value="">Elegir un tema…</option>
            {[...BUILT_IN_THEMES, ...themes]
              .filter((t) => t.id !== draft.id)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="theme-groups">
        {GROUPS.map((g) => (
          <fieldset key={g.title} className="theme-group">
            <legend>{g.title}</legend>
            {g.keys.map(([k, label]) => (
              <ColorRow
                key={k}
                label={label}
                value={draft.colors[k]}
                onChange={(v) => setColor(k, v)}
              />
            ))}
          </fieldset>
        ))}
        <fieldset className="theme-group theme-group-wide">
          <legend>Etiquetas (fondo y texto)</legend>
          <div className="theme-options">
            {OPTION_COLORS.map((o) => (
              <div key={o} className="theme-option">
                <span className="chip" data-color={o}>
                  {OPTION_LABELS[o]}
                </span>
                <ColorRow
                  label={`Fondo ${OPTION_LABELS[o].toLowerCase()}`}
                  value={draft.options[o].bg}
                  onChange={(v) => setOption(o, 'bg', v)}
                />
                <ColorRow
                  label={`Texto ${OPTION_LABELS[o].toLowerCase()}`}
                  value={draft.options[o].text}
                  onChange={(v) => setOption(o, 'text', v)}
                />
              </div>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="theme-contrast" data-testid="theme-contrast">
        {issues.length === 0 ? (
          <p className="report-saved">
            <span className="marker" aria-hidden="true" />
            <span>Todo el texto cumple el contraste AA (4,5:1).</span>
          </p>
        ) : (
          <Alert>
            <strong>Poco contraste</strong> (mínimo 4,5:1, se puede guardar igualmente):
            <ul>
              {issues.map((i) => (
                <li key={i.label}>
                  {i.label}: {formatNumber(i.ratio, 1)}:1
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          Guardar tema
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancelar
        </button>
        {!isNew &&
          (confirmDelete ? (
            <>
              <button type="button" className="btn btn-danger" onClick={() => void remove()}>
                Sí, borrar «{draft.name}»
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                No
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              Borrar tema
            </button>
          ))}
      </div>
    </div>
  )
}

/** Copia de un tema como punto de partida de uno nuevo. */
export function newThemeFrom(base: Theme, existing: Theme[]): Theme {
  let n = 1
  const names = new Set([...BUILT_IN_THEMES, ...existing].map((t) => t.name))
  while (names.has(`${base.name} (copia${n > 1 ? ` ${n}` : ''})`)) n++
  return {
    ...base,
    id: `propio-${Date.now().toString(36)}`,
    name: `${base.name} (copia${n > 1 ? ` ${n}` : ''})`,
  }
}
