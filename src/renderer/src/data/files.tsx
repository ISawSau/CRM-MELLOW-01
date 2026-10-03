import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type DragEvent } from 'react'
import type { FieldDef, FileRef } from '@shared/data/fields'
import { formatBytes, isPreviewImage, isVideo } from '@shared/files'
import { t } from '@shared/i18n'
import { MAX_UPLOAD_BYTES } from '@shared/ipc'
import { call, IpcCallError } from '../lib/ipc'
import { useToast } from '../ui/Toast'

/**
 * Archivos de la bóveda en la interfaz. Se ven con `vault://file/<id>` (descifrado al
 * vuelo por el proceso principal) y las miniaturas se generan aquí, con Chromium,
 * la primera vez que se ve el archivo (sin dependencias nativas).
 */

export const fileUrl = (id: string) => `vault://file/${id}`
export const thumbUrl = (id: string) => `vault://thumb/${id}`

const THUMB_SIDE = 480
const pending = new Set<string>()

function useFileInfo(id: string) {
  return useQuery({
    queryKey: ['data', 'file', id],
    queryFn: () => call('files:info', { id }),
    staleTime: 60_000,
  })
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ])
}

async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array<ArrayBuffer>> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8))
  if (!blob) throw new Error('No se pudo crear la miniatura')
  return new Uint8Array(await blob.arrayBuffer())
}

function drawScaled(src: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const scale = Math.min(1, THUMB_SIDE / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * scale))
  canvas.height = Math.max(1, Math.round(h * scale))
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** Calcula medidas y miniatura de una imagen o vídeo y las guarda en la bóveda. */
async function makeThumbnail(id: string, mime: string): Promise<void> {
  if (isPreviewImage(mime)) {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = fileUrl(id)
    await withTimeout(img.decode(), 20_000)
    const thumb = await canvasToJpeg(drawScaled(img, img.naturalWidth, img.naturalHeight))
    await call('files:setMeta', { id, width: img.naturalWidth, height: img.naturalHeight, thumb })
  } else if (isVideo(mime)) {
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'
    video.muted = true
    video.preload = 'auto'
    video.src = fileUrl(id)
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve()
        video.onerror = () => reject(new Error('vídeo no compatible'))
      }),
      30_000,
    )
    const at = Number.isFinite(video.duration) ? Math.min(1, video.duration / 2) : 0
    await withTimeout(
      new Promise<void>((resolve) => {
        video.onseeked = () => resolve()
        video.currentTime = at
      }),
      15_000,
    )
    const thumb = await canvasToJpeg(drawScaled(video, video.videoWidth, video.videoHeight))
    await call('files:setMeta', {
      id,
      width: video.videoWidth,
      height: video.videoHeight,
      ...(Number.isFinite(video.duration) ? { duration: video.duration } : {}),
      thumb,
    })
    video.removeAttribute('src')
    video.load()
  }
}

/** Miniatura de un archivo; la genera si aún no la tiene. */
export function FileThumb({
  file,
  className = 'file-thumb',
}: {
  file: FileRef
  className?: string
}) {
  const info = useFileInfo(file.id)
  const qc = useQueryClient()
  const [failed, setFailed] = useState(false)
  const mime = info.data?.mime ?? file.mime
  const canPreview = isPreviewImage(mime) || isVideo(mime)

  useEffect(() => {
    if (!info.data || info.data.hasThumb || !canPreview || pending.has(file.id) || failed) return
    pending.add(file.id)
    makeThumbnail(file.id, mime)
      .then(() => qc.invalidateQueries({ queryKey: ['data', 'file', file.id] }))
      .catch(() => setFailed(true))
      .finally(() => pending.delete(file.id))
  }, [info.data, canPreview, file.id, mime, qc, failed])

  if (info.data?.hasThumb)
    return (
      <span className={className}>
        <img src={thumbUrl(file.id)} alt="" loading="lazy" />
        {isVideo(mime) && <span className="file-badge">▶</span>}
      </span>
    )
  const ext = file.name.split('.').pop()?.toUpperCase().slice(0, 4) ?? ''
  return (
    <span className={className} data-empty="true">
      <span className="file-ext">{ext || t('ARCH')}</span>
    </span>
  )
}

