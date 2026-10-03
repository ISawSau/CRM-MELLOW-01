import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { formatBytes } from '@shared/files'
import { formatNumber } from '@shared/format'
import {
  VIDEO_FITS,
  VIDEO_PRESETS,
  VIDEO_QUALITY,
  type VideoFit,
  type VideoInfo,
  type VideoPreset,
  type VideoQuality,
} from '@shared/tools'
import { call, IpcCallError, subscribe } from '../lib/ipc'
import {
  describeSaved,
  DestinationPicker,
  DropZone,
  errorMessage,
  ResultList,
  type Destination,
  type ResultRow,
} from './kit'

/** «62,5» → «1:02» */
function duration(s: number | null): string {
  if (s === null) return '—'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

/** Comprimir y convertir vídeo con FFmpeg, con presets para Meta (9:16, 1:1, 4:5). */
export function VideoTool() {
  const status = useQuery({ queryKey: ['tools', 'status'], queryFn: () => call('tools:status') })
  const [video, setVideo] = useState<VideoInfo | null>(null)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [preset, setPreset] = useState<VideoPreset>('vertical')
  const [fit, setFit] = useState<VideoFit>('recortar')
  const [quality, setQuality] = useState<VideoQuality>('media')
  const [mute, setMute] = useState(false)
  const [dest, setDest] = useState<Destination>({ target: 'boveda', clientId: null })
  const [progress, setProgress] = useState<number | null>(null)
  const [rows, setRows] = useState<ResultRow[]>([])

  const token = video?.token
  useEffect(
    () =>
      subscribe('tools:progress', (p) => {
        if (p.token === token) setProgress(p.ratio)
      }),
    [token],
  )

  const open = async (file: File) => {
    setOpening(true)
    setOpenError(null)
    setRows([])
    const r = await window.api.openDroppedVideo(file).catch(() => null)
    setOpening(false)
    if (r?.ok) setVideo(r.data)
    else setOpenError(r ? r.error.message : 'Ese archivo no se puede abrir.')
  }

  const run = async () => {
    if (!video) return
    setProgress(0)
    const row: ResultRow = { key: video.token, name: video.name, detail: '', status: 'trabajando' }
    setRows([row])
    try {
      const r = await call('tools:convertVideo', {
        token: video.token,
        preset,
        fit,
        quality,
        mute,
        target: dest.target,
        clientId: dest.clientId,
      })
      setRows([{ ...row, ...(r ? { name: r.name } : {}), ...describeSaved(r) }])
    } catch (e) {
      const cancelled = e instanceof IpcCallError && e.code === 'TOOL_CANCELLED'
      setRows([
        {
          ...row,
          status: cancelled ? 'cancelado' : 'error',
          message: cancelled ? 'Cancelado' : errorMessage(e, 'No se ha podido convertir.'),
        },
      ])
    }
    setProgress(null)
  }

  if (status.data && !status.data.ffmpeg)
    return (
      <div className="empty" data-testid="tool-video">
        <h2>Falta FFmpeg</h2>
        <p className="muted">
          La conversión de vídeo usa FFmpeg, que viene con el instalador. Si estás en modo
          desarrollo, ejecuta <code>node scripts/descargar-ffmpeg.mjs</code>.
        </p>
      </div>
    )

  const busy = progress !== null
  return (
    <div className="tool" data-testid="tool-video">
      <DropZone
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mov,.mkv,.avi,.m4v"
        multiple={false}
        hint="Arrastra aquí un vídeo (MP4, MOV, WebM, MKV o AVI)."
        onFiles={(f) => void open(f[0]!)}
        testId="video-drop"
        disabled={busy || opening}
      />
      {opening && <p className="muted">Leyendo el vídeo…</p>}
      {openError && <p className="danger-text">{openError}</p>}
      {video && (
        <p className="tool-video-info" data-testid="video-info">
          <strong>{video.name}</strong>
          <span className="faint num">
            {duration(video.duration)} · {formatNumber(video.width ?? 0, 0)} ×{' '}
            {formatNumber(video.height ?? 0, 0)} px · {formatBytes(video.size)}
          </span>
        </p>
      )}
      <fieldset className="tool-presets">
        <legend>Formato</legend>
        {Object.entries(VIDEO_PRESETS).map(([k, p]) => (
          <label key={k} className="tool-preset" data-checked={preset === k}>
            <input
              type="radio"
              name="video-preset"
              className="sr-only"
              checked={preset === k}
              onChange={() => setPreset(k as VideoPreset)}
            />
            <span className="tool-aspect" aria-hidden="true" data-preset={k} />
            <span>{p.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="tool-options">
        {preset !== 'comprimir' && (
          <div className="field">
            <label htmlFor="video-fit">Si no encaja</label>
            <select
              id="video-fit"
              className="input"
              value={fit}
              onChange={(e) => setFit(e.target.value as VideoFit)}
            >
              {Object.entries(VIDEO_FITS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="video-quality">Calidad</label>
          <select
            id="video-quality"
            className="input"
            value={quality}
            onChange={(e) => setQuality(e.target.value as VideoQuality)}
          >
            {Object.entries(VIDEO_QUALITY).map(([k, q]) => (
              <option key={k} value={k}>
                {q.label}
              </option>
            ))}
          </select>
        </div>
        <label className="check tool-check">
          <input type="checkbox" checked={mute} onChange={(e) => setMute(e.target.checked)} />
          <span>Quitar el sonido</span>
        </label>
      </div>
      <DestinationPicker value={dest} onChange={setDest} idPrefix="video" />
      <div className="form-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={!video || busy}
          onClick={() => void run()}
        >
          {busy ? 'Convirtiendo…' : 'Convertir vídeo'}
        </button>
        {busy && (
          <>
            <progress
              className="tool-progress"
              max={1}
              value={progress}
              aria-label="Avance de la conversión"
            />
            <span className="num muted">{formatNumber(progress * 100, 0)} %</span>
            <button
              type="button"
              className="btn"
              onClick={() => void call('tools:cancel', { token: video!.token })}
            >
              Cancelar
            </button>
          </>
        )}
      </div>
      <ResultList rows={rows} />
    </div>
  )
}
