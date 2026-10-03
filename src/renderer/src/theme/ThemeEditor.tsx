import { useEffect, useRef, useState } from 'react'
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
  type ThemeBackground as ThemeBg,
  type ThemeColors,
} from '@shared/themes'
import { call, IpcCallError } from '../lib/ipc'
import { Alert } from '../ui/Alert'
import { SECTION_GROUPS } from '../shell/sections'
import { applyAppearance } from './apply'
import { ThemeBackground } from './ThemeBackground'
import { t } from '@shared/i18n'

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
        aria-label={t('{label} (código)', { label })}
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
            aria-label={t('Opacidad de {label}', { label: label.toLowerCase() })}
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

  // Vista previa en directo. Al cancelar se vuelve a aplicar el tema guardado; al guardar
  // o borrar lo aplica la app con los temas nuevos.
  const committed = useRef(false)
  useEffect(() => {
    if (themeSchema.safeParse(draft).success) applyAppearance(draft, density)
  }, [draft, density])
  useEffect(
    () => () => {
      if (!committed.current)
        applyAppearance(findTheme(current, [...BUILT_IN_THEMES, ...themes]), density)
    },
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
    const th = { ...draft, name: draft.name.trim() }
    if (!th.name) return setError(t('Ponle un nombre al tema.'))
    const list = isNew ? [...themes, th] : themes.map((x) => (x.id === th.id ? th : x))
    try {
      committed.current = true
      await call('settings:setThemes', { themes: list })
      await call('settings:setAppearance', { theme: th.id, density })
      onClose()
    } catch (e) {
      committed.current = false
      setError(e instanceof IpcCallError ? e.message : t('No se ha podido guardar el tema.'))
    }
  }

  const remove = async () => {
    try {
      committed.current = true
      await call('settings:setThemes', { themes: themes.filter((x) => x.id !== draft.id) })
      onClose()
    } catch (e) {
      committed.current = false
      setError(e instanceof IpcCallError ? e.message : t('No se ha podido borrar el tema.'))
    }
  }

  return (
    <div className="theme-editor" data-testid="theme-editor">
      {/* Vista previa del fondo mientras se edita (encima del guardado). */}
      {draft.background && <ThemeBackground key={draft.background.fileId} bg={draft.background} />}
      <div className="theme-editor-head">
        <div className="field">
          <label htmlFor="theme-name">{t('Nombre del tema')}</label>
          <input
            id="theme-name"
            className="input"
            maxLength={60}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="theme-scheme">{t('Tipo')}</label>
          <select
            id="theme-scheme"
            className="input"
            value={draft.scheme}
            onChange={(e) => setDraft({ ...draft, scheme: e.target.value as Theme['scheme'] })}
          >
            <option value="dark">{t('Oscuro')}</option>
            <option value="light">{t('Claro')}</option>
          </select>
          <span className="hint">
            {t('Ajusta los controles del sistema (barras de desplazamiento…).')}
          </span>
        </div>
        <div className="field">
          <label htmlFor="theme-base">{t('Partir de')}</label>
          <select
            id="theme-base"
            className="input"
            value=""
            onChange={(e) => {
              const b = findTheme(e.target.value, [...BUILT_IN_THEMES, ...themes])
              setDraft({ ...draft, scheme: b.scheme, colors: b.colors, options: b.options })
            }}
          >
            <option value="">{t('Elegir un tema…')}</option>
            {[...BUILT_IN_THEMES, ...themes]
              .filter((th) => th.id !== draft.id)
              .map((th) => (
                <option key={th.id} value={th.id}>
                  {t(th.name)}
                </option>
              ))}
          </select>
        </div>
      </div>

      <div className="theme-groups">
        {GROUPS.map((g) => (
          <fieldset key={g.title} className="theme-group">
            <legend>{t(g.title)}</legend>
            {g.keys.map(([k, label]) => (
              <ColorRow
                key={k}
                label={t(label)}
                value={draft.colors[k]}
                onChange={(v) => setColor(k, v)}
              />
            ))}
          </fieldset>
        ))}
        <fieldset className="theme-group theme-group-wide">
          <legend>{t('Etiquetas (fondo y texto)')}</legend>
          <div className="theme-options">
            {OPTION_COLORS.map((o) => (
              <div key={o} className="theme-option">
                <span className="chip" data-color={o}>
                  {t(OPTION_LABELS[o])}
                </span>
                <ColorRow
                  label={t('Fondo {color}', { color: t(OPTION_LABELS[o]).toLowerCase() })}
                  value={draft.options[o].bg}
                  onChange={(v) => setOption(o, 'bg', v)}
                />
                <ColorRow
                  label={t('Texto {color}', { color: t(OPTION_LABELS[o]).toLowerCase() })}
                  value={draft.options[o].text}
                  onChange={(v) => setOption(o, 'text', v)}
                />
              </div>
            ))}
          </div>
        </fieldset>
        <fieldset className="theme-group">
          <legend>{t('Forma')}</legend>
          <label className="theme-range">
            <span>{t('Esquinas redondeadas')}</span>
            <input
              type="range"
              min={0}
              max={24}
              value={draft.radius}
              aria-label={t('Redondeo de esquinas')}
              onChange={(e) => setDraft({ ...draft, radius: Number(e.target.value) })}
            />
            <span className="num faint">{draft.radius} px</span>
          </label>
        </fieldset>
        <BackgroundEditor
          value={draft.background}
          onChange={(background) => setDraft({ ...draft, background })}
        />
        <fieldset className="theme-group theme-group-wide">
          <legend>{t('Iconos de la barra lateral')}</legend>
          <p className="hint">
            {t('Una o dos letras, una cifra o un emoji por sección. Vacío: la letra de serie.')}
          </p>
          <div className="theme-icons">
            {SECTION_GROUPS.flatMap((g) => g.sections).map((sec) => (
              <label key={sec.id} className="theme-icon">
                <input
                  className="input"
                  aria-label={t('Icono de {section}', { section: t(sec.label) })}
                  placeholder={sec.letter}
                  maxLength={8}
                  value={draft.icons[sec.id] ?? ''}
                  onChange={(e) => {
                    const icons = { ...draft.icons }
                    const v = e.target.value.trim()
                    if (v && [...v].length <= 2) icons[sec.id] = v
                    else delete icons[sec.id]
                    setDraft({ ...draft, icons })
                  }}
                />
                <span>{t(sec.label)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="theme-contrast" data-testid="theme-contrast">
        {issues.length === 0 ? (
          <p className="report-saved">
            <span className="marker" aria-hidden="true" />
            <span>{t('Todo el texto cumple el contraste AA (4,5:1).')}</span>
          </p>
        ) : (
          <Alert>
            <strong>{t('Poco contraste')}</strong>{' '}
            {t('(mínimo 4,5:1, se puede guardar igualmente):')}
            <ul>
              {issues.map((i) => (
                <li key={i.label}>
                  {t(i.label)}: {formatNumber(i.ratio, 1)}:1
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </div>

      {error && <Alert>{error}</Alert>}
      <div className="form-actions">
        <button type="button" className="btn btn-primary" onClick={() => void save()}>
          {t('Guardar tema')}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          {t('Cancelar')}
        </button>
        {!isNew &&
          (confirmDelete ? (
            <>
              <button type="button" className="btn btn-danger" onClick={() => void remove()}>
                {t('Sí, borrar «{name}»', { name: draft.name })}
              </button>
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)}>
                {t('No')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              {t('Borrar tema')}
            </button>
          ))}
      </div>
    </div>
  )
}

/** Copia de un tema como punto de partida de uno nuevo. */
export function newThemeFrom(base: Theme, existing: Theme[]): Theme {
  let n = 1
  const names = new Set([...BUILT_IN_THEMES, ...existing].map((th) => th.name))
  const copyName = (k: number) =>
    k > 1
      ? t('{name} (copia {n})', { name: t(base.name), n: k })
      : t('{name} (copia)', { name: t(base.name) })
  while (names.has(copyName(n))) n++
  return {
    ...base,
    id: `propio-${Date.now().toString(36)}`,
    name: copyName(n),
  }
}

/** Fondo del tema: una imagen o un vídeo que se guarda cifrado en la bóveda. */
function BackgroundEditor({
  value,
  onChange,
}: {
  value: ThemeBg | null
  onChange: (bg: ThemeBg | null) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const pick = async () => {
    setError(null)
    try {
      const [file] = await call('files:pick')
      if (!file) return
      const kind = file.mime.startsWith('video/')
        ? 'video'
        : file.mime.startsWith('image/')
          ? 'image'
          : null
      if (!kind) return setError(t('Elige una imagen (JPG, PNG, WebP…) o un vídeo (MP4, WebM).'))
      onChange({
        fileId: file.id,
        kind,
        fit: value?.fit ?? 'cover',
        dim: value?.dim ?? 0.7,
        blur: value?.blur ?? 0,
      })
    } catch (e) {
      setError(e instanceof IpcCallError ? e.message : t('No se ha podido añadir el archivo.'))
    }
  }
  return (
    <fieldset className="theme-group">
      <legend>{t('Fondo')}</legend>
      <div className="form-actions">
        <button type="button" className="btn" onClick={() => void pick()}>
          {value ? t('Cambiar imagen o vídeo…') : t('Elegir imagen o vídeo…')}
        </button>
        {value && (
          <button type="button" className="btn" onClick={() => onChange(null)}>
            {t('Quitar fondo')}
          </button>
        )}
      </div>
      {value && (
        <>
          <label className="theme-range">
            <span>{t('Velo del color de fondo')}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(value.dim * 100)}
              aria-label={t('Velo del fondo')}
              onChange={(e) => onChange({ ...value, dim: Number(e.target.value) / 100 })}
            />
            <span className="num faint">{Math.round(value.dim * 100)} %</span>
          </label>
          <label className="theme-range">
            <span>{t('Desenfoque')}</span>
            <input
              type="range"
              min={0}
              max={30}
              value={value.blur}
              aria-label={t('Desenfoque del fondo')}
              onChange={(e) => onChange({ ...value, blur: Number(e.target.value) })}
            />
            <span className="num faint">{value.blur} px</span>
          </label>
          <label className="theme-range">
            <span>{t('Ajuste')}</span>
            <select
              className="input"
              value={value.fit}
              onChange={(e) => onChange({ ...value, fit: e.target.value as 'cover' | 'contain' })}
            >
              <option value="cover">{t('Cubrir la ventana')}</option>
              <option value="contain">{t('Entera')}</option>
            </select>
          </label>
        </>
      )}
      <p className="hint">
        {value?.kind === 'video' ? `${t('Vídeo sin sonido y en bucle.')} ` : ''}
        {t('Se guarda cifrado en la bóveda. No viaja al exportar el tema.')}
      </p>
      {error && <Alert>{error}</Alert>}
    </fieldset>
  )
}
