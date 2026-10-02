import type { FieldDef, RichText } from '@shared/data/fields'
import type { RecordRow } from '@shared/data/records'
import { FieldValue } from '../FieldValue'

/** Campos que se enseñan en tarjetas y filas de lista. */
export function CardFields({ row, fields }: { row: RecordRow; fields: FieldDef[] }) {
  const shown = fields.filter((f) => {
    const v = row.values[f.id]
    return v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0)
  })
  if (shown.length === 0) return null
  return (
    <span className="card-fields">
      {shown.map((f) => (
        <span key={f.id} className="card-field" title={f.label}>
          <FieldValue field={f} value={row.values[f.id]} />
        </span>
      ))}
    </span>
  )
}

export function snippet(row: RecordRow, fields: FieldDef[], max = 180): string {
  const f = fields.find((x) => x.type === 'longtext' && row.values[x.id])
  const text = f ? (row.values[f.id] as RichText).text : ''
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

export function ListView({
  rows,
  cardFields,
  allFields,
  onOpen,
}: {
  rows: RecordRow[]
  cardFields: FieldDef[]
  allFields: FieldDef[]
  onOpen: (id: string) => void
}) {
  return (
    <ul className="list" data-testid="list">
      {rows.map((r) => (
        <li key={r.id}>
          <button type="button" className="list-row" onClick={() => onOpen(r.id)}>
            <span className="list-title">{r.title}</span>
            <span className="list-snippet faint">{snippet(r, allFields, 120)}</span>
            <CardFields row={r} fields={cardFields} />
          </button>
        </li>
      ))}
    </ul>
  )
}

export function GalleryView({
  rows,
  cardFields,
  allFields,
  onOpen,
}: {
  rows: RecordRow[]
  cardFields: FieldDef[]
  allFields: FieldDef[]
  onOpen: (id: string) => void
}) {
  return (
    <div className="gallery" data-testid="gallery">
      {rows.map((r) => (
        <button key={r.id} type="button" className="card" onClick={() => onOpen(r.id)}>
          <span className="card-title">{r.title}</span>
          <span className="card-snippet muted">{snippet(r, allFields)}</span>
          <CardFields row={r} fields={cardFields} />
        </button>
      ))}
    </div>
  )
}
