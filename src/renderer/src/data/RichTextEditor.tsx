import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { useEffect, useRef, useState } from 'react'
import type { RichText } from '@shared/data/fields'
import { t, tc } from '@shared/i18n'

const SAVE_DELAY_MS = 700
const SAFE_LINK = /^(https:\/\/|mailto:)/i

/**
 * Texto largo con formato (Tiptap). `injectCSS: false` porque Tiptap añadiría una
 * etiqueta <style> que la CSP bloquea: sus estilos base están en app.css.
 * Los enlaces solo pueden ser https o mailto y se abren con Ctrl+clic en el
 * navegador del sistema.
 */
export function RichTextEditor({
  value,
  onCommit,
  label,
}: {
  value: RichText | null
  onCommit: (value: RichText | null) => void
  label: string
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  })

  const save = (editor: Editor) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const text = editor.getText({ blockSeparator: '\n' }).trim()
    commitRef.current(editor.isEmpty ? null : { doc: editor.getJSON(), text })
  }

  const editor = useEditor({
    injectCSS: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          protocols: [],
          isAllowedUri: (url) => SAFE_LINK.test(url),
          HTMLAttributes: { rel: 'noreferrer', target: '_blank' },
        },
      }),
    ],
    content: value?.doc ?? '',
    editorProps: {
      attributes: { class: 'rte-content', 'aria-label': label, role: 'textbox' },
    },
    onUpdate: ({ editor: e }) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => save(e), SAVE_DELAY_MS)
    },
    onBlur: ({ editor: e }) => {
      if (timer.current) save(e)
    },
  })

  // Guarda lo pendiente al cerrar el panel.
  useEffect(
    () => () => {
      if (timer.current && editor) save(editor)
    },
    [editor],
  )

  // Cambios desde fuera (deshacer, otra vista): se cargan si no se está escribiendo.
  useEffect(() => {
    if (!editor || editor.isFocused || timer.current) return
    const incoming = JSON.stringify(value?.doc ?? null)
    const current = editor.isEmpty ? 'null' : JSON.stringify(editor.getJSON())
    if (incoming !== current) editor.commands.setContent(value?.doc ?? '', { emitUpdate: false })
  }, [editor, value])

  if (!editor) return null
  return (
    <div className="rte">
      <Toolbar editor={editor} />
      <EditorContent
        editor={editor}
        onClick={(e) => {
          const a = (e.target as HTMLElement).closest('a')
          if (a && (e.ctrlKey || e.metaKey) && SAFE_LINK.test(a.href)) {
            e.preventDefault()
            window.open(a.href, '_blank', 'noreferrer')
          }
        }}
      />
    </div>
  )
}

function Toolbar({ editor }: { editor: Editor }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('code'),
      link: e.isActive('link'),
    }),
  })
  const [linking, setLinking] = useState(false)
  const [href, setHref] = useState('')
  const chain = () => editor.chain().focus()
  const btn = (label: string, text: string, active: boolean, run: () => void) => (
    <button
      type="button"
      className="rte-btn"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={run}
    >
      {text}
    </button>
  )
  return (
    <div className="rte-toolbar" role="toolbar" aria-label={tc('texto', 'Formato')}>
      {btn(t('Negrita (Ctrl+B)'), 'B', state.bold, () => chain().toggleBold().run())}
      {btn(t('Cursiva (Ctrl+I)'), 'I', state.italic, () => chain().toggleItalic().run())}
      {btn(t('Tachado'), 'S', state.strike, () => chain().toggleStrike().run())}
      <span className="rte-sep" />
      {btn(tc('texto', 'Título'), 'H2', state.h2, () => chain().toggleHeading({ level: 2 }).run())}
      {btn(t('Subtítulo'), 'H3', state.h3, () => chain().toggleHeading({ level: 3 }).run())}
      {btn(t('Lista'), '•', state.bullet, () => chain().toggleBulletList().run())}
      {btn(t('Lista numerada'), '1.', state.ordered, () => chain().toggleOrderedList().run())}
      {btn(t('Cita'), '❝', state.quote, () => chain().toggleBlockquote().run())}
      {btn(t('Código'), '</>', state.code, () => chain().toggleCode().run())}
      <span className="rte-sep" />
      {btn(t('Enlace (https o mailto)'), '🔗', state.link, () => {
        if (state.link) chain().unsetLink().run()
        else {
          setHref((editor.getAttributes('link')['href'] as string | undefined) ?? 'https://')
          setLinking(true)
        }
      })}
      {linking && (
        <form
          className="rte-link"
          onSubmit={(e) => {
            e.preventDefault()
            if (SAFE_LINK.test(href)) chain().extendMarkRange('link').setLink({ href }).run()
            setLinking(false)
          }}
        >
          <input
            className="input"
            autoFocus
            value={href}
            aria-label={t('Dirección del enlace')}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setLinking(false)
              }
            }}
          />
          <button type="submit" className="btn" disabled={!SAFE_LINK.test(href)}>
            {t('Enlazar')}
          </button>
        </form>
      )}
    </div>
  )
}
