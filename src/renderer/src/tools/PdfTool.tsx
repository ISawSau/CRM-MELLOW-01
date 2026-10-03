import { useState } from 'react'
import { formatBytes } from '@shared/files'
import { formatNumber } from '@shared/format'
import { t, tn } from '@shared/i18n'
import { parseRanges, PDF_LEVELS, type PdfLevel } from '@shared/tools'
import { compressPdf, mergePdfs, pdfPageCount, splitPdf } from './pdf'
import {
  DestinationPicker,
  DropZone,
  errorMessage,
  ResultList,
  saveOutput,
  sizeChange,
  type Destination,
  type ResultRow,
} from './kit'

type Mode = 'unir' | 'dividir' | 'comprimir'

interface Loaded {
  name: string
  data: Uint8Array
  pages: number | null
  error?: string
}

const baseName = (n: string) => n.replace(/\.pdf$/i, '') || 'documento'
const pagesLabel = (n: number) => tn(n, '{n} página', '{n} páginas', { n: formatNumber(n, 0) })

/** Unir, dividir y comprimir PDF. */
export function PdfTool() {
  const [mode, setMode] = useState<Mode>('unir')
  const [files, setFiles] = useState<Loaded[]>([])
  const [ranges, setRanges] = useState('')
  const [level, setLevel] = useState<PdfLevel>('media')
  const [dest, setDest] = useState<Destination>({ target: 'boveda', clientId: null })
  const [rows, setRows] = useState<ResultRow[]>([])
  const [busy, setBusy] = useState(false)

  const single = mode === 'dividir'
  const add = async (list: File[]) => {
    setRows([])
    const loaded = await Promise.all(
      list.map(async (f): Promise<Loaded> => {
        const data = new Uint8Array(await f.arrayBuffer())
        try {
          return { name: f.name, data, pages: await pdfPageCount(data) }
        } catch (e) {
          return { name: f.name, data, pages: null, error: errorMessage(e, t('PDF no válido.')) }
        }
      }),
    )
    setFiles((prev) => (single ? loaded.slice(0, 1) : [...prev, ...loaded]))
  }
  const valid = files.filter((f) => f.pages !== null)
  const groups = single && valid[0] ? parseRanges(ranges, valid[0].pages!) : null
  const rangeError = typeof groups === 'string' ? groups : null

  const move = (i: number, d: -1 | 1) => {
    const next = [...files]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x!)
    setFiles(next)
  }

  const run = async () => {
    setBusy(true)
    const out: ResultRow[] = []
    const push = (r: ResultRow) => {
      out.push(r)
      setRows([...out])
    }
    const update = (r: ResultRow) => {
      out[out.findIndex((x) => x.key === r.key)] = r
      setRows([...out])
    }
    try {
      if (mode === 'unir') {
        const name = `${baseName(valid[0]!.name)}-unido.pdf`
        const row: ResultRow = { key: 'unido', name, detail: '', status: 'trabajando' }
        push(row)
        try {
          const data = await mergePdfs(valid.map((f) => f.data))
          const pages = valid.reduce((n, f) => n + f.pages!, 0)
          update({
            ...row,
            detail: `${pagesLabel(pages)} · ${formatBytes(data.byteLength)}`,
            ...(await saveOutput(name, data, dest)),
          })
        } catch (e) {
          update({ ...row, status: 'error', message: errorMessage(e, t('No se han podido unir.')) })
        }
      } else if (mode === 'dividir' && Array.isArray(groups)) {
        const src = valid[0]!
        const parts = await splitPdf(src.data, groups)
        for (const [i, data] of parts.entries()) {
          const g = groups[i]!
          const label = g.length === 1 ? `p${g[0]! + 1}` : `p${g[0]! + 1}-${g.at(-1)! + 1}`
          const name = `${baseName(src.name)}-${label}.pdf`
          const row: ResultRow = {
            key: name,
            name,
            detail: `${pagesLabel(g.length)} · ${formatBytes(data.byteLength)}`,
            status: 'trabajando',
          }
          push(row)
          update({ ...row, ...(await saveOutput(name, data, dest)) })
        }
      } else if (mode === 'comprimir') {
        for (const f of valid) {
          const name = `${baseName(f.name)}-comprimido.pdf`
          const row: ResultRow = { key: f.name, name, detail: '', status: 'trabajando' }
          push(row)
          try {
            const data = await compressPdf(f.data, level)
            // Si no se gana nada, se guarda el original tal cual.
            const better = data.byteLength < f.data.byteLength
            update({
              ...row,
              detail: better
                ? sizeChange(f.data.byteLength, data.byteLength, formatBytes)
                : t('{size} · ya estaba optimizado', { size: formatBytes(f.data.byteLength) }),
              ...(await saveOutput(name, better ? data : f.data, dest)),
            })
          } catch (e) {
            update({
              ...row,
              status: 'error',
              message: errorMessage(e, t('No se ha podido comprimir.')),
            })
          }
        }
      }
    } catch (e) {
      push({
        key: 'error',
        name: files[0]?.name ?? 'PDF',
        detail: '',
        status: 'error',
        message: errorMessage(e, t('No se ha podido procesar el PDF.')),
      })
    }
    setFiles([])
    setBusy(false)
  }

  const canRun =
    !busy &&
    (mode === 'unir'
      ? valid.length >= 2
      : mode === 'dividir'
        ? valid.length === 1 && Array.isArray(groups)
        : valid.length >= 1)

  return (
    <div className="tool" data-testid="tool-pdf">
      <div className="segmented" role="group" aria-label={t('Qué hacer')}>
        {(
          [
            ['unir', 'Unir'],
            ['dividir', 'Dividir'],
            ['comprimir', 'Comprimir'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => {
              setMode(id)
              setRows([])
              if (id === 'dividir') setFiles((f) => f.slice(0, 1))
            }}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <DropZone
        accept="application/pdf,.pdf"
        multiple={!single}
        hint={
          mode === 'unir'
            ? t('Arrastra aquí los PDF que quieras unir, en orden.')
            : mode === 'dividir'
              ? t('Arrastra aquí el PDF que quieras dividir.')
              : t('Arrastra aquí los PDF que quieras comprimir.')
        }
        onFiles={(f) => void add(f)}
        testId="pdf-drop"
        disabled={busy}
      />
      {files.length > 0 && (
        <ol className="tool-files">
          {files.map((f, i) => (
            <li key={`${i}-${f.name}`}>
              <span>{f.name}</span>
              <span className={f.error ? 'danger-text' : 'faint num'}>
                {f.error ?? `${pagesLabel(f.pages!)} · ${formatBytes(f.data.byteLength)}`}
              </span>
              {mode === 'unir' && (
                <>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Subir {name}', { name: f.name })}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Bajar {name}', { name: f.name })}
                    disabled={i === files.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </>
              )}
              <button
                type="button"
                className="icon-btn"
                aria-label={t('Quitar {name}', { name: f.name })}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </li>
          ))}
        </ol>
      )}
      <div className="tool-options">
        {mode === 'dividir' && (
          <div className="field">
            <label htmlFor="pdf-ranges">{t('Páginas de cada PDF')}</label>
            <input
              id="pdf-ranges"
              className="input"
              placeholder="1-3, 4, 5-"
              value={ranges}
              onChange={(e) => setRanges(e.target.value)}
              aria-invalid={rangeError !== null}
            />
            <span className={rangeError ? 'hint danger-text' : 'hint'}>
              {rangeError ?? t('Un PDF por cada rango. Vacío: uno por página.')}
            </span>
          </div>
        )}
        {mode === 'comprimir' && (
          <div className="field">
            <label htmlFor="pdf-level">{t('Compresión')}</label>
            <select
              id="pdf-level"
              className="input"
              value={level}
              onChange={(e) => setLevel(e.target.value as PdfLevel)}
            >
              {Object.entries(PDF_LEVELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {t(v.label)}
                </option>
              ))}
            </select>
            <span className="hint">
              {level === 'ligera'
                ? t('Reorganiza el archivo sin tocar el contenido.')
                : t('Convierte cada página en imagen: el texto deja de poder seleccionarse.')}
            </span>
          </div>
        )}
      </div>
      <DestinationPicker value={dest} onChange={setDest} idPrefix="pdf" />
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canRun}
          onClick={() => void run()}
        >
          {busy
            ? t('Procesando…')
            : mode === 'unir'
              ? valid.length >= 2
                ? t('Unir {n} PDF', { n: valid.length })
                : t('Unir PDF')
              : mode === 'dividir'
                ? t('Dividir PDF')
                : t('Comprimir PDF')}
        </button>
        {mode === 'unir' && valid.length === 1 && (
          <span className="faint">{t('Añade al menos otro PDF.')}</span>
        )}
      </div>
      <ResultList rows={rows} />
    </div>
  )
}
