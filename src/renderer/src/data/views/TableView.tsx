import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { RecordRow } from '@shared/data/records'
import { t } from '@shared/i18n'
import { useRecordActions } from '../actions'
import type { Column } from '../columns'
import { FieldEditor, isInlineEditable } from '../FieldEditor'
import { FieldValue, isNumericField } from '../FieldValue'

function rowHeightPx(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--row-height')
  return parseInt(v, 10) || 28
}

/**
 * Tabla virtualizada (solo se pintan las filas visibles): miles de registros
 * sin perder fluidez. Teclado: flechas para moverse, Intro para editar,
 * Escape para cancelar, Espacio marca casillas.
 */
export function TableView({
  columns,
  rows,
  onOpen,
  onResize,
  selected,
  onSelect,
}: {
  columns: Column[]
  rows: RecordRow[]
  onOpen: (id: string) => void
  onResize: (fieldId: string, width: number) => void
  selected: Set<string>
  onSelect: (ids: Set<string>) => void
}) {
  const cols = columns.filter((c) => c.visible)
  const scroller = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<{ row: number; col: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [widths, setWidths] = useState<Record<string, number>>({})
  const { setValue } = useRecordActions()
  const height = useMemo(rowHeightPx, [])

  // TanStack Virtual no es compatible con la memoización automática de React; se usa tal cual.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => height,
    overscan: 12,
  })

  const template = ['36px', ...cols.map((c) => `${widths[c.field.id] ?? c.width}px`)].join(' ')
  useEffect(() => {
    gridRef.current?.style.setProperty('--cols', template)
  }, [template])

  useEffect(() => {
    if (active && active.row >= rows.length)
      setActive(rows.length ? { ...active, row: rows.length - 1 } : null)
  }, [rows.length, active])

  const focusGrid = () => gridRef.current?.focus()

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || !active) return
    const row = rows[active.row]
    const col = cols[active.col]
    const move = (dr: number, dc: number) => {
      e.preventDefault()
      const next = {
        row: Math.max(0, Math.min(rows.length - 1, active.row + dr)),
        col: Math.max(0, Math.min(cols.length - 1, active.col + dc)),
      }
      setActive(next)
      virtual.scrollToIndex(next.row)
    }
    switch (e.key) {
      case 'ArrowDown':
        return move(1, 0)
      case 'ArrowUp':
        return move(-1, 0)
      case 'ArrowRight':
        return move(0, 1)
      case 'ArrowLeft':
        return move(0, -1)
      case 'Enter':
        e.preventDefault()
        if (!row || !col) return
        if (active.col === 0 && e.altKey) return onOpen(row.id)
        if (col.field.type === 'checkbox')
          return void setValue(row.id, col.field, row.values[col.field.id] !== true)
        if (isInlineEditable(col.field)) setEditing(true)
        else onOpen(row.id)
        return
      case ' ':
        if (row && col?.field.type === 'checkbox') {
          e.preventDefault()
          void setValue(row.id, col.field, row.values[col.field.id] !== true)
        }
        return
      case 'Escape':
        setActive(null)
        return
    }
  }

  const startResize = (fieldId: string, start: number, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    let w = start
    const onMove = (ev: PointerEvent) => {
      w = Math.max(60, Math.min(1200, start + ev.clientX - x0))
      setWidths((old) => ({ ...old, [fieldId]: w }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      onResize(fieldId, w)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))

  return (
    <div className="table-scroll" ref={scroller}>
      <div
        className="grid"
        ref={gridRef}
        role="grid"
        aria-rowcount={rows.length + 1}
        aria-colcount={cols.length + 1}
        tabIndex={0}
        onKeyDown={onKeyDown}
        data-testid="table"
      >
        <div className="grid-row grid-head" role="row">
          <div className="grid-cell grid-check" role="columnheader">
            <input
              type="checkbox"
              className="checkbox"
              aria-label={t('Seleccionar todo')}
              checked={allSelected}
              onChange={() => onSelect(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
            />
          </div>
          {cols.map((c) => (
            <div
              key={c.field.id}
              className="grid-cell"
              role="columnheader"
              data-numeric={isNumericField(c.field)}
            >
              <span className="grid-head-label">{c.field.label}</span>
              <span
                className="grid-resize"
                role="separator"
                aria-label={t('Ancho de {field}', { field: c.field.label })}
                onPointerDown={(e) => startResize(c.field.id, widths[c.field.id] ?? c.width, e)}
              />
            </div>
          ))}
        </div>
        <div className="grid-body" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((vi) => {
            const r = rows[vi.index]!
            return (
              <div
                key={r.id}
                className="grid-row"
                role="row"
                aria-rowindex={vi.index + 2}
                aria-selected={selected.has(r.id)}
                data-testid="table-row"
                style={{ transform: `translateY(${vi.start}px)` }}
              >
                <div className="grid-cell grid-check" role="gridcell">
                  <input
                    type="checkbox"
                    className="checkbox"
                    aria-label={t('Seleccionar {title}', { title: r.title })}
                    checked={selected.has(r.id)}
                    onChange={() => {
                      const next = new Set(selected)
                      if (next.has(r.id)) next.delete(r.id)
                      else next.add(r.id)
                      onSelect(next)
                    }}
                  />
                </div>
                {cols.map((c, ci) => {
                  const isActive = active?.row === vi.index && active.col === ci
                  const f = c.field
                  const value = r.values[f.id]
                  return (
                    <div
                      key={f.id}
                      className="grid-cell"
                      role="gridcell"
                      data-active={isActive}
                      data-numeric={isNumericField(f)}
                      data-field={f.key}
                      onClick={() => {
                        setActive({ row: vi.index, col: ci })
                        if (!isActive) setEditing(false)
                        focusGrid()
                      }}
                      onDoubleClick={() => {
                        if (ci === 0 || !isInlineEditable(f)) onOpen(r.id)
                        else if (f.type !== 'checkbox') setEditing(true)
                      }}
                    >
                      {isActive && editing ? (
                        <FieldEditor
                          field={f}
                          value={value}
                          autoFocus
                          onCommit={(v) => void setValue(r.id, f, v)}
                          onDone={() => {
                            setEditing(false)
                            focusGrid()
                          }}
                        />
                      ) : f.type === 'checkbox' ? (
                        <input
                          type="checkbox"
                          className="checkbox"
                          aria-label={f.label}
                          checked={value === true}
                          onChange={(e) => void setValue(r.id, f, e.target.checked)}
                        />
                      ) : ci === 0 ? (
                        <span className="grid-title">
                          <span className="grid-title-text">{r.title}</span>
                          <button
                            type="button"
                            className="grid-open"
                            onClick={(e) => {
                              e.stopPropagation()
                              onOpen(r.id)
                            }}
                          >
                            {t('Abrir')}
                          </button>
                        </span>
                      ) : (
                        <FieldValue field={f} value={value} />
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
