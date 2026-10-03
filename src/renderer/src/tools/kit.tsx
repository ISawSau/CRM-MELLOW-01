import { useState, type ReactNode } from 'react'
import type { SavedResult, ToolTarget } from '@shared/tools'
import { call, IpcCallError } from '../lib/ipc'
import { useRecords } from '../data/hooks'
import { useNav } from '../data/nav'
import { PdfError } from './pdf'

/** Piezas comunes de Herramientas e Informes: destino, zona de soltar y resultados. */

export interface Destination {
  target: ToolTarget
  clientId: string | null
}

const NO_FILTERS = { filters: [], match: 'all' as const, sorts: [] }

export function useClients() {
  const q = useRecords('cliente', NO_FILTERS)
  return (q.data ?? [])
    .map((r) => ({ id: r.id, title: r.title }))
    .sort((a, b) => a.title.localeCompare(b.title, 'es'))
}

export function DestinationPicker({
  value,
  onChange,
  idPrefix,
}: {
  value: Destination
  onChange: (d: Destination) => void
  idPrefix: string
}) {
  const clients = useClients()
  return (
    <fieldset className="tool-dest" data-testid="tool-destination">
      <legend>Resultado</legend>
      <label className="check">
        <input
          type="radio"
          name={`${idPrefix}-target`}
          checked={value.target === 'boveda'}
          onChange={() => onChange({ ...value, target: 'boveda' })}
        />
        <span>Guardar en la bóveda (Documentos)</span>
      </label>
      <label className="check">
        <input
          type="radio"
          name={`${idPrefix}-target`}
          checked={value.target === 'exportar'}
          onChange={() => onChange({ ...value, target: 'exportar' })}
        />
        <span>Exportar a una carpeta</span>
      </label>
      {value.target === 'boveda' && (
        <div className="field">
          <label htmlFor={`${idPrefix}-client`}>Cliente</label>
          <select
            id={`${idPrefix}-client`}
            className="input"
            value={value.clientId ?? ''}
            onChange={(e) => onChange({ ...value, clientId: e.target.value || null })}
          >
            <option value="">Sin cliente</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
    </fieldset>
  )
}

/** Arrastrar y soltar, o elegir con el selector del sistema. */
export function DropZone({
  accept,
  multiple,
  hint,
  onFiles,
  testId,
  disabled,
}: {
  accept: string
  multiple: boolean
  hint: string
  onFiles: (files: File[]) => void
  testId: string
  disabled?: boolean
}) {
  const [over, setOver] = useState(false)
  const take = (list: FileList | null) => {
    const files = [...(list ?? [])]
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }
  return (
    <div
      className="dropzone"
      data-over={over}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (!disabled) take(e.dataTransfer.files)
      }}
      data-testid={testId}
    >
      <p className="muted">{hint}</p>
      <label className="btn" aria-disabled={disabled}>
        {multiple ? 'Elegir archivos' : 'Elegir archivo'}
        <input
          type="file"
          className="sr-only"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={(e) => {
            take(e.target.files)
            e.target.value = ''
          }}
        />
      </label>
    </div>
  )
}

export interface ResultRow {
  key: string
  name: string
  detail: ReactNode
  status: 'ok' | 'error' | 'cancelado' | 'trabajando'
  message?: string
  recordId?: string | null
}

export function ResultList({ rows }: { rows: ResultRow[] }) {
  const nav = useNav()
  if (!rows.length) return null
  return (
    <ul className="tool-results" data-testid="tool-results">
      {rows.map((r) => (
        <li key={r.key} data-status={r.status}>
          <span
            className={`marker${r.status === 'error' ? ' marker-error' : ''}`}
            aria-hidden="true"
          />
          <span className="tool-result-name">{r.name}</span>
          <span className="faint num">{r.detail}</span>
          <span className={r.status === 'error' ? 'danger-text' : 'muted'}>
            {r.message ??
              (r.status === 'trabajando'
                ? 'Procesando…'
                : r.status === 'cancelado'
                  ? 'Cancelado'
                  : '')}
          </span>
          {r.recordId && (
            <button
              type="button"
              className="btn-link"
              onClick={() => nav.openRecord('documento', r.recordId!)}
            >
              Ver documento
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Guarda unos bytes en la bóveda (como documento) o los exporta. */
export async function saveOutput(
  name: string,
  data: Uint8Array,
  dest: Destination,
  tipo: 'herramienta' | 'informe' = 'herramienta',
): Promise<Pick<ResultRow, 'status' | 'message' | 'recordId'>> {
  const r: SavedResult | null = await call('tools:save', {
    name,
    // pdf-lib y el canvas devuelven búferes normales (nunca compartidos).
    data: data as Uint8Array<ArrayBuffer>,
    target: dest.target,
    clientId: dest.clientId,
    tipo,
  })
  return describeSaved(r)
}

export function describeSaved(
  r: SavedResult | null,
): Pick<ResultRow, 'status' | 'message' | 'recordId'> {
  if (!r) return { status: 'cancelado' }
  return r.recordId
    ? { status: 'ok', message: 'Guardado en Documentos', recordId: r.recordId }
    : { status: 'ok', message: 'Exportado' }
}

export function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof IpcCallError) return e.message
  if (e instanceof PdfError) return e.message
  return fallback
}

/** «12,3 MB → 2,1 MB (−83 %)» */
export function sizeChange(before: number, after: number, fmt: (n: number) => string): string {
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0
  return `${fmt(before)} → ${fmt(after)} (${pct >= 0 ? '−' : '+'}${Math.abs(pct)} %)`
}