/** Visor a pantalla completa: imagen o vídeo; para el resto, solo exportar. */
export function FilePreview({ file, onClose }: { file: FileRef; onClose: () => void }) {
  const info = useFileInfo(file.id)
  const toast = useToast()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])
  const mime = info.data?.mime ?? file.mime
  const meta = info.data
  return (
    <>
      <div className="overlay overlay-dark" onClick={onClose} />
      <div
        className="preview"
        role="dialog"
        aria-modal="true"
        aria-label={file.name}
        data-testid="file-preview"
      >
        <div className="preview-head">
          <span className="preview-name">{file.name}</span>
          <span className="faint num">
            {formatBytes(file.size)}
            {meta?.width ? ` · ${meta.width}×${meta.height}` : ''}
            {meta?.duration ? ` · ${meta.duration} s` : ''}
          </span>
          <button
            type="button"
            className="btn"
            onClick={() =>
              void call('files:export', { id: file.id, name: file.name })
                .then((p) => p && toast.show(t('Guardado: {path}', { path: p })))
                .catch(() => toast.show(t('No se pudo guardar.'), 'error'))
            }
          >
            {t('Guardar una copia')}
          </button>
          <button type="button" className="icon-btn" aria-label={t('Cerrar')} onClick={onClose}>
            ×
          </button>
        </div>
        <div className="preview-body">
          {isPreviewImage(mime) ? (
            <img src={fileUrl(file.id)} alt={file.name} />
          ) : isVideo(mime) ? (
            <video src={fileUrl(file.id)} controls autoPlay />
          ) : (
            <p className="muted">
              {t(
                'Este tipo de archivo no tiene vista previa. «Guardar una copia» lo deja donde elijas.',
              )}
            </p>
          )}
        </div>
      </div>
    </>
  )
}

/** Editor de un campo de archivos: añadir (diálogo o arrastrar), ver, guardar copia y quitar. */
export function FilesEditor({
  field,
  value,
  onCommit,
}: {
  field: FieldDef
  value: unknown
  onCommit: (v: unknown) => void
}) {
  const files = (value as FileRef[] | undefined) ?? []
  const toast = useToast()
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<FileRef | null>(null)
  const add = (refs: FileRef[]) => {
    if (!refs.length) return
    const known = new Set(files.map((f) => f.id))
    onCommit([...files, ...refs.filter((r) => !known.has(r.id))])
  }
  const fail = (e: unknown) =>
    toast.show(e instanceof IpcCallError ? e.message : t('No se pudo añadir el archivo.'), 'error')

  const onDrop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const list = [...e.dataTransfer.files]
    if (!list.length) return
    setBusy(true)
    try {
      const refs: FileRef[] = []
      for (const f of list) {
        if (f.size > MAX_UPLOAD_BYTES) {
          toast.show(
            t('«{name}» es muy grande para arrastrarlo: usa «Añadir archivos».', { name: f.name }),
            'error',
          )
          continue
        }
        refs.push(
          await call('files:upload', { name: f.name, data: new Uint8Array(await f.arrayBuffer()) }),
        )
      }
      add(refs)
    } catch (err) {
      fail(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="files-edit"
      data-over={over}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => void onDrop(e)}
      role="group"
      aria-label={field.label}
      data-testid="files-edit"
    >
      {files.length > 0 && (
        <ul className="files-grid">
          {files.map((f) => (
            <li key={f.id} className="file-tile">
              <button
                type="button"
                className="file-open"
                aria-label={t('Ver {name}', { name: f.name })}
                onClick={() => setPreview(f)}
              >
                <FileThumb file={f} />
              </button>
              <span className="file-name" title={f.name}>
                {f.name}
              </span>
              <span className="faint num file-size">{formatBytes(f.size)}</span>
              <button
                type="button"
                className="icon-btn file-remove"
                aria-label={t('Quitar {title}', { title: f.name })}
                onClick={() => onCommit(files.filter((x) => x.id !== f.id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="files-actions">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void call('files:pick')
              .then(add)
              .catch(fail)
              .finally(() => setBusy(false))
          }}
        >
          {busy ? t('Cifrando…') : t('Añadir archivos')}
        </button>
        <span className="faint">{t('o arrástralos aquí')}</span>
      </div>
      {preview && <FilePreview file={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
