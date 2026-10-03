import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { parseFieldConfig, type FieldDef, type SelectOption } from '@shared/data/fields'
import type { RecordRow } from '@shared/data/records'
import { t } from '@shared/i18n'
import { useRecordActions } from '../actions'
import { OptionChip } from '../FieldValue'
import { CardFields } from './Cards'
import { dndAccessibility } from './dnd'

const NONE = '__ninguno__'

function KanbanCard({
  row,
  cardFields,
  onOpen,
}: {
  row: RecordRow
  cardFields: FieldDef[]
  onOpen: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: row.id,
  })
  return (
    <div
      ref={setNodeRef}
      className="kanban-card"
      data-dragging={isDragging}
      data-testid="kanban-card"
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      {...listeners}
      {...attributes}
      aria-roledescription={t('tarjeta arrastrable')}
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(row.id)
        listeners?.['onKeyDown']?.(e)
      }}
    >
      <span className="card-title">{row.title}</span>
      <CardFields row={row} fields={cardFields} />
    </div>
  )
}

function KanbanColumn({
  id,
  option,
  rows,
  cardFields,
  onOpen,
  onAdd,
}: {
  id: string
  option: SelectOption | null
  rows: RecordRow[]
  cardFields: FieldDef[]
  onOpen: (id: string) => void
  onAdd: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <section
      ref={setNodeRef}
      className="kanban-col"
      data-over={isOver}
      aria-label={option?.label ?? t('Sin valor')}
      data-testid="kanban-col"
    >
      <header className="kanban-col-head">
        {option ? <OptionChip option={option} /> : <span className="faint">{t('Sin valor')}</span>}
        <span className="faint num">{rows.length}</span>
      </header>
      <div className="kanban-cards">
        {rows.map((r) => (
          <KanbanCard key={r.id} row={r} cardFields={cardFields} onOpen={onOpen} />
        ))}
      </div>
      <button type="button" className="btn-link kanban-add" onClick={onAdd}>
        + {t('Añadir')}
      </button>
    </section>
  )
}

/** Kanban agrupado por un campo de selección. Arrastrar una tarjeta cambia su valor. */
export function KanbanView({
  rows,
  groupField,
  cardFields,
  onOpen,
  onCreate,
}: {
  rows: RecordRow[]
  groupField: FieldDef | undefined
  cardFields: FieldDef[]
  onOpen: (id: string) => void
  onCreate: (values: Record<string, unknown>) => void
}) {
  const { setValue } = useRecordActions()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )
  if (!groupField || groupField.type !== 'select') {
    return (
      <div className="empty">
        <p className="muted">
          {t('Elige en «Agrupar por» un campo de selección para ver el kanban.')}
        </p>
      </div>
    )
  }
  const options = parseFieldConfig('select', groupField.config).options
  const known = new Set(options.map((o) => o.id))
  const groups = new Map<string, RecordRow[]>([
    [NONE, []],
    ...options.map((o) => [o.id, []] as [string, RecordRow[]]),
  ])
  for (const r of rows) {
    const v = r.values[groupField.id]
    groups.get(typeof v === 'string' && known.has(v) ? v : NONE)!.push(r)
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return
    const row = rows.find((r) => r.id === e.active.id)
    const target = e.over.id === NONE ? null : String(e.over.id)
    if (row && (row.values[groupField.id] ?? null) !== target)
      void setValue(row.id, groupField, target)
  }

  const columns: (SelectOption | null)[] = [...options, null]
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={dndAccessibility()}>
      <div className="kanban" data-testid="kanban">
        {columns.map((o) => {
          const id = o?.id ?? NONE
          const list = groups.get(id) ?? []
          if (!o && list.length === 0) return null
          return (
            <KanbanColumn
              key={id}
              id={id}
              option={o}
              rows={list}
              cardFields={cardFields}
              onOpen={onOpen}
              onAdd={() => onCreate(o ? { [groupField.id]: o.id } : {})}
            />
          )
        })}
      </div>
    </DndContext>
  )
}
