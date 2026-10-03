import { useState } from 'react'
import { formatBytes } from '@shared/files'
import { formatNumber, parseNumberEs } from '@shared/format'
import { t, tn } from '@shared/i18n'
import { convertImage, IMAGE_FORMATS, type ImageOptions } from './image'
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

/** Comprimir, redimensionar y convertir imágenes (JPEG, PNG, WebP). */
export function ImageTool() {
  const [files, setFiles] = useState<File[]>([])
  const [format, setFormat] = useState<ImageOptions['format']>('mismo')
  const [quality, setQuality] = useState(82)
  const [maxWidth, setMaxWidth] = useState('')
  const [dest, setDest] = useState<Destination>({ target: 'boveda', clientId: null })
  const [rows, setRows] = useState<ResultRow[]>([])
  const [busy, setBusy] = useState(false)

  const width = maxWidth.trim() === '' ? null : (parseNumberEs(maxWidth) ?? Number.NaN)
  const widthOk = width === null || (Number.isInteger(width) && width >= 16 && width <= 20_000)

  const run = async () => {
    setBusy(true)
    const out: ResultRow[] = files.map((f, i) => ({
      key: `${i}-${f.name}`,
      name: f.name,
      detail: formatBytes(f.size),
      status: 'trabajando',
    }))
    setRows([...out])
    for (const [i, f] of files.entries()) {
      try {
        const r = await convertImage(f, { format, quality: quality / 100, maxWidth: width })
        const saved = await saveOutput(r.name, r.data, dest)
        out[i] = {
          ...out[i]!,
          name: r.name,
          detail: `${formatNumber(r.width, 0)} × ${formatNumber(r.height, 0)} px · ${sizeChange(f.size, r.data.byteLength, formatBytes)}`,
          ...saved,
        }
      } catch (e) {
        out[i] = {
          ...out[i]!,
          status: 'error',
          message: errorMessage(e, t('No se ha podido leer la imagen.')),
        }
      }
      setRows([...out])
    }
    setFiles([])
    setBusy(false)
  }

  return (
    <div className="tool" data-testid="tool-imagenes">
      <DropZone
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        multiple
        hint={t('Arrastra aquí imágenes JPEG, PNG, WebP, GIF o AVIF.')}
        onFiles={(f) => {
          setFiles((prev) => [...prev, ...f])
          setRows([])
        }}
        testId="image-drop"
        disabled={busy}
      />
      {files.length > 0 && (
        <ul className="tool-files">
          {files.map((f, i) => (
            <li key={`${i}-${f.name}`}>
              <span>{f.name}</span>
              <span className="faint num">{formatBytes(f.size)}</span>
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
        </ul>
      )}
      <div className="tool-options">
        <div className="field">
          <label htmlFor="img-format">{t('Formato')}</label>
          <select
            id="img-format"
            className="input"
            value={format}
            onChange={(e) => setFormat(e.target.value as ImageOptions['format'])}
          >
            <option value="mismo">{t('El mismo')}</option>
            {Object.entries(IMAGE_FORMATS).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="img-quality">{t('Calidad: {n} %', { n: quality })}</label>
          <input
            id="img-quality"
            type="range"
            min={40}
            max={100}
            step={1}
            value={quality}
            disabled={format === 'image/png'}
            onChange={(e) => setQuality(Number(e.target.value))}
          />
          <span className="hint">
            {format === 'image/png' ? t('PNG no tiene pérdida.') : t('Solo JPEG y WebP.')}
          </span>
        </div>
        <div className="field">
          <label htmlFor="img-width">{t('Ancho máximo (px)')}</label>
          <input
            id="img-width"
            className="input"
            inputMode="numeric"
            placeholder={t('Sin cambiar')}
            value={maxWidth}
            onChange={(e) => setMaxWidth(e.target.value)}
            aria-invalid={!widthOk}
          />
          {!widthOk && <span className="hint danger-text">{t('Entre 16 y 20.000 píxeles.')}</span>}
        </div>
      </div>
      <DestinationPicker value={dest} onChange={setDest} idPrefix="img" />
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || files.length === 0 || !widthOk}
          onClick={() => void run()}
        >
          {busy
            ? t('Procesando…')
            : files.length > 1
              ? tn(files.length, 'Procesar {n} imagen', 'Procesar {n} imágenes')
              : t('Procesar imagen')}
        </button>
      </div>
      <ResultList rows={rows} />
    </div>
  )
}
