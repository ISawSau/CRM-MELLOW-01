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
import { useState } from 'react'
import {
  fromLocalInput,
  localDateOf,
  monthGrid,
  shiftMonth,
  todayIn,
  toLocalInput,
} from '@shared/data/dates'
import type { FieldDef } from '@shared/data/fields'
import type { RecordRow } from '@shared/data/records'
import { currentLocale } from '@shared/format'
import { t } from '@shared/i18n'
import { useRecordActions } from '../actions'
import { useTimeZone } from '../nav'
import { dndAccessibility } from './dnd'

/** Días de la semana abreviados en el idioma de la interfaz, de lunes (1/1/2024) a domingo. */
const weekdays = () => {
  const f = new Intl.DateTimeFormat(currentLocale(), { weekday: 'short', timeZone: 'UTC' })
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2024, 0, 1 + i))))
}
const MAX_PER_DAY = 4
const monthName = () =>
  new Intl.DateTimeFormat(currentLocale(), { month: 'long', year: 'numeric', timeZone: 'UTC' })

function dayOf(field: FieldDef, v: unknown, tz: string): string | null {
  if (typeof v !== 'string') return null
  return field.type === 'datetime' ? localDateOf(v, tz) : v
}

function Event({ row, onOpen }: { row: RecordRow; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id })
  return (
    <button
      type="button"
      ref={setNodeRef}
      className="cal-event"
      data-dragging={isDragging}
      data-testid="cal-event"
      style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation()
        onOpen(row.id)
      }}
    >
      {row.title}
    </button>
  )
}

function Day({
  day,
  inMonth,
  isToday,
  rows,
  onOpen,
  onCreate,
}: {
  day: string
  inMonth: boolean
  isToday: boolean
  rows: RecordRow[]
  onOpen: (id: string) => void
  onCreate: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: day })
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? rows : rows.slice(0, MAX_PER_DAY)
  const [y, m, d] = day.split('-')
  return (
    <div
      ref={setNodeRef}
      className="cal-day"
      data-outside={!inMonth}
      data-today={isToday}
      data-over={isOver}
      data-day={day}
      role="gridcell"
      aria-label={`${d}/${m}/${y}`}
      onDoubleClick={onCreate}
    >
      <span className="cal-num num">{Number(d)}</span>
      {shown.map((r) => (
        <Event key={r.id} row={r} onOpen={onOpen} />
      ))}
      {rows.length > shown.length && (
        <button
          type="button"
          className="btn-link cal-more"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(true)
          }}
        >
          {t('+{n} más', { n: rows.length - shown.length })}
        </button>
      )}
    </div>
  )
}

/** Calendario mensual propio (la semana empieza en lunes). Doble clic en un día crea. */
export function CalendarView({
  rows,
  dateField,
  onOpen,
  onCreate,
}: {
  rows: RecordRow[]
  dateField: FieldDef | undefined
  onOpen: (id: string) => void
  onCreate: (values: Record<string, unknown>) => void
}) {
  const tz = useTimeZone()
  const today = todayIn(tz)
  const [month, setMonth] = useState(today.slice(0, 7))
  const { setValue } = useRecordActions()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  )
  if (!dateField || (dateField.type !== 'date' && dateField.type !== 'datetime')) {
    return (
      <div className="empty">
        <p className="muted">
          {t('Elige en «Campo de fecha» qué fecha se usa para el calendario.')}
        </p>
      </div>
    )
  }

  const byDay = new Map<string, RecordRow[]>()
  let undated = 0
  for (const r of rows) {
    const day = dayOf(dateField, r.values[dateField.id], tz)
    if (!day) {
      undated++
      continue
    }
    byDay.set(day, [...(byDay.get(day) ?? []), r])
  }

  const valueFor = (day: string, previous: unknown): string | null => {
    if (dateField.type === 'date') return day
    const time = typeof previous === 'string' ? toLocalInput(previous, tz).slice(11) : '09:00'
    return fromLocalInput(`${day}T${time}`, tz)
  }

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over) return
    const row = rows.find((r) => r.id === e.active.id)
    const day = String(e.over.id)
    if (!row || dayOf(dateField, row.values[dateField.id], tz) === day) return
    void setValue(row.id, dateField, valueFor(day, row.values[dateField.id]))
  }

  const [y, m] = month.split('-').map(Number) as [number, number]
  return (
    <div className="calendar" data-testid="calendar">
      <div className="cal-head">
        <h2 className="cal-title">{monthName().format(new Date(Date.UTC(y, m - 1, 1)))}</h2>
        <div className="form-actions">
          <button
            type="button"
            className="btn"
            onClick={() => setMonth(shiftMonth(month, -1))}
            aria-label={t('Mes anterior')}
          >
            ←
          </button>
          <button type="button" className="btn" onClick={() => setMonth(today.slice(0, 7))}>
            {t('Hoy')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setMonth(shiftMonth(month, 1))}
            aria-label={t('Mes siguiente')}
          >
            →
          </button>
        </div>
        {undated > 0 && <span className="faint">{t('{n} sin fecha', { n: undated })}</span>}
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd} accessibility={dndAccessibility()}>
        <div className="cal-grid" role="grid" aria-label={t('Calendario')}>
          {weekdays().map((w) => (
            <div key={w} className="cal-weekday" role="columnheader">
              {w}
            </div>
          ))}
          {monthGrid(month).map((day) => (
            <Day
              key={day}
              day={day}
              inMonth={day.startsWith(month)}
              isToday={day === today}
              rows={byDay.get(day) ?? []}
              onOpen={onOpen}
              onCreate={() => onCreate({ [dateField.id]: valueFor(day, null) })}
            />
          ))}
        </div>
      </DndContext>
    </div>
  )
}
